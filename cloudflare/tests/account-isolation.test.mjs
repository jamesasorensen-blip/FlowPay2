import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { validPlaidWebhookEvent, recordWebhookReceipt, processSyncJobs } from '../staging-worker.mjs';

// Entirely local: generated signing keys, synthetic users, in-memory SQLite.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const issuer = 'https://local-test.supabase.co/auth/v1';
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'local-test', alg: 'ES256', use: 'sig' };
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function token(id, aal) {
  const text = enc({alg: 'ES256', kid: 'local-test'}) + '.' + enc({sub: id, iss: issuer, aud: 'authenticated', role: 'authenticated', ...(aal ? {aal} : {}), exp: Math.floor(Date.now()/1000)+600});
  return text + '.' + Buffer.from(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, keys.privateKey, new TextEncoder().encode(text))).toString('base64url');
}
const tokens = { [A]: await token(A), [B]: await token(B) };
const aal2Token = await token(A, 'aal2');
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE user_data(user_id TEXT PRIMARY KEY, data_json TEXT, revision INTEGER, updated_at TEXT);
    CREATE TABLE bank_connections(id TEXT PRIMARY KEY,user_id TEXT,item_id TEXT,encrypted_access_token TEXT,token_iv TEXT,institution_name TEXT,created_at TEXT,sync_cursor TEXT,last_synced_at TEXT);
    CREATE TABLE bank_accounts(id TEXT PRIMARY KEY,connection_id TEXT,name TEXT,mask TEXT,type TEXT,subtype TEXT,current_balance REAL,available_balance REAL,balance_updated_at TEXT);
    CREATE TABLE bank_transactions(id TEXT PRIMARY KEY,account_id TEXT,amount REAL,transaction_date TEXT,merchant_name TEXT,description TEXT,pending INTEGER,category TEXT);
    CREATE TABLE user_consents(id TEXT PRIMARY KEY,user_id TEXT,consent_type TEXT,policy_version TEXT,granted_at TEXT,withdrawn_at TEXT,connection_id TEXT);
    CREATE TABLE security_audit_log(id TEXT PRIMARY KEY,user_id TEXT,action TEXT,resource_type TEXT,resource_id TEXT);
  `);
  sql.exec(readFileSync(new URL('../migrations/0001_webhook_receipts.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0002_webhook_sync_jobs.sql', import.meta.url), 'utf8'));
  for (const [uid, cid, label] of [[A, CA, 'A'], [B, CB, 'B']]) {
    sql.prepare('INSERT INTO users VALUES (?)').run(uid);
    sql.prepare('INSERT INTO user_data VALUES (?,?,1,NULL)').run(uid, JSON.stringify({owner:label}));
    sql.prepare('INSERT INTO bank_connections (id,user_id,item_id,encrypted_access_token,token_iv,institution_name,created_at) VALUES (?,?,?,NULL,NULL,?,NULL)').run(cid,uid,'item-'+label,'Bank '+label);
    sql.prepare("INSERT INTO bank_accounts VALUES (?,?,?,'0000','depository','checking',100,100,NULL)").run('account-'+label,cid,'Account '+label);
    sql.prepare("INSERT INTO bank_transactions VALUES (?,?,1,'2026-01-01',?,NULL,0,NULL)").run('tx-'+label,'account-'+label,'Merchant '+label);
    sql.prepare("INSERT INTO user_consents VALUES (?,?,'bank_connection','test','2026-01-01',NULL,NULL)").run('consent-'+label,uid);
  }
  const db = { prepare(query) { let values=[]; return {
    bind(...args) { values=args; return this; },
    async first() { return sql.prepare(query).get(...values) ?? null; },
    async all() { return {results:sql.prepare(query).all(...values)}; },
    async run() { return {meta:sql.prepare(query).run(...values)}; }
  }; }, async batch(items) {
    // Model D1's transactional batch behavior, including rollback on failure.
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const statement of items) results.push(await statement.run());
      sql.exec('COMMIT');
      return results;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  } };
  let externalCalls=0;
  let plaidResponder = null;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (url, options) => {
    if (String(url)===issuer+'/.well-known/jwks.json') return Response.json({keys:[jwk]});
    if (['https://sandbox.plaid.com/transactions/sync', 'https://sandbox.plaid.com/accounts/get', 'https://sandbox.plaid.com/link/token/create'].includes(String(url)) && plaidResponder) {
      return plaidResponder(JSON.parse(options.body), String(url));
    }
    externalCalls++;
    throw Error('External network call blocked');
  };
  return { sql, db, setPlaidResponder(fn) { plaidResponder = fn; }, externalCalls:()=>externalCalls, close() { globalThis.fetch=originalFetch; sql.close(); },
    async call(uid,path,method='GET',body,allowedUser=uid,requireAal2=false,overrideToken, config={}) {
      const response=await worker.fetch(new Request('https://worker.test'+path, {method, headers:{Origin:'https://flowpay-6aay.onrender.com',Authorization:'Bearer '+(overrideToken || tokens[uid]),'Content-Type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)})}),
        {DB:db,SUPABASE_URL:'https://local-test.supabase.co',PLAID_ENV:'sandbox',STAGING_TEST_USER_ID:allowedUser,REQUIRE_AAL2:requireAal2?'true':'false',TOKEN_ENCRYPTION_KEY:'00'.repeat(32),PLAID_CLIENT_ID:'test',PLAID_SECRET:'test',...config});
      return {status:response.status,body:await response.json()};
    }
  };
}

test('a valid second user is rejected by the actual staging allowlist before data access', async()=>{
  const f=fixture(); try {
    for (const path of ['/me','/user-data','/bank-accounts','/bank-transactions','/consent']) {
      const r=await f.call(B,path,'GET',undefined,A); assert.equal(r.status,403); assert.equal(r.body.error,'Staging access restricted');
    }
    assert.equal(f.externalCalls(),0);
  } finally { f.close(); }
});

test('each allowed identity sees only its own data even with forged query user IDs', async()=>{
  const f=fixture(); try {
    // Switch only the local fixture allowlist to exercise ownership beneath that guard.
    for (const [uid, other, label] of [[A,B,'A'],[B,A,'B']]) {
      for (const [path,field,id] of [['/bank-accounts','accounts','account-'],['/bank-transactions','transactions','tx-'],['/consent','consents','consent-']]) {
        const r=await f.call(uid,path+'?user_id='+other); assert.equal(r.status,200); assert.deepEqual(r.body[field].map(x=>x.id),[id+label]);
      }
      const r=await f.call(uid,'/user-data?user_id='+other); assert.equal(r.status,200); assert.equal(r.body.data.owner,label);
    }
  } finally { f.close(); }
});

test('foreign connection sync and disconnect return 404 without Plaid calls or writes', async()=>{
  const f=fixture(); try {
    const before=JSON.stringify(f.sql.prepare('SELECT * FROM bank_connections ORDER BY id').all());
    for (const [uid,cid] of [[A,CB],[B,CA]]) {
      assert.equal((await f.call(uid,'/sync-transactions','POST',{connection_id:cid})).status,404);
      assert.equal((await f.call(uid,'/bank-connections/'+cid,'DELETE')).status,404);
    }
    assert.equal(f.externalCalls(),0); assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM bank_connections ORDER BY id').all()),before);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM security_audit_log').get().n,0);
  } finally { f.close(); }
});

test('forged body user_id cannot overwrite the other user cloud data', async()=>{
  const f=fixture(); try {
    const r=await f.call(A,'/user-data','PUT',{user_id:B,revision:1,data:{owner:'updated A'}}); assert.equal(r.status,200);
    assert.equal(JSON.parse(f.sql.prepare('SELECT data_json FROM user_data WHERE user_id=?').get(B).data_json).owner,'B');
    assert.equal(JSON.parse(f.sql.prepare('SELECT data_json FROM user_data WHERE user_id=?').get(A).data_json).owner,'updated A');
  } finally { f.close(); }
});

test('consent withdrawal affects only the authenticated user', async()=>{
  const f=fixture(); try {
    const r=await f.call(A,'/consent/withdraw','POST',{consent_type:'bank_connection',user_id:B}); assert.equal(r.status,200); assert.equal(r.body.consents_updated,1);
    assert.equal(f.sql.prepare('SELECT withdrawn_at FROM user_consents WHERE user_id=?').get(B).withdrawn_at,null);
    assert.ok(f.sql.prepare('SELECT withdrawn_at FROM user_consents WHERE user_id=?').get(A).withdrawn_at);
    assert.equal(f.sql.prepare('SELECT user_id FROM security_audit_log').get().user_id,A);
  } finally { f.close(); }
});

test('local D1 batch simulator rolls back successful writes if a later statement fails', async () => {
  const f = fixture();
  try {
    const before = f.sql.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n;
    await assert.rejects(f.db.batch([
      f.db.prepare("INSERT INTO bank_transactions (id,account_id,amount,transaction_date) VALUES (?,?,?,?)")
        .bind('new-test-transaction', 'account-A', 12, '2026-01-02'),
      f.db.prepare("INSERT INTO bank_transactions (id,account_id,amount,transaction_date) VALUES (?,?,?,?)")
        .bind('tx-A', 'account-A', 13, '2026-01-02')
    ]));
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n, before);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='new-test-transaction'").get().n, 0);
  } finally {
    f.close();
  }
});

test('failed sync batch rolls back transaction changes, cursor and audit together', async () => {
  const f = fixture();
  try {
    const before = f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor;
    await assert.rejects(f.db.batch([
      f.db.prepare('INSERT INTO bank_transactions (id,account_id,amount,transaction_date) VALUES (?,?,?,?)')
        .bind('new-sync-tx', 'account-A', 9, '2026-01-02'),
      f.db.prepare('UPDATE bank_connections SET sync_cursor=? WHERE id=?').bind('advanced-cursor', CA),
      f.db.prepare('INSERT INTO security_audit_log (id,user_id,action,resource_type,resource_id) VALUES (?,?,?,?,?)')
        .bind('new-sync-audit', A, 'transactions_synced', 'bank_connection', CA),
      f.db.prepare('INSERT INTO bank_transactions (id,account_id,amount,transaction_date) VALUES (?,?,?,?)')
        .bind('tx-A', 'account-A', 9, '2026-01-02')
    ]));
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor, before);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='new-sync-tx'").get().n, 0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE id='new-sync-audit'").get().n, 0);
  } finally {
    f.close();
  }
});

test('optional MFA gate rejects AAL1 and accepts signed AAL2 token', async () => {
  const f = fixture();
  try {
    const denied = await f.call(A, '/me', 'GET', undefined, A, true);
    assert.notEqual(denied.status, 200);
    const accepted = await f.call(A, '/me', 'GET', undefined, A, true, aal2Token);
    assert.equal(accepted.status, 200);
  } finally {
    f.close();
  }
});

async function enableSyntheticPlaid(f, connectionId = CA) {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('synthetic-access-token'));
  f.sql.prepare('UPDATE bank_connections SET encrypted_access_token=?,token_iv=? WHERE id=?')
    .run(Buffer.from(ciphertext).toString('base64'),Buffer.from(iv).toString('base64'),connectionId);
}
test('actual sync route commits a valid Plaid page and advances its cursor', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    f.setPlaidResponder(body => {
      assert.equal(body.cursor, '');
      return Response.json({
        added:[{transaction_id:'new-plaid-tx',account_id:'account-A',amount:17.5,date:'2026-11-10',name:'Test merchant'}],
        modified:[],removed:[],next_cursor:'cursor-1',has_more:false
      });
    });
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,200,JSON.stringify(response.body));
    assert.equal(response.body.added,1);
    assert.equal(response.body.modified,0);
    assert.equal(response.body.removed,0);
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,'cursor-1');
    assert.equal(f.sql.prepare("SELECT amount FROM bank_transactions WHERE id='new-plaid-tx'").get().amount,17.5);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE action='transactions_synced'").get().n,1);
  } finally { f.close(); }
});

test('actual sync route rejects foreign-account transactions without moving cursor', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    f.setPlaidResponder(() => Response.json({
      added:[{transaction_id:'foreign-plaid-tx',account_id:'account-B',amount:10,date:'2026-11-10'}],
      modified:[],removed:[],next_cursor:'should-not-commit',has_more:false
    }));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,502);
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='foreign-plaid-tx'").get().n,0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE action='transactions_synced'").get().n,0);
  } finally { f.close(); }
});

test('actual sync route restarts pagination after Plaid mutation without duplicate writes', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    const cursors = [];
    f.setPlaidResponder(body => {
      cursors.push(body.cursor);
      if (cursors.length === 1) return Response.json({
        added:[{transaction_id:'stale-tx',account_id:'account-A',amount:1,date:'2026-11-10'}],
        modified:[],removed:[],next_cursor:'intermediate',has_more:true
      });
      if (cursors.length === 2) return Response.json({
        error_code:'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'
      },{status:400});
      return Response.json({
        added:[{transaction_id:'fresh-tx',account_id:'account-A',amount:2,date:'2026-11-10'}],
        modified:[],removed:[],next_cursor:'final-cursor',has_more:false
      });
    });
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,200,JSON.stringify(response.body));
    assert.deepEqual(cursors,['','intermediate','']);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='stale-tx'").get().n,0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='fresh-tx'").get().n,1);
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,'final-cursor');
  } finally { f.close(); }
});

test('actual sync route rejects malformed dates without committing the cursor', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    f.setPlaidResponder(() => Response.json({
      added:[{transaction_id:'bad-date',account_id:'account-A',amount:3,date:'not-a-date'}],
      modified:[],removed:[],next_cursor:'bad-cursor',has_more:false
    }));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,502,JSON.stringify(response.body));
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='bad-date'").get().n,0);
  } finally { f.close(); }
});

test('actual sync route rejects cyclic Plaid cursors without saving partial pages', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    const cursors = [];
    f.setPlaidResponder(body => {
      cursors.push(body.cursor);
      return Response.json({
        added:[],modified:[],removed:[],
        next_cursor:cursors.length === 1 ? 'cursor-A' : 'cursor-A',
        has_more:true
      });
    });
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,502,JSON.stringify(response.body));
    assert.deepEqual(cursors,['','cursor-A']);
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
  } finally { f.close(); }
});

test('actual sync route rejects transaction ID already owned by another account', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    f.setPlaidResponder(() => Response.json({
      added:[{transaction_id:'tx-B',account_id:'account-A',amount:7,date:'2026-11-10'}],
      modified:[],removed:[],next_cursor:'conflict-cursor',has_more:false
    }));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,409,JSON.stringify(response.body));
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
    assert.equal(f.sql.prepare("SELECT amount FROM bank_transactions WHERE id='tx-B'").get().amount,1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE action='transactions_synced'").get().n,0);
  } finally { f.close(); }
});

test('actual sync route rejects contradictory account IDs for one transaction', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    f.sql.prepare("INSERT INTO bank_accounts (id,connection_id,name) VALUES (?,?,?)")
      .run('account-A2', CA, 'Second account A');
    f.setPlaidResponder(() => Response.json({
      added:[{transaction_id:'duplicate-tx',account_id:'account-A',amount:7,date:'2026-11-10'}],
      modified:[{transaction_id:'duplicate-tx',account_id:'account-A2',amount:8,date:'2026-11-10'}],
      removed:[],next_cursor:'contradictory-cursor',has_more:false
    }));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,409,JSON.stringify(response.body));
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='duplicate-tx'").get().n,0);
  } finally { f.close(); }
});

test('actual sync rejects impossible calendar dates without advancing cursor', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    f.setPlaidResponder(() => Response.json({
      added:[{transaction_id:'impossible-date',account_id:'account-A',amount:4,date:'2026-02-30'}],
      modified:[],removed:[],next_cursor:'impossible-cursor',has_more:false
    }));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,502,JSON.stringify(response.body));
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id='impossible-date'").get().n,0);
  } finally { f.close(); }
});

test('actual sync checks transaction ownership across multiple SQL lookup chunks', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    const added = Array.from({length: 91}, (_,i) => ({
      transaction_id: 'chunk-tx-'+i,
      account_id:'account-A',
      amount:i+1,
      date:'2026-11-10'
    }));
    added[90].transaction_id = 'tx-B';
    f.setPlaidResponder(() => Response.json({
      added,modified:[],removed:[],next_cursor:'chunk-cursor',has_more:false
    }));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,409,JSON.stringify(response.body));
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE id LIKE 'chunk-tx-%'").get().n,0);
  } finally { f.close(); }
});

test('withdrawn bank consent blocks actual sync before Plaid or cursor changes', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    let plaidCalls = 0;
    f.setPlaidResponder(() => {
      plaidCalls++;
      return Response.json({added:[],modified:[],removed:[],next_cursor:'unexpected',has_more:false});
    });
    const withdrawn = await f.call(A,'/consent/withdraw','POST',{consent_type:'bank_connection'});
    assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.body));
    const response = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
    assert.equal(response.status,403,JSON.stringify(response.body));
    assert.equal(plaidCalls,0);
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id=?').get(CA).sync_cursor,null);
  } finally { f.close(); }
});

test('withdrawn bank consent blocks balance refresh before Plaid calls', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    let plaidCalls = 0;
    f.setPlaidResponder(() => {
      plaidCalls++;
      return Response.json({accounts:[]});
    });
    const withdrawn = await f.call(A,'/consent/withdraw','POST',{consent_type:'bank_connection'});
    assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.body));
    const response = await f.call(A,'/bank-accounts?refresh=true');
    assert.equal(response.status,403,JSON.stringify(response.body));
    assert.equal(plaidCalls,0);
    assert.equal(f.sql.prepare("SELECT current_balance FROM bank_accounts WHERE id='account-A'").get().current_balance,100);
  } finally { f.close(); }
});

test('balance refresh refuses Plaid account ID owned by another connection', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    let plaidCalls = 0;
    f.setPlaidResponder(() => {
      plaidCalls++;
      return Response.json({
        accounts:[{account_id:'account-B',name:'Foreign account',balances:{current:999}}]
      });
    });
    const before = f.sql.prepare("SELECT current_balance FROM bank_accounts WHERE id='account-B'").get().current_balance;
    const response = await f.call(A,'/bank-accounts?refresh=true');
    assert.equal(plaidCalls,1);
    assert.equal(response.status,500);
    assert.equal(response.body.error,'Request failed');
    assert.equal(f.externalCalls(),0);
    assert.equal(f.sql.prepare("SELECT current_balance FROM bank_accounts WHERE id='account-B'").get().current_balance,before);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE action='balances_refreshed'").get().n,0);
  } finally { f.close(); }
});

test('duplicate Plaid account IDs reject refresh without partial balance updates', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    let plaidCalls = 0;
    f.setPlaidResponder(() => {
      plaidCalls++;
      return Response.json({
        accounts:[
          {account_id:'account-A',name:'Updated',balances:{current:900}},
          {account_id:'account-A',name:'Duplicate',balances:{current:901}}
        ]
      });
    });
    const response = await f.call(A,'/bank-accounts?refresh=true');
    assert.equal(plaidCalls,1);
    assert.equal(response.status,500);
    assert.equal(response.body.error,'Request failed');
    assert.equal(f.externalCalls(),0);
    assert.equal(f.sql.prepare("SELECT current_balance FROM bank_accounts WHERE id='account-A'").get().current_balance,100);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM security_audit_log WHERE action='balances_refreshed'").get().n,0);
  } finally { f.close(); }
});

test('staging health endpoint refuses non-sandbox Plaid configuration', async () => {
  const response = await worker.fetch(new Request('https://worker.test/'), {
    PLAID_ENV:'production'
  });
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,'Sandbox only');
});

test('Plaid webhook receiver rejects unsigned and malformed events without database access', async () => {
  for (const headers of [{}, {'Plaid-Verification':'invalid.jwt.value'}]) {
    const response = await worker.fetch(new Request('https://worker.test/plaid-webhook', {
      method:'POST',headers:{'Content-Type':'application/json',...headers},
      body:JSON.stringify({webhook_type:'ITEM',webhook_code:'NEW_ACCOUNTS_AVAILABLE',item_id:'fake'})
    }), {PLAID_ENV:'sandbox'});
    assert.equal(response.status,401);
  }
});

test('Plaid webhook receiver never accepts GET or non-sandbox environment', async () => {
  const get = await worker.fetch(new Request('https://worker.test/plaid-webhook'), {PLAID_ENV:'sandbox'});
  assert.equal(get.status,405);
  const production = await worker.fetch(new Request('https://worker.test/plaid-webhook',{
    method:'POST',body:'{}'
  }), {PLAID_ENV:'production'});
  assert.equal(production.status,403);
});

test('signed NEW_ACCOUNTS_AVAILABLE webhook is acknowledged only with matching body hash', async () => {
  const f = fixture();
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey = {...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'synthetic-webhook-key',alg:'ES256'};
  const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const body = JSON.stringify({webhook_type:'ITEM',webhook_code:'NEW_ACCOUNTS_AVAILABLE',item_id:'item-A'});
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))).toString('hex');
  const signed = encode({alg:'ES256',kid:publicKey.kid})+'.'+encode({
    iat:Math.floor(Date.now()/1000),request_body_sha256:digest
  });
  const signature = Buffer.from(await crypto.subtle.sign(
    {name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(signed)
  )).toString('base64url');
  const originalFetch = globalThis.fetch;
  let keyLookups = 0;
  globalThis.fetch = async (url,options) => {
    assert.equal(String(url),'https://sandbox.plaid.com/webhook_verification_key/get');
    assert.equal(JSON.parse(options.body).key_id,publicKey.kid);
    keyLookups++;
    return Response.json({key:publicKey});
  };
  try {
    const call = payload => worker.fetch(new Request('https://worker.test/plaid-webhook',{
      method:'POST',headers:{'Plaid-Verification':signed+'.'+signature},body:payload
    }),{PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'synthetic',PLAID_SECRET:'synthetic', STAGING_TEST_USER_ID:A, DB:f.db});
    const accepted = await call(body);
    assert.equal(accepted.status,200,await accepted.text());
    assert.equal((await call(body)).status, 200);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM plaid_webhook_receipts').get().n, 1);
    f.sql.exec('DROP TABLE plaid_webhook_receipts');
    assert.equal((await call(body)).status, 503);
    const rejected = await call(body+' ');
    assert.equal(rejected.status,401);
    // An attacker cannot substitute another signing key or alter the signature.
    const badSignature = (signature.startsWith('A')?'B':'A')+signature.slice(1);
    const forged = await worker.fetch(new Request('https://worker.test/plaid-webhook',{
      method:'POST',headers:{'Plaid-Verification':signed+'.'+badSignature},body
    }),{PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'synthetic',PLAID_SECRET:'synthetic', STAGING_TEST_USER_ID:A, DB:f.db});
    assert.equal(forged.status,401);
    assert.equal(keyLookups,5);
  } finally { globalThis.fetch = originalFetch; f.close(); }
});

test('Link token URL bindings accept only exact frontend and Worker HTTPS destinations', async () => {
  const f=fixture();
  try {
    let sent=null;
    f.setPlaidResponder(body=>{sent=body;return Response.json({link_token:'link-sandbox-test',expiration:'2026-12-01T00:00:00Z'});});
    const valid=await f.call(A,'/link-token','POST',{},A,false,undefined,{
      PLAID_OAUTH_REDIRECT_URI:'https://flowpay-6aay.onrender.com/',
      PLAID_WEBHOOK_URL:'https://worker.test/plaid-webhook'
    });
    assert.equal(valid.status,200,JSON.stringify(valid.body));
    assert.equal(sent.redirect_uri,'https://flowpay-6aay.onrender.com/');
    assert.equal(sent.webhook,'https://worker.test/plaid-webhook');
    for(const config of [
      {PLAID_OAUTH_REDIRECT_URI:'https://evil.example/'},
      {PLAID_OAUTH_REDIRECT_URI:'http://flowpay-6aay.onrender.com/'},
      {PLAID_OAUTH_REDIRECT_URI:'https://flowpay-6aay.onrender.com/other'},
      {PLAID_WEBHOOK_URL:'https://evil.example/plaid-webhook'},
      {PLAID_WEBHOOK_URL:'https://worker.test/plaid-webhook?token=bad'},
      {PLAID_WEBHOOK_URL:'https://worker.test/not-webhook'}
    ]) {
      sent=null;
      const response=await f.call(A,'/link-token','POST',{},A,false,undefined,config);
      assert.notEqual(response.status,200,JSON.stringify(config));
      assert.equal(sent,null,'invalid config must not be sent to Plaid');
    }
  } finally {f.close();}
});

test('Plaid webhook envelope rejects malformed fields but accepts future event codes', () => {
  const valid={webhook_type:'ITEM',webhook_code:'NEW_ACCOUNTS_AVAILABLE',item_id:'item_123-abc'};
  assert.equal(validPlaidWebhookEvent(valid),true);
  assert.equal(validPlaidWebhookEvent({...valid,webhook_code:'FUTURE_EVENT'}),true);
  for(const event of [
    null, [], 'not an object', {}, {...valid,item_id:''},
    {...valid,item_id:'../other'}, {...valid,webhook_type:'item'},
    {...valid,webhook_code:'X'.repeat(129)}, {...valid,webhook_code:42}
  ]) assert.equal(validPlaidWebhookEvent(event),false,JSON.stringify(event));
});

test('staging item webhook diagnostic rejects malformed and foreign connections without Plaid calls', async () => {
  const f=fixture(); try {
    for (const connection_id of ['', '../other', 4, null]) {
      const r=await f.call(A,'/diagnostics/item-webhook','POST',{connection_id});
      assert.equal(r.status,400);
    }
    const foreign=await f.call(A,'/diagnostics/item-webhook','POST',{connection_id:CB});
    assert.equal(foreign.status,404);
    const restricted=await f.call(B,'/diagnostics/item-webhook','POST',{connection_id:CB},A);
    assert.equal(restricted.status,403);
    assert.equal(f.externalCalls(),0);
  } finally { f.close(); }
});


test('webhook receipts deduplicate deliveries, retain distinct tokens and expire old receipts', async () => {
  const f = fixture();
  const env = {DB:f.db, STAGING_TEST_USER_ID:A};
  const event = {webhook_type:'TRANSACTIONS', webhook_code:'SYNC_UPDATES_AVAILABLE', item_id:'item-A'};
  try {
    f.sql.prepare("INSERT INTO plaid_webhook_receipts VALUES ('old','ITEM','ERROR',datetime('now','-8 days'))").run();
    await recordWebhookReceipt(env, event, 'verified-token-1');
    await recordWebhookReceipt(env, event, 'verified-token-1');
    await recordWebhookReceipt(env, event, 'verified-token-2');
    const rows = f.sql.prepare('SELECT * FROM plaid_webhook_receipts').all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.match(row.id, /^[a-f0-9]{64}$/);
      assert.equal(row.webhook_code, 'SYNC_UPDATES_AVAILABLE');
    }
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM bank_transactions').get().n, 2);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM security_audit_log').get().n, 0);
  } finally { f.close(); }
});

test('webhook receipts require an unambiguous owned Item and active bank consent', async () => {
  const f = fixture();
  const event = {webhook_type:'ITEM', webhook_code:'NEW_ACCOUNTS_AVAILABLE', item_id:'item-A'};
  try {
    await assert.rejects(recordWebhookReceipt({DB:f.db}, event, 'token'));
    await recordWebhookReceipt({DB:f.db, STAGING_TEST_USER_ID:B}, event, 'foreign');
    await recordWebhookReceipt({DB:f.db, STAGING_TEST_USER_ID:A}, {...event,item_id:'unknown'}, 'unknown');
    f.sql.prepare('UPDATE bank_connections SET item_id = ? WHERE id = ?').run('item-A', CB);
    await recordWebhookReceipt({DB:f.db, STAGING_TEST_USER_ID:A}, event, 'ambiguous');
    f.sql.prepare('UPDATE bank_connections SET item_id = ? WHERE id = ?').run('item-B', CB);
    f.sql.prepare('UPDATE user_consents SET withdrawn_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(A);
    await recordWebhookReceipt({DB:f.db, STAGING_TEST_USER_ID:A}, event, 'withdrawn');
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM plaid_webhook_receipts').get().n, 0);
  } finally { f.close(); }
});

test('a receipt storage failure remains retryable without a partial receipt', async () => {
  const f = fixture();
  try {
    f.sql.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON plaid_webhook_receipts BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;");
    await assert.rejects(recordWebhookReceipt({DB:f.db, STAGING_TEST_USER_ID:A}, {
      webhook_type:'TRANSACTIONS', webhook_code:'SYNC_UPDATES_AVAILABLE', item_id:'item-A'
    }, 'token'));
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM plaid_webhook_receipts').get().n, 0);
  } finally { f.close(); }
});

const syncEvent = {webhook_type:'TRANSACTIONS', webhook_code:'SYNC_UPDATES_AVAILABLE', item_id:'item-A'};
const syncEnv = f => ({DB:f.db, PLAID_ENV:'sandbox', STAGING_TEST_USER_ID:A,
  TOKEN_ENCRYPTION_KEY:'00'.repeat(32), PLAID_CLIENT_ID:'test', PLAID_SECRET:'test'});
const emptySyncPage = cursor => Response.json({added:[],modified:[],removed:[],next_cursor:cursor,has_more:false});

test('webhook enqueue is atomic, deduplicated and processed through the existing sync engine', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    const env = syncEnv(f);
    await recordWebhookReceipt(env, syncEvent, 'delivery-1');
    await recordWebhookReceipt(env, syncEvent, 'delivery-1');
    assert.equal(f.sql.prepare('SELECT generation FROM plaid_sync_jobs').get().generation, 1);
    f.setPlaidResponder(() => emptySyncPage('background-cursor'));
    await processSyncJobs(env);
    const job = f.sql.prepare('SELECT * FROM plaid_sync_jobs').get();
    assert.equal(job.generation, job.processed_generation);
    assert.equal(job.lease_token, '');
    assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id = ?').get(CA).sync_cursor, 'background-cursor');
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM security_audit_log').get().n, 1);
    // Account availability notifications retain a receipt without queuing transaction work.
    await recordWebhookReceipt(env, {...syncEvent,webhook_type:'ITEM',webhook_code:'NEW_ACCOUNTS_AVAILABLE'}, 'delivery-2');
    assert.equal(f.sql.prepare('SELECT generation FROM plaid_sync_jobs').get().generation, 1);
  } finally { f.close(); }
});

test('queue failure rolls back receipt so a redelivery can enqueue successfully', async () => {
  const f = fixture();
  try {
    f.sql.exec("CREATE TRIGGER fail_job BEFORE INSERT ON plaid_sync_jobs BEGIN SELECT RAISE(ABORT, 'injected job failure'); END;");
    await assert.rejects(recordWebhookReceipt(syncEnv(f), syncEvent, 'delivery'));
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM plaid_webhook_receipts').get().n, 0);
    f.sql.exec('DROP TRIGGER fail_job');
    await recordWebhookReceipt(syncEnv(f), syncEvent, 'delivery');
    assert.equal(f.sql.prepare('SELECT generation FROM plaid_sync_jobs').get().generation, 1);
  } finally { f.close(); }
});

test('failed background sync backs off and survives until a later successful retry', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    await recordWebhookReceipt(syncEnv(f), syncEvent, 'retry-delivery');
    let calls = 0;
    f.setPlaidResponder(() => {calls++; throw Error('synthetic failure with private details');});
    await processSyncJobs(syncEnv(f));
    let job = f.sql.prepare('SELECT * FROM plaid_sync_jobs').get();
    assert.equal(job.attempts, 1);
    assert.equal(job.processed_generation, 0);
    assert.ok(job.next_attempt_at > Date.now()/1000);
    await processSyncJobs(syncEnv(f));
    assert.equal(calls, 1);
    f.sql.exec('UPDATE plaid_sync_jobs SET next_attempt_at = 0');
    f.setPlaidResponder(() => emptySyncPage('retry-cursor'));
    await processSyncJobs(syncEnv(f));
    job = f.sql.prepare('SELECT * FROM plaid_sync_jobs').get();
    assert.equal(job.attempts, 0);
    assert.equal(job.processed_generation, job.generation);
  } finally { f.close(); }
});

test('events arriving during sync remain pending and manual sync shares the lease', async () => {
  const f = fixture();
  try {
    await enableSyntheticPlaid(f);
    const env = syncEnv(f);
    await recordWebhookReceipt(env, syncEvent, 'before-sync');
    f.setPlaidResponder(async () => {
      const manual = await f.call(A,'/sync-transactions','POST',{connection_id:CA});
      assert.equal(manual.status, 409);
      await recordWebhookReceipt(env, syncEvent, 'during-sync');
      return emptySyncPage('first-cursor');
    });
    await processSyncJobs(env);
    let job = f.sql.prepare('SELECT * FROM plaid_sync_jobs').get();
    assert.equal(job.generation, 2);
    assert.equal(job.processed_generation, 1);
    f.setPlaidResponder(() => emptySyncPage('second-cursor'));
    await processSyncJobs(env);
    job = f.sql.prepare('SELECT * FROM plaid_sync_jobs').get();
    assert.equal(job.processed_generation, 2);
  } finally { f.close(); }
});

test('lost leases and consent withdrawn during a Plaid call prevent all financial writes', async () => {
  for (const mutation of [
    "UPDATE plaid_sync_jobs SET lease_token = 'replacement'",
    'UPDATE plaid_sync_jobs SET lease_until = 0',
    'UPDATE user_consents SET withdrawn_at = CURRENT_TIMESTAMP'
  ]) {
    const f = fixture();
    try {
      await enableSyntheticPlaid(f);
      await recordWebhookReceipt(syncEnv(f), syncEvent, 'fenced-delivery');
      f.setPlaidResponder(() => {
        f.sql.exec(mutation);
        return Response.json({added:[{transaction_id:'must-rollback',account_id:'account-A',amount:1,date:'2026-11-11'}],modified:[],removed:[],next_cursor:'must-rollback',has_more:false});
      });
      await processSyncJobs(syncEnv(f));
      assert.equal(f.sql.prepare("SELECT count(*) AS n FROM bank_transactions WHERE id = 'must-rollback'").get().n, 0);
      assert.equal(f.sql.prepare('SELECT sync_cursor FROM bank_connections WHERE id = ?').get(CA).sync_cursor, null);
      assert.equal(f.sql.prepare('SELECT count(*) AS n FROM security_audit_log').get().n, 0);
    } finally { f.close(); }
  }
});

test('sync status is private to the connection owner and exposes only operational fields', async () => {
  const f = fixture();
  try {
    await recordWebhookReceipt(syncEnv(f), syncEvent, 'status-delivery');
    const status = await f.call(A, '/diagnostics/sync-status?connection_id='+CA);
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, {pending:true,running:false,attempts:0,next_retry_at:null,last_synced_at:null});
    assert.equal((await f.call(B, '/diagnostics/sync-status?connection_id='+CA)).status, 404);
  } finally { f.close(); }
});

test('withdrawn-consent jobs are cancelled before Plaid calls and scheduled processing is sandbox-only', async () => {
  const f = fixture();
  try {
    await recordWebhookReceipt(syncEnv(f), syncEvent, 'withdrawn-job');
    f.sql.exec('UPDATE user_consents SET withdrawn_at = CURRENT_TIMESTAMP');
    let task;
    await worker.scheduled({},syncEnv(f),{waitUntil(promise){task=promise;}});
    await task;
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM plaid_sync_jobs').get().n, 0);
    assert.equal(f.externalCalls(), 0);
    // Guard before database access for both missing test-user configuration and production.
    await processSyncJobs({PLAID_ENV:'production'});
    await processSyncJobs({PLAID_ENV:'sandbox'});
  } finally { f.close(); }
});
