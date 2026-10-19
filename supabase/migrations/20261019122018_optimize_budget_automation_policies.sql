create index if not exists automation_members_user_idx on public.automation_members(user_id);
create index if not exists automation_schedules_created_by_idx on public.automation_budget_schedules(created_by);
create index if not exists automation_schedules_cancelled_by_idx on public.automation_budget_schedules(cancelled_by) where cancelled_by is not null;

drop policy if exists automation_members_read_self on public.automation_members;
create policy automation_members_read_self on public.automation_members for select to authenticated
using (user_id=(select auth.uid()));

drop policy if exists automation_schedules_insert on public.automation_budget_schedules;
create policy automation_schedules_insert on public.automation_budget_schedules for insert to authenticated
with check (
  created_by=(select auth.uid())
  and private.automation_has_role(account_id,array['owner','editor'])
  and execute_at > now()
  and status='pending'
);

drop policy if exists automation_schedules_cancel on public.automation_budget_schedules;
create policy automation_schedules_cancel on public.automation_budget_schedules for update to authenticated
using (status='pending' and private.automation_has_role(account_id,array['owner','editor']))
with check (status='cancelled' and cancelled_by=(select auth.uid()) and cancelled_at is not null);
