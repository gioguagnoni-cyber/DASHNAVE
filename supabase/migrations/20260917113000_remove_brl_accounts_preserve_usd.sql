-- Retire exactly the three legacy BRL accounts and all their scoped rows.
-- Preserves DIZZ 1 USD, including every result row and import batch, bit-for-bit.
do $cleanup$
declare
  retired_accounts constant text[] := array[
    '1417197509632503',
    '1569793953960032',
    '3151385028370668'
  ];
  before_hash text[];
  after_hash text[];
begin
  if (select count(*) from public.dashboard_accounts
      where meta_account_id = '2948780535467215') <> 1 then
    raise exception 'DIZZ 1 USD account missing or duplicated';
  end if;

  select array[
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by meta_account_id), ''))
       from public.dashboard_accounts x where meta_account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by id), ''))
       from public.campaigns x where account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by id), ''))
       from public.days x where account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
       from public.msgs_results x join public.days d on d.di = x.di
       where d.account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by id), ''))
       from private.import_batches x where account_id = '2948780535467215')
  ] into before_hash;

  delete from private.import_batches
  where account_id = any (retired_accounts);

  delete from public.msgs_results r
  using public.days dd
  where r.di = dd.di
    and dd.account_id = any (retired_accounts);

  delete from public.days
  where account_id = any (retired_accounts);

  delete from public.campaigns
  where account_id = any (retired_accounts);

  delete from public.dashboard_accounts
  where meta_account_id = any (retired_accounts);

  if exists (select 1 from private.import_batches where account_id = any (retired_accounts))
    or exists (select 1 from public.days where account_id = any (retired_accounts))
    or exists (select 1 from public.campaigns where account_id = any (retired_accounts))
    or exists (select 1 from public.dashboard_accounts where meta_account_id = any (retired_accounts))
  then
    raise exception 'BRL cleanup incomplete';
  end if;

  select array[
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by meta_account_id), ''))
       from public.dashboard_accounts x where meta_account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by id), ''))
       from public.campaigns x where account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by id), ''))
       from public.days x where account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by x.id), ''))
       from public.msgs_results x join public.days d on d.di = x.di
       where d.account_id = '2948780535467215'),
    (select md5(coalesce(string_agg(to_jsonb(x)::text, chr(10) order by id), ''))
       from private.import_batches x where account_id = '2948780535467215')
  ] into after_hash;

  if before_hash is distinct from after_hash then
    raise exception 'USD account changed during BRL cleanup';
  end if;
end
$cleanup$;
