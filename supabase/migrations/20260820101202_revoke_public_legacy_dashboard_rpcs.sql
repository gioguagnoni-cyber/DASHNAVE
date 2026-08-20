-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. One legacy
-- function retained that inherited grant, so revoke both inherited and direct
-- public roles explicitly for every unscoped endpoint.

revoke execute on function public.dashboard_summary(integer, integer)
  from public, anon, authenticated;
revoke execute on function public.data_quality_status(integer, integer)
  from public, anon, authenticated;
revoke execute on function public.campaign_ranking(integer, integer, numeric, numeric, text)
  from public, anon, authenticated;
revoke execute on function public.operational_alerts(integer, integer, numeric, numeric)
  from public, anon, authenticated;
revoke execute on function public.campaign_detail(integer, integer, integer)
  from public, anon, authenticated;
