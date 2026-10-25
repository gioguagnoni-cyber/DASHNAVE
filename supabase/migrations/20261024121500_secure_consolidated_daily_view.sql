begin;

-- Use the querying role's grants and RLS policies for every table behind the
-- public daily view. All five source tables already grant SELECT to anon and
-- authenticated and have RLS enabled.
alter view public.v_daily set (security_invoker = true);

commit;
