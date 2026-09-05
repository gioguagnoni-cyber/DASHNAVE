-- Integration audit. Everything, including the temporary test user, is rolled
-- back. No Meta calls, no existing campaign or financial record mutations.
begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000009905','schedule-audit@example.invalid');
insert into public.automation_members(user_id,account_id)
  values('00000000-0000-4000-8000-000000009905','2948780535467215');
insert into public.automation_campaigns(account_id,campaign_id,name,status,effective_status)
  values('2948780535467215','9999999999999905','Temporary schedule test','ACTIVE','ACTIVE'),
    ('3151385028370668','9999999999999905','Temporary other-account test','ACTIVE','ACTIVE');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009905","role":"authenticated"}',true);
insert into public.automation_schedules(account_id,campaign_id)
  values('2948780535467215','9999999999999905');
do $audit$
begin
  if (select count(*) from public.automation_members)<>1 then raise exception 'Membership isolation failed'; end if;
  if (select count(*) from public.automation_schedules)<>1 then raise exception 'Schedule visibility failed'; end if;
  begin
    insert into public.automation_schedules(account_id,campaign_id) values('3151385028370668','9999999999999905');
    raise exception 'Cross-account insert should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.automation_schedules set enabled=true where campaign_id='9999999999999905';
    raise exception 'Pending connection should have blocked activation';
  exception when raise_exception then
    if sqlerrm not like 'Conexão pendente%' then raise; end if;
  end;
  begin
    update public.automation_schedules set weekdays=array[1,1]::smallint[] where campaign_id='9999999999999905';
    raise exception 'Duplicate weekdays should have failed';
  exception when raise_exception then
    if sqlerrm not like 'Dias da semana repetidos%' then raise; end if;
  end;
  begin
    perform public.automation_claim_run('2948780535467215','9999999999999905',1,'2026-09-05T00:01','ACTIVE');
    raise exception 'Authenticated user should not execute worker RPC';
  exception when insufficient_privilege then null;
  end;
end;
$audit$;
reset role;
update public.automation_accounts set connection_state='ready',execution_enabled=true where account_id='2948780535467215';
update public.automation_schedules set enabled=true where campaign_id='9999999999999905';
set local role service_role;
do $audit$
declare claim jsonb; revision_id bigint;
begin
  select revision into revision_id from public.automation_schedules where campaign_id='9999999999999905';
  claim:=public.automation_claim_run('2948780535467215','9999999999999905',revision_id,'2026-09-05T00:01','ACTIVE');
  if claim is null then raise exception 'First claim failed'; end if;
  if public.automation_claim_run('2948780535467215','9999999999999905',revision_id,'2026-09-05T00:01','ACTIVE') is not null then raise exception 'Duplicate claim was allowed'; end if;
  if public.automation_claim_run('2948780535467215','9999999999999905',revision_id,'2026-09-05T09:00','PAUSED') is not null then raise exception 'Concurrent opposite action was allowed'; end if;
  if public.automation_finish_run((claim->>'id')::uuid,gen_random_uuid(),'succeeded') then raise exception 'Wrong lease was accepted'; end if;
  if not public.automation_finish_run((claim->>'id')::uuid,(claim->>'lease_token')::uuid,'succeeded','PAUSED','ACTIVE') then raise exception 'Confirmation failed'; end if;
  if public.automation_claim_run('2948780535467215','9999999999999905',revision_id,'2026-09-05T00:01','ACTIVE') is not null then raise exception 'Completed event repeated'; end if;
end;
$audit$;
reset role;
set local role anon;
do $audit$
begin
  if (select count(*) from public.automation_accounts)<>4 then raise exception 'Public account catalog read failed'; end if;
  begin
    perform * from public.automation_schedules;
    raise exception 'Anonymous schedule access should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.automation_accounts set execution_enabled=true;
    raise exception 'Anonymous execution enabling should fail';
  exception when insufficient_privilege then null;
  end;
end;
$audit$;
reset role;
rollback;
select 'PASS: access isolation, pending guard, idempotency, leases, rollback' as audit;
