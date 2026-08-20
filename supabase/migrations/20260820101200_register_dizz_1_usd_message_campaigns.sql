-- Register only the eligible message campaigns from the USD account.
-- The non-message campaign "reconhecimento" is intentionally excluded.

insert into public.campaigns (
  label, typ, camp_n, suffix, niche, meta_camp_id,
  ativo_desde, ativo_ate, grupo_operacao, account_id
) values
  ('01-RELAC-ES-URUGUAI-66830','msgs',104,'66830','relacionamento','120252469693900652','2026-08-19',null,'URUGUAI','2948780535467215'),
  ('02-RELAC-ES-URUGUAI-40802','msgs',105,'40802','relacionamento','120252484813030652','2026-08-19',null,'URUGUAI','2948780535467215'),
  ('03-RELAC-ES-URUGUAI-44936','msgs',106,'44936','relacionamento','120252485101430652','2026-08-19',null,'URUGUAI','2948780535467215')
on conflict (account_id, label) do update set
  suffix = excluded.suffix,
  niche = excluded.niche,
  meta_camp_id = excluded.meta_camp_id,
  ativo_desde = excluded.ativo_desde,
  ativo_ate = excluded.ativo_ate,
  grupo_operacao = excluded.grupo_operacao;

do $verify$
begin
  if (
    select count(*)
    from public.campaigns
    where account_id='2948780535467215'
      and typ='msgs'
      and meta_camp_id in ('120252469693900652','120252484813030652','120252485101430652')
  ) <> 3 then
    raise exception 'Cadastro das campanhas USD ficou incompleto';
  end if;

  if exists (
    select 1 from public.campaigns
    where account_id='2948780535467215'
      and lower(label)='reconhecimento'
  ) then
    raise exception 'Campanha não operacional não pode entrar no painel de mensagens';
  end if;
end
$verify$;
