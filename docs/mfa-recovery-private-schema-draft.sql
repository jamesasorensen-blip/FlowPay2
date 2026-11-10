-- FlowPay MFA recovery persistence DESIGN ONLY. Do not apply to the shared
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
commit;
