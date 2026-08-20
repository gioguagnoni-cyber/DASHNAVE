-- The public dashboard now calls only account-scoped RPCs. Keeping the old
-- unscoped endpoints available to anonymous clients would allow a cached or
-- third-party client to aggregate BRL and USD rows after the first USD import.
-- Service-role access is retained for diagnostics and controlled restores.

revoke execute on function public.dashboard_summary(integer, integer)
  from anon, authenticated;
revoke execute on function public.data_quality_status(integer, integer)
  from anon, authenticated;
revoke execute on function public.campaign_ranking(integer, integer, numeric, numeric, text)
  from anon, authenticated;
revoke execute on function public.operational_alerts(integer, integer, numeric, numeric)
  from anon, authenticated;
revoke execute on function public.campaign_detail(integer, integer, integer)
  from anon, authenticated;

grant execute on function public.dashboard_summary(integer, integer)
  to service_role;
grant execute on function public.data_quality_status(integer, integer)
  to service_role;
grant execute on function public.campaign_ranking(integer, integer, numeric, numeric, text)
  to service_role;
grant execute on function public.operational_alerts(integer, integer, numeric, numeric)
  to service_role;
grant execute on function public.campaign_detail(integer, integer, integer)
  to service_role;

comment on function public.dashboard_summary(integer, integer) is
  'Legacy BRL-era RPC. Public use disabled; call dashboard_summary_account instead.';
comment on function public.data_quality_status(integer, integer) is
  'Legacy BRL-era RPC. Public use disabled; call data_quality_status_account instead.';
comment on function public.campaign_ranking(integer, integer, numeric, numeric, text) is
  'Legacy BRL-era RPC. Public use disabled; call campaign_ranking_account instead.';
comment on function public.operational_alerts(integer, integer, numeric, numeric) is
  'Legacy BRL-era RPC. Public use disabled; call operational_alerts_account instead.';
comment on function public.campaign_detail(integer, integer, integer) is
  'Legacy BRL-era RPC. Public use disabled; the frontend reads account-filtered v_daily rows.';
