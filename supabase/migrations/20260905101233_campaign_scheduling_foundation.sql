-- Additive only. Never changes financial tables, historical rows, views or RPCs.
create table public.automation_accounts (
  account_id text primary key references public.dashboard_accounts(meta_account_id),
  connection_state text not null default 'pending' check(connection_state in ('pending','ready','error','unavailable')),
  execution_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_worker_at timestamptz,
  updated_at timestamptz not null default now(),
  check(not execution_enabled or connection_state='ready')
);
create table public.automation_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null references public.automation_accounts(account_id),
  primary key(user_id,account_id)
);
create index automation_members_account_idx on public.automation_members(account_id);
create table public.automation_campaigns (
  account_id text not null references public.automation_accounts(account_id),
  campaign_id text not null check(campaign_id ~ '^[0-9]+$'),
  name text not null check(length(name) between 1 and 1000),
  status text not null,
  effective_status text not null,
  present boolean not null default true,
  seen_at timestamptz not null default now(),
  primary key(account_id,campaign_id)
);
create table public.automation_schedules (
  account_id text not null,
  campaign_id text not null,
  enabled boolean not null default false,
  start_time time(0) not null default '00:01',
  end_time time(0) not null default '09:00',
  weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  timezone text not null default 'America/Sao_Paulo' check(timezone='America/Sao_Paulo'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(account_id,campaign_id),
  foreign key(account_id,campaign_id) references public.automation_campaigns(account_id,campaign_id),
  check(start_time < end_time),
  check(extract(second from start_time)=0 and extract(second from end_time)=0),
  check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]::smallint[] and array_position(weekdays,null) is null)
);
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  campaign_id text not null,
  revision bigint not null,
  window_key text not null,
  desired_status text not null check(desired_status in ('ACTIVE','PAUSED')),
  status text not null default 'running' check(status in ('running','succeeded','failed','skipped')),
  attempts integer not null default 1,
  lease_token uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default now()+interval '90 seconds',
  retry_at timestamptz,
  previous_status text,
  confirmed_status text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(account_id,campaign_id) references public.automation_schedules(account_id,campaign_id),
  unique(account_id,campaign_id,revision,window_key)
);
create index automation_runs_history_idx on public.automation_runs(account_id,updated_at desc);
create index automation_runs_campaign_idx on public.automation_runs(account_id,campaign_id,status,lease_until);

alter table public.automation_accounts enable row level security;
alter table public.automation_members enable row level security;
alter table public.automation_campaigns enable row level security;
alter table public.automation_schedules enable row level security;
alter table public.automation_runs enable row level security;

revoke all on public.automation_accounts,public.automation_members,public.automation_campaigns,
  public.automation_schedules,public.automation_runs from public,anon,authenticated;
grant all on public.automation_accounts,public.automation_members,public.automation_campaigns,
  public.automation_schedules,public.automation_runs to service_role;
grant select on public.automation_accounts,public.automation_campaigns to anon,authenticated;
grant select on public.automation_members,public.automation_runs,public.automation_schedules to authenticated;
grant insert,update on public.automation_schedules to authenticated;

create policy automation_account_read on public.automation_accounts for select to anon,authenticated
  using(account_id in(select meta_account_id from public.dashboard_accounts where enabled));
create policy automation_catalog_read on public.automation_campaigns for select to anon,authenticated
  using(account_id in(select meta_account_id from public.dashboard_accounts where enabled));
create policy automation_member_self on public.automation_members for select to authenticated
  using(user_id=(select auth.uid()));
create policy automation_schedule_read on public.automation_schedules for select to authenticated
  using(account_id in(select account_id from public.automation_members where user_id=(select auth.uid())));
create policy automation_schedule_insert on public.automation_schedules for insert to authenticated
  with check(account_id in(select account_id from public.automation_members where user_id=(select auth.uid())));
create policy automation_schedule_update on public.automation_schedules for update to authenticated
  using(account_id in(select account_id from public.automation_members where user_id=(select auth.uid())))
  with check(account_id in(select account_id from public.automation_members where user_id=(select auth.uid())));
create policy automation_run_read on public.automation_runs for select to authenticated
  using(account_id in(select account_id from public.automation_members where user_id=(select auth.uid())));

create function public.automation_guard_schedule() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.account_id<>old.account_id or new.campaign_id<>old.campaign_id) then
    raise exception 'A regra não pode mudar de conta ou campanha.';
  end if;
  if cardinality(new.weekdays)<>(select count(distinct day) from unnest(new.weekdays) day) then
    raise exception 'Dias da semana repetidos.';
  end if;
  if new.enabled and not exists(select 1 from public.automation_accounts a
    join public.automation_campaigns c on c.account_id=a.account_id
    where a.account_id=new.account_id and c.campaign_id=new.campaign_id
      and a.connection_state='ready' and a.execution_enabled and c.present
      and c.status in('ACTIVE','PAUSED')) then
    raise exception 'Conexão pendente ou campanha indisponível para automação.';
  end if;
  new.revision := case when tg_op='UPDATE' then old.revision+1 else 1 end;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.automation_guard_schedule() from public,anon,authenticated;
create trigger automation_schedule_guard before insert or update on public.automation_schedules
  for each row execute function public.automation_guard_schedule();

-- Only the worker service role can claim/finish attempts. Invoker rights preserve
-- privilege boundaries; these functions do not elevate a visitor's permissions.
create function public.automation_claim_run(p_account_id text,p_campaign_id text,p_revision bigint,p_window_key text,p_desired_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.automation_runs;
begin
  if p_desired_status not in('ACTIVE','PAUSED') or p_window_key !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
    raise exception 'Transição inválida';
  end if;
  -- Serialize across revisions and opposite statuses, not just identical requests.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id||':'||p_campaign_id,0));
  if not exists(select 1 from public.automation_schedules s
    join public.automation_accounts a on a.account_id=s.account_id
    join public.dashboard_accounts d on d.meta_account_id=a.account_id
    where s.account_id=p_account_id and s.campaign_id=p_campaign_id
      and s.revision=p_revision and s.enabled and a.execution_enabled
      and a.connection_state='ready' and d.enabled) then return null; end if;
  if exists(select 1 from public.automation_runs r where r.account_id=p_account_id
    and r.campaign_id=p_campaign_id and r.status='running' and r.lease_until>now()) then return null; end if;
  insert into public.automation_runs(account_id,campaign_id,revision,window_key,desired_status)
    values(p_account_id,p_campaign_id,p_revision,p_window_key,p_desired_status)
    on conflict(account_id,campaign_id,revision,window_key) do update set
      status='running',attempts=automation_runs.attempts+1,lease_token=gen_random_uuid(),
      lease_until=now()+interval '90 seconds',updated_at=now(),error_code=null
    where automation_runs.attempts<3 and (
      (automation_runs.status='failed' and automation_runs.retry_at<=now()) or
      (automation_runs.status='running' and automation_runs.lease_until<=now()))
    returning * into result;
  return case when result.id is null then null else to_jsonb(result) end;
end;
$$;
revoke all on function public.automation_claim_run(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.automation_claim_run(text,text,bigint,text,text) to service_role;

create function public.automation_finish_run(p_id uuid,p_lease_token uuid,p_status text,p_previous_status text default null,p_confirmed_status text default null,p_error_code text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_status not in('succeeded','failed','skipped') then raise exception 'Status inválido'; end if;
  update public.automation_runs set status=p_status,previous_status=p_previous_status,
    confirmed_status=p_confirmed_status,error_code=left(p_error_code,100),
    retry_at=case when p_status='failed' then now()+make_interval(secs=>60*attempts) else null end,
    updated_at=now()
    where id=p_id and lease_token=p_lease_token and status='running' and lease_until>now();
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.automation_finish_run(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.automation_finish_run(uuid,uuid,text,text,text,text) to service_role;

-- Replace only this separate operational catalog, after all API pages succeed.
create function public.automation_replace_catalog(p_account_id text,p_campaigns jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare amount integer;
begin
  if jsonb_typeof(p_campaigns)<>'array' then raise exception 'Catálogo inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:'||p_account_id,0));
  if not exists(select 1 from public.dashboard_accounts where meta_account_id=p_account_id and enabled) then
    raise exception 'Conta indisponível';
  end if;
  update public.automation_campaigns set present=false where account_id=p_account_id;
  insert into public.automation_campaigns(account_id,campaign_id,name,status,effective_status,present,seen_at)
    select p_account_id,c.id,c.name,c.status,c.effective_status,true,now()
    from jsonb_to_recordset(p_campaigns) as c(id text,name text,status text,effective_status text)
    on conflict(account_id,campaign_id) do update set name=excluded.name,status=excluded.status,
      effective_status=excluded.effective_status,present=true,seen_at=now();
  get diagnostics amount=row_count;
  update public.automation_accounts set last_sync_at=now(),updated_at=now() where account_id=p_account_id;
  return amount;
end;
$$;
revoke all on function public.automation_replace_catalog(text,jsonb) from public,anon,authenticated;
grant execute on function public.automation_replace_catalog(text,jsonb) to service_role;

insert into public.automation_accounts(account_id)
  select meta_account_id from public.dashboard_accounts where enabled;

-- Infrastructure is installed but the job is explicitly inactive in this release.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('dashnave-campaign-scheduler','* * * * *', $cron$
  select net.http_post(
    url:='https://akffepitbqqqgldxvtlf.supabase.co/functions/v1/campaign-scheduler',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||s.decrypted_secret),
    body:='{"operation":"run"}'::jsonb,timeout_milliseconds:=120000
  ) from vault.decrypted_secrets s
  where s.name='dashnave_automation_cron_secret'
    and exists(select 1 from public.automation_accounts where execution_enabled and connection_state='ready');
$cron$);
select cron.alter_job(job_id:=jobid,active:=false)
  from cron.job where jobname='dashnave-campaign-scheduler';

comment on table public.automation_schedules is 'Isolated campaign schedules. Financial data and reporting timezones remain unchanged.';
comment on table public.automation_runs is 'Sanitized attempt log: no Meta tokens, request headers or raw API errors.';
