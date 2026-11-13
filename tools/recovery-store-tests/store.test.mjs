import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createOwnerRecoveryStore} from '../../cloudflare/owner-recovery-store.mjs';
import {executeMfaRecovery} from '../../cloudflare/mfa-recovery-executor.mjs';
let db,store;
const owner='owner-control-plane',user='00000000-0000-4000-8000-000000000001',factor='00000000-0000-4000-8000-000000000002';
// PGlite restores a per-query session; explicit identities avoid its RESET
// SESSION AUTHORIZATION compatibility difference from a persistent connection.
const operator=()=>db.exec('set session authorization recovery_test_login;');
const admin=()=>db.exec('set session authorization postgres;');
before(async()=>{
 db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role;create role recovery_test_login;create role unbound_login;');
 await db.exec(fs.readFileSync(new URL('../../docs/owner-recovery-store-draft.sql',import.meta.url),'utf8'));
 await db.exec("grant flowpay_owner_recovery_operator to recovery_test_login,unbound_login;insert into flowpay_owner_recovery_private.owner_binding(db_role,owner_principal,enabled) values('recovery_test_login','owner-control-plane',true);");
 await operator();store=await createOwnerRecoveryStore({query:db.query.bind(db),ownerOperatorId:owner});
});
after(async()=>{await db?.close();});
const open=()=>store.openCase({userId:user,factorIds:[factor],identityMethod:'verified-callback',identityEvidenceRef:'evidence-001',notificationRef:'notice-001',confirmedNoUsableBackupFactor:true});
async function mature(id){
 // Only the isolated fixture's superuser backdates a case. The runtime role has
 // no direct table writes or timestamp parameters, so it cannot skip the wait.
 await admin();await db.query("update flowpay_owner_recovery_private.cases set requested_at=clock_timestamp()-interval '49 hours' where case_id=$1",[id]);await operator();
}
async function ready(){const id=await open();await mature(id);await store.approveCase(id,'approval-'+id);return id;}
async function metadata(id){const r=await store.loadCase(id);return {caseId:id,userId:r.userId,factorIds:r.factorIds,operatorId:owner,approverIds:[owner],recoveryMode:'owner'};}

test('all private tables have RLS and browser/service roles lack schema access',async()=>{
 await admin();
 const tables=await db.query("select bool_and(c.relrowsecurity) as protected,count(*) as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='flowpay_owner_recovery_private' and c.relkind='r'");
 assert.equal(tables.rows[0].protected,true);assert.equal(Number(tables.rows[0].count),4);
 for(const role of ['anon','authenticated','service_role']){
  const r=await db.query("select has_schema_privilege($1,'flowpay_owner_recovery_private','usage') as allowed",[role]);assert.equal(r.rows[0].allowed,false);
  await db.exec('set session authorization '+role);
  await assert.rejects(db.query('select * from flowpay_owner_recovery_private.cases'),/permission denied/);
  await admin();
 }
 await operator();
});
test('unbound DB login cannot impersonate owner even with operator group membership',async()=>{
 await admin();await db.exec('set session authorization unbound_login');
 await assert.rejects(createOwnerRecoveryStore({query:db.query.bind(db),ownerOperatorId:owner}),/unavailable/);
 await operator();await assert.rejects(createOwnerRecoveryStore({query:db.query.bind(db),ownerOperatorId:'other-owner'}),/mismatch/);
});
test('runtime cannot write tables, change owner, bypass the wait or fabricate approvals',async()=>{
 const id=await open();
 await assert.rejects(db.query("update flowpay_owner_recovery_private.cases set requested_at='2000-01-01' where case_id=$1",[id]),/permission denied/);
 await assert.rejects(db.query("update flowpay_owner_recovery_private.owner_binding set owner_principal='other-owner'"),/permission denied/);
 await assert.rejects(store.approveCase(id,'approval-early'),/not eligible/);
 assert.equal(await store.claimRecoveryCase(await metadata(id)),false);
});
test('authoritative case matching rejects tampered target, factors, evidence or approval',async()=>{
 const id=await ready(),r=await store.loadCase(id);
 assert.equal(await store.verifyTrustedCase(r,store.policy),true);
 for(const patch of [{userId:factor},{factorIds:[user]},{identityEvidenceRef:'fabricated-proof'},{notificationRef:'fabricated-notice'},{approvals:[{...r.approvals[0],evidenceRef:'fake-approval'}]}])assert.equal(await store.verifyTrustedCase({...r,...patch},store.policy),false);
});
test('cancelled case cannot be approved or claimed',async()=>{
 const id=await ready();assert.equal(await store.cancelCase(id),true);
 await assert.rejects(store.approveCase(id,'approval-after-cancel'),/not eligible/);
 assert.equal(await store.claimRecoveryCase(await metadata(id)),false);
});
test('stale approval is denied using database time',async()=>{
 const id=await ready();
 // The append-only trigger prevents altering approvals even as the fixture
 // admin. Backdate via a temporary fixture-only trigger disable, then restore.
 await admin();await db.exec('alter table flowpay_owner_recovery_private.approvals disable trigger immutable_approvals');
 await db.query("update flowpay_owner_recovery_private.approvals set approved_at=clock_timestamp()-interval '25 hours' where case_id=$1",[id]);
 await db.exec('alter table flowpay_owner_recovery_private.approvals enable trigger immutable_approvals');await operator();
 assert.equal(await store.claimRecoveryCase(await metadata(id)),false);
});
test('claim is one-time and records durable intent atomically',async()=>{
 const id=await ready(),m=await metadata(id);
 const outcomes=await Promise.all([store.claimRecoveryCase(m),store.claimRecoveryCase(m)]);
 assert.deepEqual(outcomes.sort(),[false,true]);
 await admin();const events=await db.query("select count(*) as n from flowpay_owner_recovery_private.audit_events where case_id=$1 and event_type='recovery_claimed'",[id]);assert.equal(Number(events.rows[0].n),1);await operator();
});
test('wrong target, factor set or owner metadata cannot claim',async()=>{
 const id=await ready(),m=await metadata(id);
 for(const patch of [{userId:factor},{factorIds:[user]},{operatorId:'other-owner'},{approverIds:['other-owner']},{recoveryMode:'two-reviewer'}])assert.equal(await store.claimRecoveryCase({...m,...patch}),false);
});
test('audit insert failure rolls back the case claim in the same transaction',async()=>{
 const id=await ready();
 await admin();
 await db.exec("create function flowpay_owner_recovery_private.test_reject_claim() returns trigger language plpgsql as $$begin if new.event_type='recovery_claimed' then raise exception 'fixture audit unavailable';end if;return new;end$$;create trigger fixture_audit_failure before insert on flowpay_owner_recovery_private.audit_events for each row execute function flowpay_owner_recovery_private.test_reject_claim();");
 await operator();
 try {
  await assert.rejects(store.claimRecoveryCase(await metadata(id)),/fixture audit unavailable/);
  assert.equal((await store.loadCase(id)).status,'pending_approval');
 } finally {
  await admin();await db.exec('drop trigger fixture_audit_failure on flowpay_owner_recovery_private.audit_events;drop function flowpay_owner_recovery_private.test_reject_claim();');await operator();
 }
});
test('event store requires started intent and all factors before completion',async()=>{
 const id=await ready();assert.equal(await store.claimRecoveryCase(await metadata(id)),true);
 await assert.rejects(store.audit({caseId:id,event:'mfa_factor_deleted',factorId:factor}),/intent/);
 await store.audit({caseId:id,event:'mfa_recovery_started'});
 await assert.rejects(store.audit({caseId:id,event:'mfa_recovery_completed'}),/Every reviewed factor/);
 await assert.rejects(store.audit({caseId:id,event:'mfa_factor_deleted',factorId:user}),/Reviewed factor/);
 await store.audit({caseId:id,event:'mfa_factor_deleted',factorId:factor});
 await store.audit({caseId:id,event:'mfa_recovery_completed'});
 assert.equal((await store.loadCase(id)).status,'completed');
 await assert.rejects(store.audit({caseId:id,event:'mfa_recovery_started'}),/Claimed/);
});
test('audit and approval history reject update, delete and truncate',async()=>{
 await admin();
 for(const table of ['audit_events','approvals'])for(const sql of ['update '+table+" set "+(table==='audit_events'?"actor='tampered'":"evidence_ref='tampered'"),'delete from '+table,'truncate '+table]){
  await assert.rejects(db.exec(sql.replaceAll(table,'flowpay_owner_recovery_private.'+table)),/append-only/);
 }
 await operator();
});
test('real store integrates with executor dry-run and simulated reset lifecycle',async()=>{
 const id=await ready(),record=await store.loadCase(id);let deleted=false;
 const options={record,policy:store.policy,...store,verifyOwnerAuthority:async()=>true,
  getVerifiedFactors:async()=>deleted?[]:[{id:factor,status:'verified'}],verifySessionsRevoked:async()=>true,
  admin:{auth:{admin:{mfa:{deleteFactor:async()=>{deleted=true;return {data:{}};}}}}}
 };
 assert.equal((await executeMfaRecovery(options)).status,'dry-run');assert.equal(deleted,false);
 assert.equal((await executeMfaRecovery({...options,dryRun:false})).status,'completed');assert.equal((await store.loadCase(id)).status,'completed');
});
