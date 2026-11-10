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

test('claim is a single conditional update with no privilege escalation',()=>{
 assert.match(sql,/create or replace function flowpay_recovery_private\.claim_case\(/);
 assert.match(sql,/language plpgsql security invoker/);
 assert.match(sql,/set status = 'claimed', claimed_at = now\(\)/);
 assert.match(sql,/status = 'pending_approval'/);
 assert.match(sql,/cancelled_at is null and suspicious_activity = false/);
 assert.match(sql,/requested_at <= now\(\) - interval '48 hours'/);
 assert.match(sql,/count\(distinct reviewer_id\)/);
 assert.match(sql,/get diagnostics claimed_count = row_count/);
 assert.match(sql,/return claimed_count = 1/);
 assert.match(sql,/revoke all on function flowpay_recovery_private\.claim_case\(uuid,uuid,text\) from public, anon, authenticated/);
});

test('atomic claim rejects vetoes and requires fresh distinct approval evidence',()=>{
 assert.match(sql,/not exists \(select 1 from flowpay_recovery_private\.approvals rejected/);
 assert.match(sql,/rejected\.decision = 'reject'/);
 assert.match(sql,/a\.decided_at >= now\(\) - interval '24 hours'/);
 assert.match(sql,/count\(distinct a\.evidence_ref\)/);
});
