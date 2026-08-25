-- Register DIZZ3 as an isolated BRL account.
-- This migration creates no campaigns, days, or financial results.

insert into public.dashboard_accounts (
  meta_account_id,
  slug,
  source_name,
  display_name,
  meta_business_id,
  meta_business_name,
  currency,
  timezone,
  tax_rate,
  rev_share_rate,
  alert_min_spend,
  enabled
) values (
  '3151385028370668',
  'dizz3-brl',
  'DIZZ3',
  'DIZZ3 · BRL',
  '546075581104536',
  'Bali Web Sites',
  'BRL',
  'America/Sao_Paulo',
  0.13,
  0.10,
  150,
  true
)
on conflict (meta_account_id) do update set
  slug = excluded.slug,
  source_name = excluded.source_name,
  display_name = excluded.display_name,
  meta_business_id = excluded.meta_business_id,
  meta_business_name = excluded.meta_business_name,
  currency = excluded.currency,
  timezone = excluded.timezone,
  tax_rate = excluded.tax_rate,
  rev_share_rate = excluded.rev_share_rate,
  alert_min_spend = excluded.alert_min_spend,
  enabled = excluded.enabled,
  updated_at = now();
