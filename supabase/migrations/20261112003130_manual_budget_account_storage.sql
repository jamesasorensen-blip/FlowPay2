create table public.manual_budgets (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{}'::jsonb,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 constraint manual_budget_object check (jsonb_typeof(data) = 'object'),
 constraint manual_budget_size check (octet_length(data::text) <= 1048576)
);
alter table public.manual_budgets enable row level security;
revoke all on public.manual_budgets from anon, public;
grant select, insert, update on public.manual_budgets to authenticated;
create policy manual_budget_read on public.manual_budgets for select to authenticated
 using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy manual_budget_insert on public.manual_budgets for insert to authenticated
 with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy manual_budget_update on public.manual_budgets for update to authenticated
 using (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2')
 with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create function public.save_manual_budget(expected_revision bigint, budget_data jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare result_revision bigint;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
  raise exception 'MFA verification required' using errcode = '42501';
 end if;
 if expected_revision < 0 or expected_revision is null then
  raise exception 'Invalid revision' using errcode = '22023';
 end if;
 if expected_revision = 0 then
  insert into public.manual_budgets(owner_id,data,revision)
  values(auth.uid(),budget_data,1)
  on conflict (owner_id) do nothing returning revision into result_revision;
 else
  update public.manual_budgets set data=budget_data,revision=revision+1,updated_at=now()
  where owner_id=auth.uid() and revision=expected_revision
  returning revision into result_revision;
 end if;
 if result_revision is null then
  raise exception 'Budget changed on another device. Reload before saving.' using errcode='40001';
 end if;
 return result_revision;
end;
$$;
revoke all on function public.save_manual_budget(bigint,jsonb) from public, anon;
grant execute on function public.save_manual_budget(bigint,jsonb) to authenticated;

