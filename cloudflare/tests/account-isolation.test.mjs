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
async function token(id) {
  const text = enc({alg: 'ES256', kid: 'local-test'}) + '.' + enc({sub: id, iss: issuer, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now()/1000)+600});
  return text + '.' + Buffer.from(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, keys.privateKey, new TextEncoder().encode(text))).toString('base64url');
}
const tokens = { [A]: await token(A), [B]: await token(B) };
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE user_data(user_id TEXT PRIMARY KEY, data_json TEXT, revision INTEGER, updated_at TEXT);
    CREATE TABLE bank_connections(id TEXT PRIMARY KEY,user_id TEXT,item_id TEXT,encrypted_access_token TEXT,token_iv TEXT,institution_name TEXT,created_at TEXT);
    CREATE TABLE bank_accounts(id TEXT PRIMARY KEY,connection_id TEXT,name TEXT,mask TEXT,type TEXT,subtype TEXT,current_balance REAL,available_balance REAL,balance_updated_at TEXT);
    CREATE TABLE bank_transactions(id TEXT PRIMARY KEY,account_id TEXT,amount REAL,transaction_date TEXT,merchant_name TEXT,description TEXT,pending INTEGER,category TEXT);
    CREATE TABLE user_consents(id TEXT PRIMARY KEY,user_id TEXT,consent_type TEXT,policy_version TEXT,granted_at TEXT,withdrawn_at TEXT,connection_id TEXT);
    CREATE TABLE security_audit_log(id TEXT PRIMARY KEY,user_id TEXT,action TEXT,resource_type TEXT,resource_id TEXT);
  `);
  for (const [uid, cid, label] of [[A, CA, 'A'], [B, CB, 'B']]) {
    sql.prepare('INSERT INTO users VALUES (?)').run(uid);
    sql.prepare('INSERT INTO user_data VALUES (?,?,1,NULL)').run(uid, JSON.stringify({owner:label}));
    sql.prepare('INSERT INTO bank_connections VALUES (?,?,?,NULL,NULL,?,NULL)').run(cid,uid,'item-'+label,'Bank '+label);
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
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url => {
    if (String(url)===issuer+'/.well-known/jwks.json') return Response.json({keys:[jwk]});
    externalCalls++;
    throw Error('External network call blocked');
  };
  return { sql, db, externalCalls:()=>externalCalls, close() { globalThis.fetch=originalFetch; sql.close(); },
    async call(uid,path,method='GET',body,allowedUser=uid) {
      const response=await worker.fetch(new Request('https://worker.test'+path, {method, headers:{Origin:'https://flowpay-6aay.onrender.com',Authorization:'Bearer '+tokens[uid],'Content-Type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)})}),
        {DB:db,SUPABASE_URL:'https://local-test.supabase.co',PLAID_ENV:'sandbox',STAGING_TEST_USER_ID:allowedUser});
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
