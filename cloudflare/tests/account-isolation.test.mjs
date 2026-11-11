import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../staging-worker.mjs';

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
    if (String(url) === 'https://sandbox.plaid.com/transactions/sync' && plaidResponder) {
      return plaidResponder(JSON.parse(options.body));
    }
    externalCalls++;
    throw Error('External network call blocked');
  };
  return { sql, db, setPlaidResponder(fn) { plaidResponder = fn; }, externalCalls:()=>externalCalls, close() { globalThis.fetch=originalFetch; sql.close(); },
    async call(uid,path,method='GET',body,allowedUser=uid,requireAal2=false,overrideToken) {
      const response=await worker.fetch(new Request('https://worker.test'+path, {method, headers:{Origin:'https://flowpay-6aay.onrender.com',Authorization:'Bearer '+(overrideToken || tokens[uid]),'Content-Type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)})}),
        {DB:db,SUPABASE_URL:'https://local-test.supabase.co',PLAID_ENV:'sandbox',STAGING_TEST_USER_ID:allowedUser,REQUIRE_AAL2:requireAal2?'true':'false',TOKEN_ENCRYPTION_KEY:'00'.repeat(32),PLAID_CLIENT_ID:'test',PLAID_SECRET:'test'});
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
