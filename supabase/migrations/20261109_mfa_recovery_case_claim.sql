-- REVIEW ONLY. Do not apply to the shared production/staging Supabase database
-- until recovery authorization, access policies, and operational runbook are approved.
-- Run from a privileged migration role, never from a browser client.
begin;

create schema if not exists flowpay_security;
revoke all on schema flowpay_security from public, anon, authenticated;
revoke all on schema flowpay_security from service_role;

create table if not exists flowpay_security.mfa_recovery_cases (
  case_id text primary key,
  user_id uuid not null,
  operator_id text not null,
  approval_digest text not null,
  status text not null default 'approved'
    check (status in ('approved', 'claimed', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create table if not exists flowpay_security.mfa_recovery_audit (
  audit_id bigint generated always as identity primary key,
  case_id text not null,
  event_type text not null,
  actor_id text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

revoke all on all tables in schema flowpay_security from public, anon, authenticated, service_role;
revoke all on all sequences in schema flowpay_security from public, anon, authenticated, service_role;

-- Privileged recovery backend invokes this inside a transaction, after verifying
-- independent identity evidence and both distinct approvers in trusted storage.
-- Never expose this function via a public PostgREST schema or to client roles.
create or replace function flowpay_security.claim_mfa_recovery(
  p_case_id text,
  p_user_id uuid,
  p_operator_id text,
  p_approval_digest text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_claimed text;
begin
  update flowpay_security.mfa_recovery_cases
     set status = 'claimed', claimed_at = now()
   where case_id = p_case_id
     and user_id = p_user_id
     and operator_id = p_operator_id
     and approval_digest = p_approval_digest
     and status = 'approved'
  returning case_id into v_claimed;
  return v_claimed is not null;
end;
$$;

revoke all on function flowpay_security.claim_mfa_recovery(text, uuid, text, text)
  from public, anon, authenticated, service_role;

-- Operational backend must have a separate least-privilege database role and
-- durable, append-only audit permissions. Do not grant client-side write access.
commit;
