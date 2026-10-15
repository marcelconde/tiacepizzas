-- "Minhas entregas" no aplicativo do motoboy: quantas entregas ele concluiu hoje, nos últimos 7 dias,
-- no mês e desde o começo, e quantas em cada um dos últimos 30 dias. Cada motoboy vê só as dele.
create function public.minhas_entregas_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_entregador uuid;
  tz text := fuso();
  hoje date := (now() at time zone tz)::date;
begin
  select id into v_entregador from entregadores where usuario_id = auth.uid() and ativo;
  if v_entregador is null then
    raise exception 'Acesso restrito aos entregadores';
  end if;
  return (
    with feitas as (
      select (entregue_em at time zone tz)::date as dia
      from pedidos
      where entregador_id = v_entregador and status = 'entregue' and entregue_em is not null
    )
    select jsonb_build_object(
      'hoje', count(*) filter (where dia = hoje),
      'ultimos_7_dias', count(*) filter (where dia > hoje - 7),
      'mes', count(*) filter (where dia >= date_trunc('month', hoje)::date),
      'total', count(*),
      'dias', coalesce((
        select jsonb_agg(jsonb_build_object('dia', d.dia, 'entregas', d.n) order by d.dia desc)
        from (select dia, count(*) as n from feitas where dia > hoje - 30 group by dia) d
      ), '[]'::jsonb)
    )
    from feitas
  );
end $$;

revoke execute on function public.minhas_entregas_resumo() from public, anon;
grant execute on function public.minhas_entregas_resumo() to authenticated, service_role;
