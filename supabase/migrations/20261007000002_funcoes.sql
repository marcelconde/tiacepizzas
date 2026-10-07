-- =====================================================================
-- Tia Cê Pizzas — funções de negócio (chamadas pelo site e pelo painel)
-- =====================================================================

create function public.lista(j jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end;
$$;

-- ---------------------------------------------------------------------
-- Loja aberta? Respeita a chave manual e os horários (inclusive madrugada).
-- ---------------------------------------------------------------------
create function public.loja_aberta() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c configuracoes%rowtype;
  agora timestamp;
  d int;
  h time;
  dia jsonb;
  abre time;
  fecha time;
begin
  select * into c from configuracoes where id = 1;
  if c.loja_aberta_manual is not null then
    return c.loja_aberta_manual;
  end if;

  agora := now() at time zone c.fuso_horario;
  d := extract(dow from agora)::int;
  h := agora::time;

  dia := c.horarios -> d::text;
  if coalesce((dia ->> 'aberto')::boolean, false) then
    abre := (dia ->> 'abre')::time;
    fecha := (dia ->> 'fecha')::time;
    if fecha > abre then
      if h >= abre and h < fecha then return true; end if;
    elsif h >= abre then
      return true;
    end if;
  end if;

  -- turno de ontem que atravessa a meia-noite
  dia := c.horarios -> ((d + 6) % 7)::text;
  if coalesce((dia ->> 'aberto')::boolean, false) then
    abre := (dia ->> 'abre')::time;
    fecha := (dia ->> 'fecha')::time;
    if fecha <= abre and h < fecha then return true; end if;
  end if;

  return false;
end $$;

-- ---------------------------------------------------------------------
-- Cupom
-- ---------------------------------------------------------------------
create function public.validar_cupom(p_codigo text, p_subtotal numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c cupons%rowtype;
  hoje date := (now() at time zone fuso())::date;
begin
  select * into c from cupons
  where codigo = upper(trim(p_codigo)) and ativo
    and (validade is null or validade >= hoje)
    and (usos_max is null or usos < usos_max);
  if not found then
    return jsonb_build_object('valido', false, 'mensagem', 'Cupom inválido ou expirado');
  end if;
  if p_subtotal < c.pedido_minimo then
    return jsonb_build_object('valido', false, 'mensagem',
      'Cupom válido para pedidos a partir de R$ ' || replace(to_char(c.pedido_minimo, 'FM999990.00'), '.', ','));
  end if;
  return jsonb_build_object(
    'valido', true,
    'codigo', c.codigo,
    'desconto', case c.tipo when 'percentual' then round(p_subtotal * c.valor / 100, 2) else least(c.valor, p_subtotal) end
  );
end $$;

-- ---------------------------------------------------------------------
-- Criação de pedido. É a única porta de entrada para pedidos do site:
-- os preços são sempre recalculados aqui, nunca confiados ao navegador.
-- ---------------------------------------------------------------------
create function public.criar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_staff boolean := eh_staff();
  v_cfg configuracoes%rowtype;
  v_tipo tipo_pedido;
  v_origem origem_pedido := 'site';
  v_status status_pedido := 'novo';
  v_pago boolean := false;
  v_pagamento forma_pagamento;
  v_nome text := nullif(trim(p #>> '{cliente,nome}'), '');
  v_tel text := nullif(regexp_replace(coalesce(p #>> '{cliente,telefone}', ''), '\D', '', 'g'), '');
  v_cpf text := nullif(regexp_replace(coalesce(p ->> 'cpf_nota', ''), '\D', '', 'g'), '');
  v_end jsonb := p -> 'endereco';
  v_bairro bairros%rowtype;
  v_bairro_nome text;
  v_cliente uuid;
  v_pedido pedidos%rowtype;
  v_item jsonb;
  v_prod record;
  v_tam tamanhos%rowtype;
  v_sabores jsonb;
  v_adics jsonb;
  v_n int;
  v_n_ok int;
  v_n_bordas int;
  v_qtd int;
  v_preco numeric;
  v_preco_ad numeric;
  v_nome_item text;
  v_ordem int := 0;
  v_subtotal numeric := 0;
  v_taxa numeric := 0;
  v_desc numeric := 0;
  v_cupom cupons%rowtype;
  v_cupom_codigo text;
  v_troco numeric;
  v_previsao int;
begin
  select * into v_cfg from configuracoes where id = 1;

  if jsonb_array_length(lista(p -> 'itens')) = 0 then
    raise exception 'O pedido está vazio';
  end if;
  if jsonb_array_length(p -> 'itens') > 60 then
    raise exception 'Pedido com itens demais';
  end if;
  if v_nome is null then
    raise exception 'Informe o nome do cliente';
  end if;
  if p ->> 'tipo' is null or p ->> 'forma_pagamento' is null then
    raise exception 'Informe o tipo do pedido e a forma de pagamento';
  end if;
  v_tipo := (p ->> 'tipo')::tipo_pedido;
  v_pagamento := (p ->> 'forma_pagamento')::forma_pagamento;
  if v_cpf is not null and length(v_cpf) <> 11 then
    raise exception 'CPF inválido';
  end if;

  if v_staff then
    v_origem := coalesce((p ->> 'origem')::origem_pedido, 'balcao');
    v_status := coalesce((p ->> 'status')::status_pedido, 'confirmado');
    v_pago := coalesce((p ->> 'pago')::boolean, false);
  else
    if v_tipo = 'balcao' then
      raise exception 'Tipo de pedido inválido';
    end if;
    if v_tel is null or length(v_tel) not between 10 and 11 then
      raise exception 'Informe um telefone válido com DDD';
    end if;
    if not v_cfg.aceita_pedidos_online or not loja_aberta() then
      raise exception 'A loja está fechada no momento';
    end if;
    -- freios contra abuso
    if (select count(*) from pedidos
        where cliente_telefone = v_tel and status = 'novo' and criado_em > now() - interval '1 hour') >= 3 then
      raise exception 'Você já tem pedidos aguardando confirmação. Aguarde ou fale com a gente pelo WhatsApp.';
    end if;
    if (select count(*) from pedidos
        where origem = 'site' and status = 'novo' and criado_em > now() - interval '10 minutes') >= 40 then
      raise exception 'Estamos com muitos pedidos agora. Tente novamente em instantes.';
    end if;
  end if;

  -- entrega
  if v_tipo = 'entrega' then
    if nullif(trim(v_end ->> 'logradouro'), '') is null or nullif(trim(v_end ->> 'numero'), '') is null then
      raise exception 'Informe o endereço completo para entrega';
    end if;
    select * into v_bairro from bairros where id = nullif(v_end ->> 'bairro_id', '')::uuid and ativo;
    if found then
      v_taxa := v_bairro.taxa_entrega;
      v_bairro_nome := v_bairro.nome;
    elsif v_staff then
      v_bairro_nome := nullif(trim(v_end ->> 'bairro'), '');
    else
      raise exception 'Selecione um bairro atendido para entrega';
    end if;
    if v_staff and nullif(p ->> 'taxa_entrega', '') is not null then
      v_taxa := greatest((p ->> 'taxa_entrega')::numeric, 0);
    end if;
    v_end := v_end || jsonb_build_object('bairro', v_bairro_nome);
  else
    v_end := null;
  end if;

  -- cliente
  if v_tel is not null then
    insert into clientes (nome, telefone, cpf) values (v_nome, v_tel, v_cpf)
    on conflict (telefone) do update set
      nome = case when v_staff then excluded.nome else clientes.nome end,
      cpf = coalesce(clientes.cpf, excluded.cpf)
    returning id into v_cliente;

    if v_tipo = 'entrega' and not exists (
      select 1 from enderecos
      where cliente_id = v_cliente
        and lower(logradouro) = lower(trim(v_end ->> 'logradouro'))
        and coalesce(numero, '') = coalesce(trim(v_end ->> 'numero'), '')
    ) then
      insert into enderecos (cliente_id, cep, logradouro, numero, complemento, bairro_id, bairro, cidade, uf, referencia)
      values (
        v_cliente, nullif(v_end ->> 'cep', ''), trim(v_end ->> 'logradouro'), trim(v_end ->> 'numero'),
        nullif(trim(v_end ->> 'complemento'), ''), v_bairro.id, v_bairro_nome,
        nullif(v_end ->> 'cidade', ''), nullif(v_end ->> 'uf', ''), nullif(trim(v_end ->> 'referencia'), '')
      );
    end if;
  end if;

  insert into pedidos (cliente_id, cliente_nome, cliente_telefone, tipo, origem, status, endereco, bairro_id, bairro,
                       forma_pagamento, cpf_nota, observacoes)
  values (v_cliente, v_nome, v_tel, v_tipo, v_origem, 'novo', v_end, v_bairro.id, v_bairro_nome,
          v_pagamento, v_cpf, nullif(trim(left(p ->> 'observacoes', 500)), ''))
  returning * into v_pedido;

  -- itens
  for v_item in select * from jsonb_array_elements(p -> 'itens') loop
    v_qtd := coalesce((v_item ->> 'quantidade')::int, 1);
    if v_qtd < 1 or v_qtd > 50 then
      raise exception 'Quantidade inválida';
    end if;

    select pr.id, pr.nome, pr.preco, pr.ativo, pr.disponivel, c.usa_tamanhos
    into v_prod
    from produtos pr join categorias c on c.id = pr.categoria_id
    where pr.id = (v_item ->> 'produto_id')::uuid;
    if not found then
      raise exception 'Produto não encontrado';
    end if;
    if not v_prod.ativo or not v_prod.disponivel then
      raise exception 'Produto indisponível: %', v_prod.nome;
    end if;

    v_adics := '[]'::jsonb;
    v_preco_ad := 0;

    if v_prod.usa_tamanhos then
      select * into v_tam from tamanhos where id = nullif(v_item ->> 'tamanho_id', '')::uuid and ativo;
      if not found then
        raise exception 'Escolha o tamanho de %', v_prod.nome;
      end if;

      select jsonb_agg(jsonb_build_object('produto_id', s.id, 'nome', s.nome) order by x.ord),
             count(*), count(pp.preco),
             case when v_cfg.regra_preco_sabores = 'media' then round(avg(pp.preco), 2) else max(pp.preco) end,
             case when count(*) = 1 then max(s.nome)
                  else string_agg('1/' || t.n || ' ' || s.nome, ' + ' order by x.ord) end
      into v_sabores, v_n, v_n_ok, v_preco, v_nome_item
      from jsonb_array_elements_text(
             case when jsonb_array_length(lista(v_item -> 'sabores')) > 0
                  then v_item -> 'sabores' else jsonb_build_array(v_item ->> 'produto_id') end
           ) with ordinality x(id, ord)
      cross join lateral (
        select greatest(jsonb_array_length(lista(v_item -> 'sabores')), 1) as n
      ) t
      left join produtos s on s.id = x.id::uuid and s.ativo and s.disponivel
      left join produto_precos pp on pp.produto_id = s.id and pp.tamanho_id = v_tam.id;

      if v_n > v_tam.max_sabores then
        raise exception 'O tamanho % aceita até % sabor(es)', v_tam.nome, v_tam.max_sabores;
      end if;
      if v_n_ok <> v_n then
        raise exception 'Um dos sabores está indisponível no tamanho %', v_tam.nome;
      end if;
      v_nome_item := v_nome_item || ' (' || v_tam.nome || ')';

      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'preco', a.preco, 'tipo', a.tipo)
                                order by a.tipo, a.ordem), '[]'::jsonb),
             coalesce(sum(a.preco), 0),
             count(*) filter (where a.tipo = 'borda')
      into v_adics, v_preco_ad, v_n_bordas
      from adicionais a
      where a.ativo
        and a.id in (select y::uuid from jsonb_array_elements_text(lista(v_item -> 'adicionais')) y);
      if v_n_bordas > 1 then
        raise exception 'Escolha apenas uma borda por pizza';
      end if;
    else
      if v_prod.preco is null then
        raise exception 'Produto sem preço cadastrado: %', v_prod.nome;
      end if;
      v_tam := null;
      v_preco := v_prod.preco;
      v_nome_item := v_prod.nome;
      v_sabores := jsonb_build_array(jsonb_build_object('produto_id', v_prod.id, 'nome', v_prod.nome));
    end if;

    v_preco := v_preco + v_preco_ad;
    v_ordem := v_ordem + 1;
    insert into pedido_itens (pedido_id, produto_id, nome, tamanho_id, tamanho, sabores, adicionais,
                              quantidade, preco_unitario, total, observacoes, ordem)
    values (v_pedido.id, v_prod.id, v_nome_item, v_tam.id, v_tam.nome, v_sabores, v_adics,
            v_qtd, v_preco, v_preco * v_qtd, nullif(trim(left(v_item ->> 'observacoes', 300)), ''), v_ordem);
    v_subtotal := v_subtotal + v_preco * v_qtd;
  end loop;

  if not v_staff and v_subtotal < v_cfg.pedido_minimo then
    raise exception 'O pedido mínimo é de R$ %', replace(to_char(v_cfg.pedido_minimo, 'FM999990.00'), '.', ',');
  end if;

  -- descontos
  if nullif(trim(p ->> 'cupom'), '') is not null then
    select * into v_cupom from cupons
    where codigo = upper(trim(p ->> 'cupom')) and ativo
      and (validade is null or validade >= (now() at time zone v_cfg.fuso_horario)::date)
      and (usos_max is null or usos < usos_max)
    for update;
    if not found then
      raise exception 'Cupom inválido ou expirado';
    end if;
    if v_subtotal < v_cupom.pedido_minimo then
      raise exception 'Cupom válido para pedidos a partir de R$ %',
        replace(to_char(v_cupom.pedido_minimo, 'FM999990.00'), '.', ',');
    end if;
    v_desc := case v_cupom.tipo when 'percentual' then round(v_subtotal * v_cupom.valor / 100, 2) else v_cupom.valor end;
    v_cupom_codigo := v_cupom.codigo;
    update cupons set usos = usos + 1 where id = v_cupom.id;
  end if;
  if v_staff and nullif(p ->> 'desconto', '') is not null then
    v_desc := v_desc + greatest((p ->> 'desconto')::numeric, 0);
  end if;
  v_desc := least(v_desc, v_subtotal);

  v_troco := nullif(p ->> 'troco_para', '')::numeric;
  if v_pagamento <> 'dinheiro' or v_troco is null or v_troco < v_subtotal + v_taxa - v_desc then
    v_troco := null;
  end if;

  v_previsao := v_cfg.tempo_preparo_min
    + case when v_tipo = 'entrega' then v_cfg.tempo_entrega_min + coalesce(v_bairro.tempo_extra_min, 0) else 0 end;

  -- a mudança de status/pagamento passa pelo gatilho (estoque e caixa)
  update pedidos set
    subtotal = v_subtotal,
    taxa_entrega = v_taxa,
    desconto = v_desc,
    total = v_subtotal + v_taxa - v_desc,
    cupom_codigo = v_cupom_codigo,
    troco_para = v_troco,
    previsao_em = now() + make_interval(mins => v_previsao),
    status = v_status,
    pago = v_pago
  where id = v_pedido.id
  returning * into v_pedido;

  return jsonb_build_object(
    'id', v_pedido.id, 'numero', v_pedido.numero, 'codigo', v_pedido.codigo,
    'status', v_pedido.status, 'total', v_pedido.total
  );
end $$;

-- ---------------------------------------------------------------------
-- Acompanhamento público: só o essencial, sem telefone nem endereço.
-- ---------------------------------------------------------------------
create function public.acompanhar_pedido(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero', p.numero, 'codigo', p.codigo, 'status', p.status, 'tipo', p.tipo,
    'nome', split_part(p.cliente_nome, ' ', 1), 'bairro', p.bairro,
    'subtotal', p.subtotal, 'taxa_entrega', p.taxa_entrega, 'desconto', p.desconto, 'total', p.total,
    'forma_pagamento', p.forma_pagamento, 'troco_para', p.troco_para, 'pago', p.pago,
    'previsao_em', p.previsao_em, 'criado_em', p.criado_em, 'confirmado_em', p.confirmado_em,
    'preparo_em', p.preparo_em, 'pronto_em', p.pronto_em, 'saiu_em', p.saiu_em,
    'entregue_em', p.entregue_em, 'cancelado_em', p.cancelado_em,
    'motivo_cancelamento', p.motivo_cancelamento,
    'entregador', (select split_part(e.nome, ' ', 1) from entregadores e where e.id = p.entregador_id),
    'itens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nome', i.nome, 'quantidade', i.quantidade, 'total', i.total,
        'adicionais', i.adicionais, 'observacoes', i.observacoes
      ) order by i.ordem), '[]'::jsonb)
      from pedido_itens i where i.pedido_id = p.id
    )
  )
  from pedidos p
  where p.codigo = upper(trim(p_codigo));
$$;

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------
create function public.abrir_caixa(p_valor numeric) returns public.caixas
language plpgsql security definer set search_path = public as $$
declare
  v caixas%rowtype;
begin
  if not eh_staff() then raise exception 'Acesso negado'; end if;
  if exists (select 1 from caixas where fechado_em is null) then
    raise exception 'Já existe um caixa aberto';
  end if;
  insert into caixas (aberto_por, valor_abertura) values (auth.uid(), greatest(coalesce(p_valor, 0), 0))
  returning * into v;
  return v;
end $$;

create function public.resumo_caixa(p_caixa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v caixas%rowtype;
  r jsonb;
begin
  if not eh_staff() then raise exception 'Acesso negado'; end if;
  select * into v from caixas where id = p_caixa;
  if not found then return null; end if;

  select jsonb_build_object(
    'abertura', v.valor_abertura,
    'vendas', coalesce(sum(valor) filter (where tipo in ('venda', 'estorno')), 0),
    'qtd_vendas', count(*) filter (where tipo = 'venda'),
    'suprimentos', coalesce(sum(valor) filter (where tipo = 'suprimento'), 0),
    'sangrias', coalesce(-sum(valor) filter (where tipo = 'sangria'), 0),
    'esperado_dinheiro', v.valor_abertura + coalesce(sum(valor) filter (where forma_pagamento = 'dinheiro'), 0),
    'por_forma', coalesce((
      select jsonb_object_agg(f.forma_pagamento, f.total)
      from (
        select forma_pagamento, sum(valor) as total
        from caixa_movimentos
        where caixa_id = p_caixa and tipo in ('venda', 'estorno')
        group by forma_pagamento
      ) f
    ), '{}'::jsonb)
  ) into r
  from caixa_movimentos where caixa_id = p_caixa;
  return r;
end $$;

create function public.fechar_caixa(p_valor numeric, p_obs text default null) returns public.caixas
language plpgsql security definer set search_path = public as $$
declare
  v caixas%rowtype;
  v_esperado numeric;
begin
  if not eh_staff() then raise exception 'Acesso negado'; end if;
  select * into v from caixas where fechado_em is null for update;
  if not found then raise exception 'Não há caixa aberto'; end if;

  select v.valor_abertura + coalesce(sum(valor), 0) into v_esperado
  from caixa_movimentos where caixa_id = v.id and forma_pagamento = 'dinheiro';

  update caixas set
    fechado_por = auth.uid(), fechado_em = now(),
    valor_esperado = v_esperado, valor_informado = p_valor, diferenca = p_valor - v_esperado,
    observacoes = nullif(trim(p_obs), '')
  where id = v.id
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Relatório de faturamento (alimenta o painel de indicadores)
-- ---------------------------------------------------------------------
create function public.relatorio_faturamento(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
  v_ini timestamptz := p_inicio::timestamp at time zone tz;
  v_fim timestamptz := (p_fim + 1)::timestamp at time zone tz;
  v_dias int := p_fim - p_inicio + 1;
  v_ini_ant timestamptz := (p_inicio - v_dias)::timestamp at time zone tz;
  r jsonb;
begin
  if not eh_staff() then raise exception 'Acesso negado'; end if;
  if p_fim < p_inicio then raise exception 'Período inválido'; end if;

  with base as (
    select p.*,
           (p.criado_em at time zone tz)::date as dia,
           extract(hour from p.criado_em at time zone tz)::int as hora,
           extract(dow from p.criado_em at time zone tz)::int as dia_semana
    from pedidos p
    where p.criado_em >= v_ini and p.criado_em < v_fim
  ),
  validos as (select * from base where status <> 'cancelado'),
  itens as (
    select s ->> 'nome' as nome,
           i.quantidade::numeric / greatest(jsonb_array_length(i.sabores), 1) as qtd,
           i.total / greatest(jsonb_array_length(i.sabores), 1) as valor
    from pedido_itens i
    join validos v on v.id = i.pedido_id
    cross join lateral jsonb_array_elements(i.sabores) s
  )
  select jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim,
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
      'clientes_novos', (select count(*) from clientes where criado_em >= v_ini and criado_em < v_fim),
      'clientes_atendidos', (select count(distinct cliente_id) from validos),
      'cmv', (select coalesce(round(sum(-quantidade * custo_unitario), 2), 0) from estoque_movimentos
              where tipo in ('venda', 'estorno') and criado_em >= v_ini and criado_em < v_fim),
      'perdas', (select coalesce(round(sum(-quantidade * custo_unitario), 2), 0) from estoque_movimentos
                 where tipo = 'perda' and criado_em >= v_ini and criado_em < v_fim),
      'despesas', (select coalesce(sum(valor), 0) from despesas where data between p_inicio and p_fim)
    ),
    'anterior', (
      select jsonb_build_object(
        'faturamento', coalesce(sum(total), 0), 'pedidos', count(*), 'ticket_medio', coalesce(round(avg(total), 2), 0)
      )
      from pedidos
      where criado_em >= v_ini_ant and criado_em < v_ini and status <> 'cancelado'
    ),
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dia', d.dia, 'pedidos', coalesce(v.pedidos, 0), 'faturamento', coalesce(v.faturamento, 0)
      ) order by d.dia), '[]'::jsonb)
      from (select generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day')::date as dia) d
      left join (select dia, count(*) as pedidos, sum(total) as faturamento from validos group by dia) v using (dia)
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
      select coalesce(jsonb_agg(jsonb_build_object('forma', forma_pagamento, 'pedidos', pedidos, 'faturamento', faturamento) order by faturamento desc), '[]'::jsonb)
      from (select forma_pagamento, count(*) as pedidos, sum(total) as faturamento from validos group by forma_pagamento) x
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

-- ---------------------------------------------------------------------
-- Permissões das funções: o público só enxerga o que é do site.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function
  public.loja_aberta(),
  public.validar_cupom(text, numeric),
  public.criar_pedido(jsonb),
  public.acompanhar_pedido(text)
to anon, authenticated;

grant execute on function
  public.eh_staff(),
  public.eh_admin(),
  public.gerar_codigo(),
  public.abrir_caixa(numeric),
  public.fechar_caixa(numeric, text),
  public.resumo_caixa(uuid),
  public.relatorio_faturamento(date, date)
to authenticated;
