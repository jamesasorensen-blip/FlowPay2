-- FlowPay MFA recovery persistence DESIGN ONLY. Do not apply to the shared
-- LEGACY TWO-REVIEWER DRAFT: incompatible with owner-managed recovery selected
-- on 2026-11-13. See docs/security/MFA_OWNER_RECOVERY.md. Do not apply for owner mode.
-- Supabase project until reviewer identity, case intake, and operations are staffed.
-- Tables are deliberately in a non-exposed private schema with no client grants.
begin;
create schema if not exists flowpay_recovery_private;
revoke all on schema flowpay_recovery_private from public, anon, authenticated;
create table if not exists flowpay_recovery_private.cases (
 case_id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 requested_at timestamptz not null default now(),
 status text not null default 'pending_identity_verification'
   check (status in ('pending_identity_verification','pending_approval','cancelled','escalated','claimed','completed','failed')),
 identity_method text,
 identity_evidence_ref text,
 identity_verified_at timestamptz,
 requester_ref text not null,
 notification_ref text,
 notification_sent_at timestamptz,
 cancelled_at timestamptz,
 suspicious_activity boolean not null default false,
 claimed_at timestamptz,
 completed_at timestamptz,
 unique(case_id,user_id)
);
create table if not exists flowpay_recovery_private.approvals (
 case_id uuid not null references flowpay_recovery_private.cases(case_id),
 reviewer_id uuid not null,
 decision text not null check (decision in ('approve','reject')),
 evidence_ref text not null,
 decided_at timestamptz not null default now(),
 primary key(case_id,reviewer_id)
);
create table if not exists flowpay_recovery_private.audit_events (
 event_id bigint generated always as identity primary key,
 case_id uuid not null references flowpay_recovery_private.cases(case_id),
 event_type text not null,
 actor_id text not null,
 event_at timestamptz not null default now(),
 details jsonb not null default '{}'::jsonb
);
alter table flowpay_recovery_private.cases enable row level security;
alter table flowpay_recovery_private.approvals enable row level security;
alter table flowpay_recovery_private.audit_events enable row level security;
revoke all on all tables in schema flowpay_recovery_private from public, anon, authenticated;
revoke all on all sequences in schema flowpay_recovery_private from public, anon, authenticated;
-- Append-only audit: prevent UPDATE/DELETE even for accidental application-role grants.
create or replace function flowpay_recovery_private.reject_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
 raise exception 'Recovery audit events are append-only';
end;
$$;
revoke all on function flowpay_recovery_private.reject_audit_mutation() from public, anon, authenticated;
drop trigger if exists audit_immutable on flowpay_recovery_private.audit_events;
create trigger audit_immutable before update or delete
on flowpay_recovery_private.audit_events
for each row execute function flowpay_recovery_private.reject_audit_mutation();

-- Atomic, one-time case claim for a dedicated privileged database operator.
-- This function is SECURITY INVOKER: it does not elevate privileges.
-- Caller must have narrowly scoped UPDATE permission on cases, and no browser
-- role may execute this function or update recovery tables.
create or replace function flowpay_recovery_private.claim_case(
 p_case_id uuid, p_user_id uuid, p_operator_ref text
) returns boolean
language plpgsql security invoker set search_path = '' as $
declare claimed_count integer;
begin
 if p_operator_ref is null or length(trim(p_operator_ref)) < 6 then
  return false;
 end if;
 update flowpay_recovery_private.cases
 set status = 'claimed', claimed_at = now()
 where case_id = p_case_id and user_id = p_user_id
   and status = 'pending_approval'
   and cancelled_at is null and suspicious_activity = false
   and requested_at <= now() - interval '48 hours'
   and identity_verified_at is not null
   and notification_sent_at is not null
   and not exists (select 1 from flowpay_recovery_private.approvals rejected where rejected.case_id = p_case_id and rejected.decision = 'reject')
   and (select count(distinct reviewer_id)
        from flowpay_recovery_private.approvals a
        where a.case_id = p_case_id and a.decision = 'approve'
          and a.decided_at >= (select c.requested_at from flowpay_recovery_private.cases c where c.case_id = p_case_id)
          and a.decided_at <= now()
          and a.decided_at >= now() - interval '24 hours'
          and a.evidence_ref is not null and length(trim(a.evidence_ref)) >= 6) >= 2
   and (select count(distinct a.evidence_ref)
        from flowpay_recovery_private.approvals a
        where a.case_id = p_case_id and a.decision = 'approve'
          and a.decided_at >= now() - interval '24 hours') >= 2;
 get diagnostics claimed_count = row_count;
 return claimed_count = 1;
end;
$;
revoke all on function flowpay_recovery_private.claim_case(uuid,uuid,text) from public, anon, authenticated;

commit;
