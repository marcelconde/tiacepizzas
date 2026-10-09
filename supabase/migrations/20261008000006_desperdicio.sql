-- =====================================================================
-- Tia Cê Pizzas — desperdício (2/2): registro, consulta e reflexo no resultado
-- =====================================================================

-- O desperdício sai do estoque como as demais saídas e fica na auditoria.
create or replace function public.tg_estoque_movimento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v insumos%rowtype;
begin
  select * into v from insumos where id = new.insumo_id for update;
  new.usuario_id := coalesce(new.usuario_id, auth.uid());

  if new.tipo in ('entrada', 'estorno') then
    new.quantidade := abs(new.quantidade);
  elsif new.tipo in ('saida', 'perda', 'desperdicio', 'venda') then
    new.quantidade := -abs(new.quantidade);
  end if;
  if new.quantidade = 0 then
    raise exception 'Informe uma quantidade diferente de zero';
  end if;

  if new.tipo = 'entrada' then
    new.custo_unitario := coalesce(new.custo_unitario, v.custo_unitario);
    update insumos set
      custo_unitario = case
        when v.quantidade > 0
          then round((v.quantidade * v.custo_unitario + new.quantidade * new.custo_unitario) / (v.quantidade + new.quantidade), 4)
        else new.custo_unitario
      end,
      quantidade = v.quantidade + new.quantidade
    where id = new.insumo_id;
  else
    new.custo_unitario := coalesce(new.custo_unitario, v.custo_unitario);
    update insumos set quantidade = v.quantidade + new.quantidade where id = new.insumo_id;
  end if;

  if new.tipo in ('entrada', 'saida', 'perda', 'desperdicio', 'ajuste') and auth.uid() is not null then
    insert into auditoria (tabela, registro_id, acao, descricao, antes, depois, usuario_id, usuario_nome)
    values ('estoque', new.insumo_id::text, 'alterou', v.nome || ' — ' || new.tipo,
            jsonb_build_object('quantidade', v.quantidade), jsonb_build_object('quantidade', v.quantidade + new.quantidade),
            auth.uid(), (select nome from perfis where id = auth.uid()));
  end if;
  return new;
end $$;

-- Todo desperdício precisa dizer o que aconteceu.
alter table public.estoque_movimentos
  add constraint desperdicio_com_motivo check (tipo <> 'desperdicio' or nullif(btrim(observacao), '') is not null);

-- Quem registra: quem cuida do estoque e também a cozinha, que é onde o desperdício acontece.
-- A cozinha não enxerga a tela de Estoque (custos, compras); por isso tudo passa por estas funções.
create function public.insumos_para_desperdicio() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (pode('estoque') or pode('cozinha')) then raise exception 'Acesso negado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'unidade', unidade, 'quantidade', quantidade) order by nome)
    from insumos where ativo), '[]'::jsonb);
end $$;

create function public.registrar_desperdicio(p_insumo uuid, p_quantidade numeric, p_observacao text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v insumos%rowtype;
begin
  if not (pode('estoque') or pode('cozinha')) then raise exception 'Acesso negado'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe a quantidade desperdiçada'; end if;
  if nullif(btrim(coalesce(p_observacao, '')), '') is null then raise exception 'Escreva o que aconteceu'; end if;
  select * into v from insumos where id = p_insumo and ativo;
  if not found then raise exception 'Insumo não encontrado'; end if;

  insert into estoque_movimentos (insumo_id, tipo, quantidade, observacao)
  values (p_insumo, 'desperdicio', p_quantidade, btrim(p_observacao));

  return jsonb_build_object(
    'insumo', v.nome, 'unidade', v.unidade,
    'restante', v.quantidade - p_quantidade,
    'valor', round(p_quantidade * v.custo_unitario, 2));
end $$;

-- Lista do período, com o valor de cada registro (quantidade × custo médio na hora) e quem registrou.
create function public.listar_desperdicios(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
  v_ini timestamptz := p_inicio::timestamp at time zone tz;
  v_fim timestamptz := (p_fim + 1)::timestamp at time zone tz;
begin
  if not (pode('estoque') or pode('financeiro')) then raise exception 'Acesso negado'; end if;
  return (
    with d as (
      select m.id, m.criado_em, i.nome as insumo, i.unidade, -m.quantidade as quantidade,
             round(-m.quantidade * coalesce(m.custo_unitario, 0), 2) as valor,
             m.observacao, coalesce(u.nome, '—') as usuario
      from estoque_movimentos m
      join insumos i on i.id = m.insumo_id
      left join perfis u on u.id = m.usuario_id
      where m.tipo = 'desperdicio' and m.criado_em >= v_ini and m.criado_em < v_fim
    )
    select jsonb_build_object(
      'total', coalesce((select sum(valor) from d), 0),
      'registros', coalesce((select jsonb_agg(to_jsonb(d) order by d.criado_em desc) from d), '[]'::jsonb),
      'por_insumo', coalesce((
        select jsonb_agg(jsonb_build_object('insumo', insumo, 'unidade', unidade, 'quantidade', quantidade, 'valor', valor, 'vezes', vezes) order by valor desc, insumo)
        from (select insumo, unidade, sum(quantidade) as quantidade, sum(valor) as valor, count(*) as vezes from d group by insumo, unidade) x), '[]'::jsonb)
    ));
end $$;

revoke execute on function public.insumos_para_desperdicio(), public.registrar_desperdicio(uuid, numeric, text), public.listar_desperdicios(date, date) from public, anon;
grant execute on function public.insumos_para_desperdicio(), public.registrar_desperdicio(uuid, numeric, text), public.listar_desperdicios(date, date) to authenticated, service_role;

-- No resultado do período, o desperdício entra junto com as perdas de estoque.
create or replace function public.relatorio_faturamento(p_inicio date, p_fim date, p_agrupar text default 'dia') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
  v_ini timestamptz := p_inicio::timestamp at time zone tz;
  v_fim timestamptz := (p_fim + 1)::timestamp at time zone tz;
  v_dias int := p_fim - p_inicio + 1;
  v_ini_ant timestamptz := (p_inicio - v_dias)::timestamp at time zone tz;
  v_passo text := case p_agrupar when 'semana' then 'week' when 'mes' then 'month' else 'day' end;
  r jsonb;
begin
  if not (pode('painel') or pode('financeiro') or pode('entregas')) then raise exception 'Acesso negado'; end if;
  if p_fim < p_inicio then raise exception 'Período inválido'; end if;

  with base as (
    select p.*,
           (p.criado_em at time zone tz)::date as dia,
           extract(hour from p.criado_em at time zone tz)::int as hora,
           extract(dow from p.criado_em at time zone tz)::int as dia_semana
    from pedidos p
    where p.criado_em >= v_ini and p.criado_em < v_fim
  ),
  validos as (select * from base where status not in ('cancelado', 'reembolsado')),
  itens as (
    select s ->> 'nome' as nome,
           i.quantidade::numeric / greatest(jsonb_array_length(i.sabores), 1) as qtd,
           i.total / greatest(jsonb_array_length(i.sabores), 1) as valor
    from pedido_itens i
    join validos v on v.id = i.pedido_id
    cross join lateral jsonb_array_elements(i.sabores) s
  )
  select jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim, 'agrupar', p_agrupar, 'dias', v_dias,
    'resumo', (
      select jsonb_build_object(
        'faturamento', coalesce(sum(total), 0),
        'pedidos', count(*),
        'ticket_medio', coalesce(round(avg(total), 2), 0),
        'taxas_entrega', coalesce(sum(taxa_entrega), 0),
        'descontos', coalesce(sum(desconto), 0),
        'recebido', coalesce(sum(total) filter (where pago), 0),
        'a_receber', coalesce(sum(total) filter (where not pago), 0),
        'tempo_preparo_min', round(avg(extract(epoch from pronto_em - confirmado_em) / 60)),
        'tempo_total_min', round(avg(extract(epoch from entregue_em - criado_em) / 60))
      ) from validos
    ) || jsonb_build_object(
      'cancelados', (select count(*) from base where status = 'cancelado'),
      'valor_cancelado', (select coalesce(sum(total), 0) from base where status = 'cancelado'),
      'reembolsados', (select count(*) from base where status = 'reembolsado'),
      'valor_reembolsado', (select coalesce(sum(total), 0) from base where status = 'reembolsado'),
      'total_pedidos', (select count(*) from base),
      'clientes_novos', (select count(*) from clientes where criado_em >= v_ini and criado_em < v_fim),
      'clientes_atendidos', (select count(distinct cliente_id) from validos),
      'cmv', (select coalesce(round(sum(-quantidade * custo_unitario), 2), 0) from estoque_movimentos
              where tipo in ('venda', 'estorno') and criado_em >= v_ini and criado_em < v_fim),
      'perdas', (select coalesce(round(sum(-quantidade * custo_unitario), 2), 0) from estoque_movimentos
                 where tipo in ('perda', 'desperdicio') and criado_em >= v_ini and criado_em < v_fim),
      'despesas', (select coalesce(sum(valor), 0) from despesas where data between p_inicio and p_fim)
    ),
    'anterior', (
      select jsonb_build_object(
        'faturamento', coalesce(sum(total), 0), 'pedidos', count(*), 'ticket_medio', coalesce(round(avg(total), 2), 0)
      )
      from pedidos
      where criado_em >= v_ini_ant and criado_em < v_ini and status not in ('cancelado', 'reembolsado')
    ),
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dia', d.dia, 'pedidos', coalesce(v.pedidos, 0), 'faturamento', coalesce(v.faturamento, 0)
      ) order by d.dia), '[]'::jsonb)
      from (
        select distinct greatest(date_trunc(v_passo, g)::date, p_inicio) as dia
        from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') g
      ) d
      left join (
        select greatest(date_trunc(v_passo, dia::timestamp)::date, p_inicio) as dia, count(*) as pedidos, sum(total) as faturamento
        from validos group by 1
      ) v using (dia)
    ),
    'por_hora', (
      select coalesce(jsonb_agg(jsonb_build_object('hora', hora, 'pedidos', pedidos, 'faturamento', faturamento) order by hora), '[]'::jsonb)
      from (select hora, count(*) as pedidos, sum(total) as faturamento from validos group by hora) x
    ),
    'por_dia_semana', (
      select coalesce(jsonb_agg(jsonb_build_object('dia_semana', dia_semana, 'pedidos', pedidos, 'faturamento', faturamento) order by dia_semana), '[]'::jsonb)
      from (select dia_semana, count(*) as pedidos, sum(total) as faturamento from validos group by dia_semana) x
    ),
    'por_pagamento', (
      select coalesce(jsonb_agg(jsonb_build_object('forma', forma_pagamento, 'pedidos', pedidos, 'faturamento', faturamento, 'recebido', recebido) order by faturamento desc), '[]'::jsonb)
      from (
        select forma_pagamento, count(*) as pedidos, sum(total) as faturamento, coalesce(sum(total) filter (where pago), 0) as recebido
        from validos group by forma_pagamento
      ) x
    ),
    'por_tipo', (
      select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'pedidos', pedidos, 'faturamento', faturamento) order by faturamento desc), '[]'::jsonb)
      from (select tipo, count(*) as pedidos, sum(total) as faturamento from validos group by tipo) x
    ),
    'por_origem', (
      select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'pedidos', pedidos, 'faturamento', faturamento) order by faturamento desc), '[]'::jsonb)
      from (select origem, count(*) as pedidos, sum(total) as faturamento from validos group by origem) x
    ),
    'por_bairro', (
      select coalesce(jsonb_agg(jsonb_build_object('bairro', bairro, 'pedidos', pedidos, 'faturamento', faturamento) order by faturamento desc), '[]'::jsonb)
      from (
        select bairro, count(*) as pedidos, sum(total) as faturamento
        from validos where tipo = 'entrega' and bairro is not null
        group by bairro order by sum(total) desc limit 10
      ) x
    ),
    'top_produtos', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'quantidade', quantidade, 'faturamento', faturamento) order by faturamento desc), '[]'::jsonb)
      from (
        select nome, round(sum(qtd), 1) as quantidade, round(sum(valor), 2) as faturamento
        from itens group by nome order by sum(valor) desc limit 10
      ) x
    ),
    'top_clientes', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'pedidos', pedidos, 'faturamento', faturamento) order by faturamento desc), '[]'::jsonb)
      from (
        select max(cliente_nome) as nome, count(*) as pedidos, sum(total) as faturamento
        from validos where cliente_id is not null
        group by cliente_id order by sum(total) desc limit 5
      ) x
    ),
    'despesas_por_categoria', (
      select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor) order by valor desc), '[]'::jsonb)
      from (select categoria, sum(valor) as valor from despesas where data between p_inicio and p_fim group by categoria) x
    ),
    'por_entregador', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'entregas', entregas, 'taxas', taxas, 'a_pagar', a_pagar) order by entregas desc), '[]'::jsonb)
      from (
        select e.nome, count(*) as entregas, sum(v.taxa_entrega) as taxas, count(*) * e.valor_por_entrega as a_pagar
        from validos v join entregadores e on e.id = v.entregador_id
        where v.tipo = 'entrega'
        group by e.id, e.nome, e.valor_por_entrega
      ) x
    )
  ) into r;

  return r;
end $$;
