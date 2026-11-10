import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../docs/mfa-recovery-private-schema-draft.sql',import.meta.url),'utf8').toLowerCase();
test('recovery tables live in a private schema',()=>{
 assert.match(sql,/create schema if not exists flowpay_recovery_private/);
 for(const table of ['cases','approvals','audit_events']){
  assert.match(sql,new RegExp('create table if not exists flowpay_recovery_private\\.'+table+'\\s*\\('));
  assert.match(sql,new RegExp('alter table flowpay_recovery_private\\.'+table+' enable row level security'));
 }
});
test('ordinary client roles are explicitly denied recovery access',()=>{
 assert.match(sql,/revoke all on schema flowpay_recovery_private from public, anon, authenticated/);
 assert.match(sql,/revoke all on all tables in schema flowpay_recovery_private from public, anon, authenticated/);
 assert.match(sql,/revoke all on all sequences in schema flowpay_recovery_private from public, anon, authenticated/);
 assert.doesNotMatch(sql,/grant\s+\w+\s+on\s+(?:all\s+)?tables?\s+.*\s+to\s+(?:anon|authenticated)/);
});
test('audit log is immutable to ordinary updates or deletes',()=>{
 assert.match(sql,/create trigger audit_immutable before update or delete/);
 assert.match(sql,/raise exception 'recovery audit events are append-only'/);
});
test('approval and case lifecycle have database constraints',()=>{
 assert.match(sql,/primary key\(case_id,reviewer_id\)/);
 assert.match(sql,/check \(decision in \('approve','reject'\)\)/);
 assert.match(sql,/check \(status in \(/);
});
