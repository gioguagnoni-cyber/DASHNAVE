create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

create table if not exists public.automation_accounts (
  account_id text primary key references public.dashboard_accounts(meta_account_id) on delete restrict,
  display_name text not null,
  currency text not null default 'USD',
  timezone text not null default 'America/Sao_Paulo',
  connection_state text not null default 'pending' check (connection_state in ('pending','ready','error')),
  execution_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_worker_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_only_dizz_usd check (account_id = '2948780535467215')
);

create table if not exists public.automation_members (
  account_id text not null references public.automation_accounts(account_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (account_id,user_id)
);

create table if not exists public.automation_campaigns (
  account_id text not null references public.automation_accounts(account_id) on delete cascade,
  campaign_id text not null,
  name text not null,
  status text,
  effective_status text,
  daily_budget_cents bigint,
  budget_model text not null default 'campaign' check (budget_model in ('campaign','unsupported')),
  seen_at timestamptz not null default now(),
  primary key (account_id,campaign_id),
  constraint automation_campaign_id_digits check (campaign_id ~ '^[0-9]+$'),
  constraint automation_budget_positive check (daily_budget_cents is null or daily_budget_cents > 0)
);

create table if not exists public.automation_budget_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.automation_accounts(account_id) on delete restrict,
  campaign_id text not null,
  campaign_name text not null,
  execute_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  change_mode text not null check (change_mode in ('percent','fixed')),
  change_percent numeric(7,2),
  target_budget_cents bigint,
  base_budget_cents bigint,
  applied_budget_cents bigint,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','cancelled')),
  revision integer not null default 1 check (revision > 0),
  lease_token uuid,
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  created_by uuid not null references auth.users(id),
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_schedule_campaign_fk foreign key (account_id,campaign_id)
    references public.automation_campaigns(account_id,campaign_id) on delete restrict,
  constraint automation_schedule_value check (
    (change_mode='percent' and change_percent between 1 and 500 and target_budget_cents is null)
    or (change_mode='fixed' and change_percent is null and target_budget_cents >= 100)
  ),
  constraint automation_schedule_only_dizz check (account_id='2948780535467215')
);

create unique index if not exists automation_one_pending_change
  on public.automation_budget_schedules(account_id,campaign_id,execute_at)
  where status in ('pending','running');
create index if not exists automation_due_changes
  on public.automation_budget_schedules(status,execute_at)
  where status in ('pending','running');

create table if not exists public.automation_budget_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.automation_budget_schedules(id) on delete cascade,
  account_id text not null,
  campaign_id text not null,
  attempt integer not null,
  lease_token uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  before_budget_cents bigint,
  requested_budget_cents bigint,
  confirmed_budget_cents bigint,
  outcome text not null default 'running' check (outcome in ('running','succeeded','failed')),
  error_code text,
  provider_reference text,
  unique (schedule_id,attempt)
);

create or replace function private.automation_has_role(p_account_id text,p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog,public
as $$
  select exists(
    select 1 from public.automation_members m
    where m.account_id=p_account_id and m.user_id=auth.uid() and m.role=any(p_roles)
  );
$$;
revoke all on function private.automation_has_role(text,text[]) from public,anon;
grant execute on function private.automation_has_role(text,text[]) to authenticated,service_role;

alter table public.automation_accounts enable row level security;
alter table public.automation_members enable row level security;
alter table public.automation_campaigns enable row level security;
alter table public.automation_budget_schedules enable row level security;
alter table public.automation_budget_runs enable row level security;

drop policy if exists automation_accounts_read on public.automation_accounts;
create policy automation_accounts_read on public.automation_accounts for select to authenticated
using (private.automation_has_role(account_id,array['owner','editor','viewer']));
drop policy if exists automation_members_read_self on public.automation_members;
create policy automation_members_read_self on public.automation_members for select to authenticated
using (user_id=auth.uid());
drop policy if exists automation_campaigns_read on public.automation_campaigns;
create policy automation_campaigns_read on public.automation_campaigns for select to authenticated
using (private.automation_has_role(account_id,array['owner','editor','viewer']));
drop policy if exists automation_schedules_read on public.automation_budget_schedules;
create policy automation_schedules_read on public.automation_budget_schedules for select to authenticated
using (private.automation_has_role(account_id,array['owner','editor','viewer']));
drop policy if exists automation_schedules_insert on public.automation_budget_schedules;
create policy automation_schedules_insert on public.automation_budget_schedules for insert to authenticated
with check (
  created_by=auth.uid()
  and private.automation_has_role(account_id,array['owner','editor'])
  and execute_at > now()
  and status='pending'
);
drop policy if exists automation_schedules_cancel on public.automation_budget_schedules;
create policy automation_schedules_cancel on public.automation_budget_schedules for update to authenticated
using (status='pending' and private.automation_has_role(account_id,array['owner','editor']))
with check (status='cancelled' and cancelled_by=auth.uid() and cancelled_at is not null);
drop policy if exists automation_runs_read on public.automation_budget_runs;
create policy automation_runs_read on public.automation_budget_runs for select to authenticated
using (private.automation_has_role(account_id,array['owner','editor','viewer']));

revoke all on public.automation_accounts,public.automation_members,public.automation_campaigns,
  public.automation_budget_schedules,public.automation_budget_runs from anon;
grant select on public.automation_accounts,public.automation_members,public.automation_campaigns,
  public.automation_budget_schedules,public.automation_budget_runs to authenticated;
grant insert,update on public.automation_budget_schedules to authenticated;
grant all on public.automation_accounts,public.automation_members,public.automation_campaigns,
  public.automation_budget_schedules,public.automation_budget_runs to service_role;

create or replace function public.automation_claim_budget_schedule(p_schedule_id uuid,p_lease_token uuid)
returns public.automation_budget_schedules
language plpgsql
security invoker
set search_path = pg_catalog,public
as $$
declare v_row public.automation_budget_schedules;
begin
  update public.automation_budget_schedules
  set status='running',lease_token=p_lease_token,lease_until=now()+interval '3 minutes',
      attempt_count=attempt_count+1,error_code=null,updated_at=now()
  where id=p_schedule_id
    and execute_at<=now()
    and (status='pending' or (status='running' and lease_until<now()))
  returning * into v_row;
  if v_row.id is null then return null; end if;
  insert into public.automation_budget_runs(schedule_id,account_id,campaign_id,attempt,lease_token)
  values(v_row.id,v_row.account_id,v_row.campaign_id,v_row.attempt_count,p_lease_token);
  return v_row;
end;
$$;
revoke all on function public.automation_claim_budget_schedule(uuid,uuid) from public,anon,authenticated;
grant execute on function public.automation_claim_budget_schedule(uuid,uuid) to service_role;

create or replace function public.automation_finish_budget_schedule(
  p_schedule_id uuid,p_lease_token uuid,p_succeeded boolean,p_before bigint,
  p_requested bigint,p_confirmed bigint,p_error_code text default null,p_provider_reference text default null
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog,public
as $$
declare v_changed integer;
begin
  update public.automation_budget_runs
  set finished_at=now(),before_budget_cents=p_before,requested_budget_cents=p_requested,
      confirmed_budget_cents=p_confirmed,outcome=case when p_succeeded then 'succeeded' else 'failed' end,
      error_code=p_error_code,provider_reference=p_provider_reference
  where schedule_id=p_schedule_id and lease_token=p_lease_token and outcome='running';
  update public.automation_budget_schedules
  set status=case when p_succeeded then 'succeeded' else 'failed' end,
      base_budget_cents=p_before,applied_budget_cents=p_confirmed,error_code=p_error_code,
      lease_token=null,lease_until=null,updated_at=now()
  where id=p_schedule_id and lease_token=p_lease_token and status='running';
  get diagnostics v_changed=row_count;
  return v_changed=1;
end;
$$;
revoke all on function public.automation_finish_budget_schedule(uuid,uuid,boolean,bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.automation_finish_budget_schedule(uuid,uuid,boolean,bigint,bigint,bigint,text,text) to service_role;

insert into public.automation_accounts(account_id,display_name,currency,timezone,connection_state,execution_enabled)
select meta_account_id,display_name,currency,timezone,'pending',false
from public.dashboard_accounts where meta_account_id='2948780535467215'
on conflict(account_id) do update set
  display_name=excluded.display_name,currency=excluded.currency,timezone=excluded.timezone,updated_at=now();

comment on table public.automation_budget_schedules is 'Mudancas de orcamento agendadas; isoladas dos dados financeiros da dashboard.';
comment on column public.automation_accounts.execution_enabled is 'Trava operacional: habilitar somente depois de validar usuario, token Meta e worker.';
