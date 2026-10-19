create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists private.automation_runtime (
  singleton boolean primary key default true check (singleton),
  cron_secret_hash bytea not null,
  updated_at timestamptz not null default now()
);
revoke all on private.automation_runtime from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update on private.automation_runtime to service_role;

do $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='automation_cron_secret' limit 1;
  if v_secret is null then
    v_secret:=encode(gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'automation_cron_secret','DASHFULL campaign scheduler cron authentication');
  end if;
  insert into private.automation_runtime(singleton,cron_secret_hash,updated_at)
  values(true,digest(v_secret,'sha256'),now())
  on conflict(singleton) do update set cron_secret_hash=excluded.cron_secret_hash,updated_at=now();
  if not exists(select 1 from vault.secrets where name='automation_project_url') then
    perform vault.create_secret('https://akffepitbqqqgldxvtlf.supabase.co','automation_project_url','Supabase project URL for the budget scheduler');
  end if;
end $$;

create or replace function public.automation_verify_cron_secret(p_secret text)
returns boolean language sql stable security invoker
set search_path=pg_catalog,public,private,extensions
as $$
  select coalesce(digest(coalesce(p_secret,''),'sha256')=(select cron_secret_hash from private.automation_runtime where singleton),false);
$$;
revoke all on function public.automation_verify_cron_secret(text) from public,anon,authenticated;
grant execute on function public.automation_verify_cron_secret(text) to service_role;

create or replace function public.automation_cron_ready()
returns boolean language sql stable security invoker
set search_path=pg_catalog,public,private
as $$
  select exists(select 1 from cron.job where jobname='dashfull-budget-worker')
    and exists(select 1 from private.automation_runtime where singleton);
$$;
revoke all on function public.automation_cron_ready() from public,anon,authenticated;
grant execute on function public.automation_cron_ready() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='dashfull-budget-worker' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dashfull-budget-worker','* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='automation_project_url' limit 1) || '/functions/v1/campaign-scheduler',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='automation_cron_secret' limit 1)),
        body := '{"operation":"run","account_id":"2948780535467215"}'::jsonb
      );
    $job$
  );
end $$;
