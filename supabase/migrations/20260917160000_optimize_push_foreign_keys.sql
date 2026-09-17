-- Cover the foreign-key access paths used by Push imports and audits.
create index if not exists push_daily_campaign_account_idx
  on public.push_daily_results (campaign_id, account_id);

create index if not exists push_import_batches_account_idx
  on private.push_import_batches (account_id);
