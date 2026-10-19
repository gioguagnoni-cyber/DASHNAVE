-- Remove the abandoned budget-automation feature without touching financial data.
do $$
begin
  if exists (select 1 from cron.job where jobname='dashfull-budget-worker') then
    perform cron.unschedule('dashfull-budget-worker');
  end if;
end
$$;

drop function if exists public.automation_cron_ready();
drop function if exists public.automation_verify_cron_secret(text);
drop function if exists public.automation_finish_budget_schedule(uuid,uuid,boolean,bigint,bigint,bigint,text,text);
drop function if exists public.automation_claim_budget_schedule(uuid,uuid);

drop table if exists public.automation_budget_runs;
drop table if exists public.automation_budget_schedules;
drop table if exists public.automation_campaigns;
drop table if exists public.automation_members;
drop table if exists public.automation_accounts;
drop table if exists private.automation_runtime;

drop function if exists private.automation_has_role(text,text[]);

delete from vault.secrets
where name in ('automation_cron_secret','automation_project_url');

drop extension if exists pg_net;
drop extension if exists pg_cron;
