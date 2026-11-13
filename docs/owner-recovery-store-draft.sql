-- REVIEW CANDIDATE ONLY. Not applied to Supabase. Requires separately verified
-- control-plane owner authentication and a dedicated server-side DB login.
-- No owner binding or login credential is provisioned by this file.
begin;
create schema flowpay_owner_recovery_private;
revoke all on schema flowpay_owner_recovery_private from public, anon, authenticated, service_role;
alter default privileges in schema flowpay_owner_recovery_private revoke execute on functions from public;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='flowpay_owner_recovery_operator') then
  create role flowpay_owner_recovery_operator nologin nosuperuser nobypassrls;
 end if;
end $$;

create table flowpay_owner_recovery_private.owner_binding (
 singleton boolean primary key default true check(singleton),
 db_role name not null unique,
 owner_principal text not null check(owner_principal ~ '^[A-Za-z0-9._:-]{6,128}$'),
 enabled boolean not null default false
);
create table flowpay_owner_recovery_private.cases (
 case_id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 owner_principal text not null,
 factor_ids uuid[] not null,
 requested_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending_approval' check(status in ('pending_approval','cancelled','claimed','completed','failed')),
 identity_method text not null check(identity_method ~ '^[A-Za-z0-9._:-]{6,128}$' and identity_method not in ('email-only','password-only','flowpay-session-only')),
 identity_evidence_ref text not null check(identity_evidence_ref ~ '^[A-Za-z0-9._:-]{6,128}$'),
 notification_ref text not null check(notification_ref ~ '^[A-Za-z0-9._:-]{6,128}$'),
 notified_at timestamptz not null default clock_timestamp(),
 no_usable_backup boolean not null check(no_usable_backup),
 claimed_at timestamptz,
 closed_at timestamptz
);
create table flowpay_owner_recovery_private.approvals (
 approval_id bigint generated always as identity primary key,
 case_id uuid not null references flowpay_owner_recovery_private.cases(case_id),
 owner_principal text not null,
 evidence_ref text not null check(evidence_ref ~ '^[A-Za-z0-9._:-]{6,128}$'),
 approved_at timestamptz not null default clock_timestamp(),
 unique(case_id,evidence_ref)
);
create index on flowpay_owner_recovery_private.approvals(case_id,approved_at desc,approval_id desc);
create table flowpay_owner_recovery_private.audit_events (
 event_id bigint generated always as identity primary key,
 case_id uuid not null references flowpay_owner_recovery_private.cases(case_id),
 actor text not null,
 event_type text not null check(event_type in ('case_opened','owner_approved','case_cancelled','recovery_claimed','mfa_recovery_started','mfa_factor_deleted','mfa_recovery_completed','mfa_recovery_failed')),
 factor_id uuid,
 error_code text check(error_code is null or error_code='OPERATION_FAILED'),
 event_at timestamptz not null default clock_timestamp(),
 check((event_type='mfa_factor_deleted')=(factor_id is not null))
);
create index on flowpay_owner_recovery_private.audit_events(case_id,event_id);
create unique index recovery_single_event on flowpay_owner_recovery_private.audit_events(case_id,event_type)
 where event_type in ('recovery_claimed','mfa_recovery_started','mfa_recovery_completed','mfa_recovery_failed');
create unique index recovery_single_factor_event on flowpay_owner_recovery_private.audit_events(case_id,factor_id)
 where event_type='mfa_factor_deleted';

alter table flowpay_owner_recovery_private.owner_binding enable row level security;
alter table flowpay_owner_recovery_private.cases enable row level security;
alter table flowpay_owner_recovery_private.approvals enable row level security;
alter table flowpay_owner_recovery_private.audit_events enable row level security;
revoke all on all tables in schema flowpay_owner_recovery_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema flowpay_owner_recovery_private from public, anon, authenticated, service_role;

create function flowpay_owner_recovery_private.current_owner() returns text
language plpgsql security definer set search_path='' as $$
declare principal text;
begin
 select owner_principal into principal from flowpay_owner_recovery_private.owner_binding
 where singleton and enabled and db_role=session_user;
 if principal is null then raise exception 'Owner recovery is unavailable'; end if;
 return principal;
end $$;

create function flowpay_owner_recovery_private.immutable_record() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Recovery record is append-only'; end $$;
create trigger immutable_audit before update or delete or truncate on flowpay_owner_recovery_private.audit_events
for each statement execute function flowpay_owner_recovery_private.immutable_record();
create trigger immutable_approvals before update or delete or truncate on flowpay_owner_recovery_private.approvals
for each statement execute function flowpay_owner_recovery_private.immutable_record();

create function flowpay_owner_recovery_private.open_case(
 p_user uuid,p_factors uuid[],p_method text,p_evidence text,p_notification text,p_no_backup boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor text:=flowpay_owner_recovery_private.current_owner(); result uuid;
begin
 if p_user is null or cardinality(p_factors) is null or cardinality(p_factors)<1
 or array_position(p_factors,null) is not null
 or (select count(distinct f) from unnest(p_factors) f)<>cardinality(p_factors) then
  raise exception 'Unique reviewed factors required';
 end if;
 insert into flowpay_owner_recovery_private.cases(user_id,owner_principal,factor_ids,identity_method,identity_evidence_ref,notification_ref,no_usable_backup)
 values(p_user,actor,p_factors,p_method,p_evidence,p_notification,p_no_backup) returning case_id into result;
 insert into flowpay_owner_recovery_private.audit_events(case_id,actor,event_type) values(result,actor,'case_opened');
 return result;
end $$;

create function flowpay_owner_recovery_private.approve_case(p_case uuid,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare actor text:=flowpay_owner_recovery_private.current_owner(); item flowpay_owner_recovery_private.cases;
begin
 select * into item from flowpay_owner_recovery_private.cases where case_id=p_case and owner_principal=actor for update;
 if not found or item.status<>'pending_approval' or item.requested_at>clock_timestamp()-interval '48 hours' then
  raise exception 'Case is not eligible for owner approval';
 end if;
 insert into flowpay_owner_recovery_private.approvals(case_id,owner_principal,evidence_ref) values(p_case,actor,p_evidence);
 insert into flowpay_owner_recovery_private.audit_events(case_id,actor,event_type) values(p_case,actor,'owner_approved');
end $$;

create function flowpay_owner_recovery_private.cancel_case(p_case uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor text:=flowpay_owner_recovery_private.current_owner(); changed integer;
begin
 update flowpay_owner_recovery_private.cases set status='cancelled',closed_at=clock_timestamp()
 where case_id=p_case and owner_principal=actor and status='pending_approval';
 get diagnostics changed=row_count;
 if changed=1 then insert into flowpay_owner_recovery_private.audit_events(case_id,actor,event_type) values(p_case,actor,'case_cancelled'); end if;
 return changed=1;
end $$;

create function flowpay_owner_recovery_private.claim_case(p_case uuid,p_user uuid,p_factors uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
declare actor text:=flowpay_owner_recovery_private.current_owner(); changed integer; at_time timestamptz:=clock_timestamp();
begin
 update flowpay_owner_recovery_private.cases c set status='claimed',claimed_at=at_time
 where c.case_id=p_case and c.user_id=p_user and c.owner_principal=actor and c.status='pending_approval'
 and c.factor_ids @> p_factors and c.factor_ids <@ p_factors and cardinality(c.factor_ids)=cardinality(p_factors)
 and c.requested_at<=at_time-interval '48 hours' and c.notified_at<=at_time
 and exists(select 1 from flowpay_owner_recovery_private.approvals a where a.case_id=c.case_id and a.owner_principal=actor
  and a.approved_at>=c.requested_at and a.approved_at>=at_time-interval '24 hours' and a.approved_at<=at_time);
 get diagnostics changed=row_count;
 if changed=1 then insert into flowpay_owner_recovery_private.audit_events(case_id,actor,event_type) values(p_case,actor,'recovery_claimed'); end if;
 return changed=1;
end $$;

create function flowpay_owner_recovery_private.append_event(p_case uuid,p_event text,p_factor uuid default null,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare actor text:=flowpay_owner_recovery_private.current_owner(); item flowpay_owner_recovery_private.cases;
begin
 select * into item from flowpay_owner_recovery_private.cases where case_id=p_case and owner_principal=actor for update;
 if not found or item.status<>'claimed' then raise exception 'Claimed recovery case required'; end if;
 if p_event not in ('mfa_recovery_started','mfa_factor_deleted','mfa_recovery_completed','mfa_recovery_failed') or p_event is null then
  raise exception 'Invalid recovery event';
 end if;
 if p_event<>'mfa_recovery_started' and not exists(select 1 from flowpay_owner_recovery_private.audit_events where case_id=p_case and event_type='mfa_recovery_started') then
  raise exception 'Durable recovery intent required';
 end if;
 if p_event='mfa_factor_deleted' and (p_factor is null or not p_factor=any(item.factor_ids)) then
  raise exception 'Reviewed factor required';
 end if;
 if p_event='mfa_recovery_completed' and (select count(distinct factor_id) from flowpay_owner_recovery_private.audit_events where case_id=p_case and event_type='mfa_factor_deleted')<>cardinality(item.factor_ids) then
  raise exception 'Every reviewed factor must be accounted for';
 end if;
 insert into flowpay_owner_recovery_private.audit_events(case_id,actor,event_type,factor_id,error_code) values(p_case,actor,p_event,p_factor,p_error);
 if p_event in ('mfa_recovery_completed','mfa_recovery_failed') then
  update flowpay_owner_recovery_private.cases set status=case when p_event='mfa_recovery_completed' then 'completed' else 'failed' end,closed_at=clock_timestamp() where case_id=p_case;
 end if;
end $$;

create function flowpay_owner_recovery_private.read_case(p_case uuid)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
 'caseId',c.case_id,'userId',c.user_id,'operatorId',c.owner_principal,'factorIds',c.factor_ids,
 'identityVerified',true,'identityMethod',c.identity_method,'identityEvidenceRef',c.identity_evidence_ref,
 'requestedAt',c.requested_at,'status',c.status,'confirmedNoUsableBackupFactor',c.no_usable_backup,
 'userNotified',true,'notificationRef',c.notification_ref,'revokeAllSessions',true,'requireFreshMfaEnrollment',true,
 'approvals',coalesce((select jsonb_agg(jsonb_build_object('approverId',a.owner_principal,'approved',true,'evidenceRef',a.evidence_ref,'approvedAt',a.approved_at))
 from (select * from flowpay_owner_recovery_private.approvals where case_id=c.case_id order by approved_at desc,approval_id desc limit 1) a),'[]'::jsonb))
 from flowpay_owner_recovery_private.cases c
 where c.case_id=p_case and c.owner_principal=flowpay_owner_recovery_private.current_owner();
$$;

revoke all on all functions in schema flowpay_owner_recovery_private from public,anon,authenticated,service_role;
grant usage on schema flowpay_owner_recovery_private to flowpay_owner_recovery_operator;
grant execute on function flowpay_owner_recovery_private.current_owner(),
 flowpay_owner_recovery_private.open_case(uuid,uuid[],text,text,text,boolean),
 flowpay_owner_recovery_private.approve_case(uuid,text),
 flowpay_owner_recovery_private.cancel_case(uuid),
 flowpay_owner_recovery_private.claim_case(uuid,uuid,uuid[]),
 flowpay_owner_recovery_private.append_event(uuid,text,uuid,text),
 flowpay_owner_recovery_private.read_case(uuid) to flowpay_owner_recovery_operator;
commit;
