-- Database backstop for the suffix/date attribution contract.
-- Meta API completeness and account-total checks remain ingestion responsibilities.

create unique index if not exists campaigns_msgs_camp_n_idx
  on public.campaigns (camp_n)
  where typ = 'msgs';

create index if not exists campaigns_msgs_suffix_lifecycle_idx
  on public.campaigns (suffix, ativo_desde, ativo_ate, camp_n)
  where typ = 'msgs';

create or replace function public.enforce_msgs_result_attribution()
returns trigger
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  result_date date;
  active_groups integer;
  expected_owner integer;
begin
  select d.date into result_date
  from public.days d
  where d.di = new.di;

  if result_date is null then
    raise exception 'Dia % não cadastrado para validar a atribuição', new.di;
  end if;

  select count(distinct coalesce(nullif(c.grupo_operacao,''), c.label))
    into active_groups
  from public.campaigns c
  where c.typ = 'msgs'
    and c.suffix = new.suffix
    and result_date >= c.ativo_desde
    and (c.ativo_ate is null or result_date <= c.ativo_ate);

  if new.residual then
    if new.spend <> 0 or new.cost <> 0 or new.rev <= 0 then
      raise exception 'Linha residual exige gasto/custo zero e receita positiva (sufixo %, data %)', new.suffix, result_date;
    end if;

    if active_groups > 0 then
      raise exception 'Receita do sufixo % em % deve pertencer à campanha ativa, não a uma linha residual', new.suffix, result_date;
    end if;

    select c.camp_n into expected_owner
    from public.campaigns c
    where c.typ = 'msgs'
      and c.suffix = new.suffix
      and c.ativo_ate is not null
      and c.ativo_ate < result_date
    order by c.ativo_ate desc, c.camp_n desc
    limit 1;

    if expected_owner is null or expected_owner <> new.carro_n then
      raise exception 'Receita residual do sufixo % em % deve ser atribuída à última campanha ativa (%)', new.suffix, result_date, expected_owner;
    end if;

    return new;
  end if;

  if new.cost > 0 or new.rev > 0 then
    if active_groups = 0 then
      raise exception 'Nenhuma campanha ativa cadastrada para o sufixo % em %; lançamento bloqueado', new.suffix, result_date;
    end if;

    if active_groups > 1 then
      raise exception 'Conflito: mais de uma operação ativa usa o sufixo % em %; lançamento bloqueado', new.suffix, result_date;
    end if;

    select c.camp_n into expected_owner
    from public.campaigns c
    where c.typ = 'msgs'
      and c.suffix = new.suffix
      and result_date >= c.ativo_desde
      and (c.ativo_ate is null or result_date <= c.ativo_ate)
    order by (c.ativo_ate is null) desc, c.ativo_desde asc, c.camp_n asc
    limit 1;

    if expected_owner <> new.carro_n then
      raise exception 'Sufixo % em % deve ser atribuído à campanha ativa titular %, não à campanha %', new.suffix, result_date, expected_owner, new.carro_n;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_msgs_result_attribution() from public, anon, authenticated;

drop trigger if exists msgs_results_attribution_guard on public.msgs_results;
create trigger msgs_results_attribution_guard
before insert or update of di, carro_n, suffix, spend, cost, rev, residual
on public.msgs_results
for each row
execute function public.enforce_msgs_result_attribution();
