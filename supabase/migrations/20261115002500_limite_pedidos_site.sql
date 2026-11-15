-- =====================================================================
-- Tia Cê Pizzas — freio contra abuso ajustável
--
-- criar_pedido recusava o pedido do site quando já havia 40 pedidos do site esperando aceite nos últimos 10 minutos
-- ("Estamos com muitos pedidos agora"). O número ficava escrito na função; agora é configurável, para um teste de
-- carga ou uma noite de movimento fora do comum. O padrão continua 40.
-- =====================================================================

alter table public.configuracoes
  add column limite_pedidos_site integer not null default 40 check (limite_pedidos_site between 1 and 1000);

do $$
declare
  v_def text := pg_get_functiondef('public.criar_pedido(jsonb)'::regprocedure);
  v_de constant text := 'criado_em > now() - interval ''10 minutes'') >= 40 then';
  v_para constant text := 'criado_em > now() - interval ''10 minutes'') >= v_cfg.limite_pedidos_site then';
begin
  if position(v_de in v_def) = 0 then
    raise exception 'criar_pedido: trecho do freio de pedidos do site não encontrado';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;
