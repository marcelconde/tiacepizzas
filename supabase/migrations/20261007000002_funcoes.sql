-- =====================================================================
-- Tia Cê Pizzas — funções de negócio (chamadas pelo site e pelo painel)
-- As permissões de execução ficam em 20261008000002_seguranca.sql.
-- =====================================================================

create function public.lista(j jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end;
$$;

create function public.reais(v numeric) returns text
language sql immutable as $$
  select 'R$ ' || replace(to_char(v, 'FM999990.00'), '.', ',');
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
-- Entrega por distância
-- ---------------------------------------------------------------------
create function public.distancia_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select round((6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 2);
$$;

-- Taxa e alcance para um ponto, conforme as faixas cadastradas (em linha reta a partir da loja).
create function public.calcular_entrega(p_lat numeric, p_lng numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c configuracoes%rowtype;
  f faixas_entrega%rowtype;
  d numeric;
begin
  select * into c from configuracoes where id = 1;
  if c.loja_lat is null or c.loja_lng is null then
    return jsonb_build_object('dentro', false, 'mensagem', 'A localização da loja ainda não foi configurada.');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('dentro', false, 'mensagem', 'Não foi possível localizar o endereço.');
  end if;
  d := distancia_km(c.loja_lat, c.loja_lng, p_lat, p_lng);
  select * into f from faixas_entrega where ativo and ate_km >= d order by ate_km limit 1;
  if not found then
    return jsonb_build_object('dentro', false, 'distancia_km', d, 'mensagem', 'Este endereço está fora da nossa área de entrega.');
  end if;
  return jsonb_build_object('dentro', true, 'distancia_km', d, 'taxa', f.taxa, 'tempo_extra_min', f.tempo_extra_min);
end $$;

-- ---------------------------------------------------------------------
-- Promoções
-- ---------------------------------------------------------------------
create function public.promocao_vigente(p public.promocoes) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  agora timestamp := now() at time zone fuso();
  h time := agora::time;
begin
  if not p.ativo then return false; end if;
  if p.data_inicio is not null and agora::date < p.data_inicio then return false; end if;
  if p.data_fim is not null and agora::date > p.data_fim then return false; end if;
  if p.dias_semana is not null and not (extract(dow from agora)::int = any (p.dias_semana)) then return false; end if;
  if p.hora_inicio is not null and p.hora_fim is not null then
    if p.hora_fim > p.hora_inicio then
      return h >= p.hora_inicio and h < p.hora_fim;
    end if;
    return h >= p.hora_inicio or h < p.hora_fim; -- atravessa a meia-noite
  end if;
  if p.hora_inicio is not null and h < p.hora_inicio then return false; end if;
  if p.hora_fim is not null and h >= p.hora_fim then return false; end if;
  return true;
end $$;

-- Menor preço entre o normal e as promoções vigentes do produto (e do tamanho, quando a promoção é de um só).
create function public.preco_com_promocao(p_produto uuid, p_tamanho uuid, p_preco numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select least(p_preco, coalesce(min(
    case pr.tipo
      when 'percentual' then round(p_preco * (1 - pr.valor / 100), 2)
      when 'valor' then greatest(p_preco - pr.valor, 0)
      else pr.valor
    end), p_preco))
  from promocoes pr
  join promocao_produtos pp on pp.promocao_id = pr.id and pp.produto_id = p_produto
  where (pr.tamanho_id is null or pr.tamanho_id = p_tamanho) and promocao_vigente(pr);
$$;

-- O que o site precisa para mostrar selos e preços promocionais agora.
create function public.promocoes_vigentes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id, 'nome', pr.nome, 'descricao', pr.descricao, 'tipo', pr.tipo, 'valor', pr.valor,
    'tamanho_id', pr.tamanho_id, 'selo', pr.selo, 'destaque', pr.destaque, 'imagem_url', pr.imagem_url,
    'data_fim', pr.data_fim, 'hora_fim', pr.hora_fim,
    'produtos', (select coalesce(jsonb_agg(pp.produto_id), '[]'::jsonb) from promocao_produtos pp where pp.promocao_id = pr.id)
  ) order by pr.criado_em), '[]'::jsonb)
  from promocoes pr
  where promocao_vigente(pr);
$$;

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
    return jsonb_build_object('valido', false, 'mensagem', 'Cupom válido para pedidos a partir de ' || reais(c.pedido_minimo));
  end if;
  return jsonb_build_object(
    'valido', true,
    'codigo', c.codigo,
    'desconto', case c.tipo when 'percentual' then round(p_subtotal * c.valor / 100, 2) else least(c.valor, p_subtotal) end
  );
end $$;

-- ---------------------------------------------------------------------
-- Criação de pedido. É a única porta de entrada para pedidos do site:
-- os preços (com promoções) e a taxa de entrega são sempre recalculados aqui.
-- Pedido, itens, baixa de estoque e lançamento no caixa acontecem na mesma transação.
-- ---------------------------------------------------------------------
create function public.criar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- só o painel lança pedidos como equipe; a mesma pessoa pedindo pelo site é tratada como cliente
  v_staff boolean := coalesce((p ->> 'painel')::boolean, false) and pode('pedidos');
  v_cfg configuracoes%rowtype;
  v_tipo tipo_pedido;
  v_origem origem_pedido := 'site';
  v_status status_pedido := 'novo';
  v_pago boolean := false;
  v_pagamento forma_pagamento;
  v_chave uuid := nullif(p ->> 'chave', '')::uuid;
  v_nome text := nullif(trim(p #>> '{cliente,nome}'), '');
  v_tel text := nullif(regexp_replace(coalesce(p #>> '{cliente,telefone}', ''), '\D', '', 'g'), '');
  v_cpf text := nullif(regexp_replace(coalesce(p ->> 'cpf_nota', ''), '\D', '', 'g'), '');
  v_end jsonb := p -> 'endereco';
  v_lat numeric := nullif(p #>> '{endereco,lat}', '')::numeric;
  v_lng numeric := nullif(p #>> '{endereco,lng}', '')::numeric;
  v_dist numeric;
  v_extra int := 0;
  v_entrega jsonb;
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
begin
  -- o mesmo envio repetido (toque duplo, conexão ruim) devolve o pedido já criado
  if v_chave is not null then
    select * into v_pedido from pedidos where chave = v_chave;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'codigo', v_pedido.codigo,
                                'status', v_pedido.status, 'total', v_pedido.total, 'repetido', true);
    end if;
  end if;

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
    if v_cfg.exigir_login and auth.uid() is null then
      raise exception 'Entre na sua conta para fazer o pedido';
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
    v_bairro_nome := coalesce(v_bairro.nome, nullif(trim(v_end ->> 'bairro'), ''));

    if v_cfg.modo_entrega = 'distancia' then
      if v_lat is not null and v_lng is not null then
        v_entrega := calcular_entrega(v_lat, v_lng);
        v_dist := (v_entrega ->> 'distancia_km')::numeric;
      end if;
      if coalesce((v_entrega ->> 'dentro')::boolean, false) then
        v_taxa := (v_entrega ->> 'taxa')::numeric;
        v_extra := coalesce((v_entrega ->> 'tempo_extra_min')::int, 0);
      elsif not v_staff then
        raise exception '%', coalesce(v_entrega ->> 'mensagem', 'Não foi possível localizar o endereço. Confira os dados ou ajuste o ponto no mapa.');
      end if;
    elsif v_bairro.id is not null then
      v_taxa := v_bairro.taxa_entrega;
      v_extra := v_bairro.tempo_extra_min;
    elsif not v_staff then
      raise exception 'Selecione um bairro atendido para entrega';
    end if;

    if v_staff and nullif(p ->> 'taxa_entrega', '') is not null then
      v_taxa := greatest((p ->> 'taxa_entrega')::numeric, 0);
    end if;
    v_end := v_end || jsonb_build_object('bairro', v_bairro_nome);
  else
    v_end := null;
    v_lat := null;
    v_lng := null;
  end if;

  -- cliente: quem está logado usa a própria conta; os demais são reconhecidos pelo telefone
  if not v_staff and auth.uid() is not null then
    perform minha_conta(); -- garante o cadastro no primeiro pedido
    select id into v_cliente from clientes where usuario_id = auth.uid();
    update clientes set telefone = coalesce(v_tel, telefone), cpf = coalesce(cpf, v_cpf) where id = v_cliente;
  end if;
  if v_cliente is null and v_tel is not null then
    insert into clientes (nome, telefone, cpf) values (v_nome, v_tel, v_cpf)
    on conflict (telefone) where usuario_id is null do update set
      nome = case when v_staff then excluded.nome else clientes.nome end,
      cpf = coalesce(clientes.cpf, excluded.cpf)
    returning id into v_cliente;
  end if;

  if v_cliente is not null and v_tipo = 'entrega' and not exists (
    select 1 from enderecos
    where cliente_id = v_cliente
      and lower(logradouro) = lower(trim(v_end ->> 'logradouro'))
      and coalesce(numero, '') = coalesce(trim(v_end ->> 'numero'), '')
  ) then
    insert into enderecos (cliente_id, cep, logradouro, numero, complemento, bairro_id, bairro, cidade, uf, referencia, lat, lng)
    values (
      v_cliente, nullif(v_end ->> 'cep', ''), trim(v_end ->> 'logradouro'), trim(v_end ->> 'numero'),
      nullif(trim(v_end ->> 'complemento'), ''), v_bairro.id, v_bairro_nome,
      nullif(v_end ->> 'cidade', ''), nullif(v_end ->> 'uf', ''), nullif(trim(v_end ->> 'referencia'), ''), v_lat, v_lng
    );
  end if;

  insert into pedidos (cliente_id, cliente_nome, cliente_telefone, tipo, origem, status, endereco, bairro_id, bairro,
                       forma_pagamento, cpf_nota, observacoes, chave, lat, lng, distancia_km)
  values (v_cliente, v_nome, v_tel, v_tipo, v_origem, 'novo', v_end, v_bairro.id, v_bairro_nome,
          v_pagamento, v_cpf, nullif(trim(left(p ->> 'observacoes', 500)), ''), v_chave, v_lat, v_lng, v_dist)
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
             case when v_cfg.regra_preco_sabores = 'media'
                  then round(avg(preco_com_promocao(s.id, v_tam.id, pp.preco)), 2)
                  else max(preco_com_promocao(s.id, v_tam.id, pp.preco)) end,
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
      v_preco := preco_com_promocao(v_prod.id, null, v_prod.preco);
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
    raise exception 'O pedido mínimo é de %', reais(v_cfg.pedido_minimo);
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
      raise exception 'Cupom válido para pedidos a partir de %', reais(v_cupom.pedido_minimo);
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

  -- a mudança de status/pagamento passa pelo gatilho (estoque e caixa)
  update pedidos set
    subtotal = v_subtotal,
    taxa_entrega = v_taxa,
    desconto = v_desc,
    total = v_subtotal + v_taxa - v_desc,
    cupom_codigo = v_cupom_codigo,
    troco_para = v_troco,
    previsao_em = now() + make_interval(mins => v_cfg.tempo_preparo_min
      + case when v_tipo = 'entrega' then v_cfg.tempo_entrega_min + coalesce(v_extra, 0) else 0 end),
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
-- Com o pedido na rua, inclui a última posição do motoboy (se recente).
-- ---------------------------------------------------------------------
create function public.acompanhar_pedido(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero', p.numero, 'codigo', p.codigo, 'status', p.status, 'tipo', p.tipo,
    'nome', split_part(p.cliente_nome, ' ', 1), 'bairro', p.bairro,
    'subtotal', p.subtotal, 'taxa_entrega', p.taxa_entrega, 'desconto', p.desconto, 'total', p.total,
    'forma_pagamento', p.forma_pagamento, 'troco_para', p.troco_para, 'pago', p.pago, 'pago_em', p.pago_em,
    'previsao_em', p.previsao_em, 'criado_em', p.criado_em, 'confirmado_em', p.confirmado_em,
    'preparo_em', p.preparo_em, 'pronto_em', p.pronto_em, 'saiu_em', p.saiu_em,
    'entregue_em', p.entregue_em, 'cancelado_em', p.cancelado_em, 'reembolsado_em', p.reembolsado_em,
    'motivo_cancelamento', p.motivo_cancelamento, 'motivo_reembolso', p.motivo_reembolso,
    'problema_entrega', p.problema_entrega,
    'entregador', split_part(e.nome, ' ', 1),
    'motoboy', case
      when p.status = 'saiu_entrega' and c.rastreio_motoboy and e.posicao_em > now() - interval '5 minutes'
      then jsonb_build_object('lat', e.lat, 'lng', e.lng, 'em', e.posicao_em) end,
    'loja', case when c.loja_lat is not null then jsonb_build_object('lat', c.loja_lat, 'lng', c.loja_lng) end,
    'itens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nome', i.nome, 'quantidade', i.quantidade, 'total', i.total,
        'adicionais', i.adicionais, 'observacoes', i.observacoes
      ) order by i.ordem), '[]'::jsonb)
      from pedido_itens i where i.pedido_id = p.id
    )
  )
  from pedidos p
  cross join configuracoes c
  left join entregadores e on e.id = p.entregador_id
  where p.codigo = upper(trim(p_codigo));
$$;

-- ---------------------------------------------------------------------
-- Conta do cliente (login social)
-- ---------------------------------------------------------------------
-- Devolve o cadastro de quem está logado, criando-o no primeiro acesso.
create function public.minha_conta() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_usuario record;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta';
  end if;
  select id into v_id from clientes where usuario_id = auth.uid();
  if v_id is null then
    select email, raw_user_meta_data as meta into v_usuario from auth.users where id = auth.uid();
    insert into clientes (nome, email, usuario_id)
    values (
      coalesce(nullif(v_usuario.meta ->> 'full_name', ''), nullif(v_usuario.meta ->> 'name', ''),
               nullif(v_usuario.meta ->> 'nome', ''), split_part(coalesce(v_usuario.email, 'Cliente'), '@', 1)),
      v_usuario.email, auth.uid())
    returning id into v_id;
  end if;
  return (
    select to_jsonb(c) || jsonb_build_object('enderecos', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.criado_em), '[]'::jsonb) from enderecos e where e.cliente_id = c.id
    ))
    from clientes c where c.id = v_id
  );
end $$;

create function public.meus_pedidos() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.pedido order by x.criado_em desc), '[]'::jsonb)
  from (
    select p.criado_em, jsonb_build_object(
      'numero', p.numero, 'codigo', p.codigo, 'status', p.status, 'tipo', p.tipo, 'total', p.total, 'criado_em', p.criado_em,
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', i.nome, 'quantidade', i.quantidade) order by i.ordem), '[]'::jsonb)
                from pedido_itens i where i.pedido_id = p.id)
    ) as pedido
    from pedidos p
    join clientes c on c.id = p.cliente_id
    where c.usuario_id = auth.uid()
    order by p.criado_em desc
    limit 30
  ) x;
$$;

-- ---------------------------------------------------------------------
-- Aplicativo do motoboy: só enxerga e altera as entregas atribuídas a ele.
-- ---------------------------------------------------------------------
create function public.minhas_entregas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_entregador entregadores%rowtype;
  tz text := fuso();
begin
  select * into v_entregador from entregadores where usuario_id = auth.uid() and ativo;
  if not found then
    raise exception 'Acesso restrito aos entregadores';
  end if;
  return jsonb_build_object(
    'entregador', jsonb_build_object('id', v_entregador.id, 'nome', v_entregador.nome, 'valor_por_entrega', v_entregador.valor_por_entrega),
    'entregues_hoje', (
      select count(*) from pedidos
      where entregador_id = v_entregador.id and status = 'entregue'
        and (entregue_em at time zone tz)::date = (now() at time zone tz)::date
    ),
    'entregas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'status', p.status, 'cliente_nome', p.cliente_nome,
        'cliente_telefone', p.cliente_telefone, 'endereco', p.endereco, 'bairro', p.bairro, 'lat', p.lat, 'lng', p.lng,
        'total', p.total, 'forma_pagamento', p.forma_pagamento, 'troco_para', p.troco_para, 'pago', p.pago,
        'observacoes', p.observacoes, 'problema_entrega', p.problema_entrega, 'pronto_em', p.pronto_em, 'saiu_em', p.saiu_em,
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', i.nome, 'quantidade', i.quantidade) order by i.ordem), '[]'::jsonb)
                  from pedido_itens i where i.pedido_id = p.id)
      ) order by p.criado_em), '[]'::jsonb)
      from pedidos p
      where p.entregador_id = v_entregador.id and p.tipo = 'entrega'
        and p.status in ('em_preparo', 'pronto', 'saiu_entrega', 'problema_entrega')
    )
  );
end $$;

create function public.entrega_acao(p_pedido uuid, p_acao text, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entregador uuid;
  v_pedido pedidos%rowtype;
begin
  select id into v_entregador from entregadores where usuario_id = auth.uid() and ativo;
  select * into v_pedido from pedidos where id = p_pedido and entregador_id = v_entregador for update;
  if v_entregador is null or not found then
    raise exception 'Esta entrega não está atribuída a você';
  end if;

  if p_acao = 'sair' and v_pedido.status in ('pronto', 'problema_entrega') then
    update pedidos set status = 'saiu_entrega', problema_entrega = null where id = p_pedido;
  elsif p_acao = 'entregar' and v_pedido.status = 'saiu_entrega' then
    update pedidos set status = 'entregue', pago = true where id = p_pedido;
  elsif p_acao = 'problema' and v_pedido.status = 'saiu_entrega' then
    if nullif(trim(p_obs), '') is null then
      raise exception 'Descreva o problema';
    end if;
    update pedidos set status = 'problema_entrega', problema_entrega = trim(left(p_obs, 300)) where id = p_pedido;
  else
    raise exception 'Ação não permitida para a situação atual do pedido';
  end if;
end $$;

create function public.entrega_posicao(p_lat numeric, p_lng numeric) returns void
language sql security definer set search_path = public as $$
  update entregadores set lat = p_lat, lng = p_lng, posicao_em = now() where usuario_id = auth.uid() and ativo;
$$;

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------
create function public.abrir_caixa(p_valor numeric) returns public.caixas
language plpgsql security definer set search_path = public as $$
declare
  v caixas%rowtype;
begin
  if not pode('caixa') then raise exception 'Acesso negado'; end if;
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
  if not pode('caixa') then raise exception 'Acesso negado'; end if;
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
  if not pode('caixa') then raise exception 'Acesso negado'; end if;
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
-- Relatório de faturamento (painel, financeiro e acerto de entregas).
-- p_agrupar define o passo da série temporal: 'dia', 'semana' ou 'mes'.
-- ---------------------------------------------------------------------
create function public.relatorio_faturamento(p_inicio date, p_fim date, p_agrupar text default 'dia') returns jsonb
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
                 where tipo = 'perda' and criado_em >= v_ini and criado_em < v_fim),
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

-- ---------------------------------------------------------------------
-- Análises de vendas
-- ---------------------------------------------------------------------
-- Todos os produtos ativos com quantidade, faturamento e participação no período (inclui os que não venderam).
create function public.analise_produtos(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
  v_ini timestamptz := p_inicio::timestamp at time zone tz;
  v_fim timestamptz := (p_fim + 1)::timestamp at time zone tz;
begin
  if not (pode('analises') or pode('painel')) then raise exception 'Acesso negado'; end if;
  return (
    with vendas as (
      select (s ->> 'produto_id')::uuid as produto_id,
             sum(i.quantidade::numeric / greatest(jsonb_array_length(i.sabores), 1)) as quantidade,
             sum(i.total / greatest(jsonb_array_length(i.sabores), 1)) as faturamento,
             count(distinct i.pedido_id) as pedidos
      from pedido_itens i
      join pedidos p on p.id = i.pedido_id
      cross join lateral jsonb_array_elements(i.sabores) s
      where p.criado_em >= v_ini and p.criado_em < v_fim and p.status not in ('cancelado', 'reembolsado')
      group by 1
    ),
    total as (select coalesce(sum(faturamento), 0) as valor from vendas)
    select coalesce(jsonb_agg(jsonb_build_object(
      'produto_id', pr.id, 'nome', pr.nome, 'categoria', c.nome,
      'quantidade', round(coalesce(v.quantidade, 0), 1),
      'faturamento', round(coalesce(v.faturamento, 0), 2),
      'pedidos', coalesce(v.pedidos, 0),
      'participacao', case when t.valor > 0 then round(coalesce(v.faturamento, 0) * 100 / t.valor, 1) else 0 end
    ) order by coalesce(v.faturamento, 0) desc, pr.nome), '[]'::jsonb)
    from produtos pr
    join categorias c on c.id = pr.categoria_id
    cross join total t
    left join vendas v on v.produto_id = pr.id
    where pr.ativo or v.produto_id is not null
  );
end $$;

-- Clientes que compraram no período, do que mais gastou ao que menos gastou.
create function public.analise_clientes(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
  v_ini timestamptz := p_inicio::timestamp at time zone tz;
  v_fim timestamptz := (p_fim + 1)::timestamp at time zone tz;
begin
  if not (pode('analises') or pode('clientes')) then raise exception 'Acesso negado'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]'::jsonb)
    from (
      select c.id, c.nome, c.telefone, count(*) as pedidos, sum(p.total) as total,
             round(avg(p.total), 2) as ticket_medio, max(p.criado_em) as ultimo_pedido_em,
             coalesce(sum((
               select sum(i.quantidade) from pedido_itens i where i.pedido_id = p.id and i.tamanho_id is not null
             )), 0) as pizzas
      from pedidos p
      join clientes c on c.id = p.cliente_id
      where p.criado_em >= v_ini and p.criado_em < v_fim and p.status not in ('cancelado', 'reembolsado')
      group by c.id, c.nome, c.telefone
      order by sum(p.total) desc
      limit 200
    ) x
  );
end $$;

-- Tudo sobre as compras de um cliente (opcionalmente só de um período).
create function public.analise_cliente(p_cliente uuid, p_inicio date default null, p_fim date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
  v_ini timestamptz := coalesce(p_inicio, '2000-01-01')::timestamp at time zone tz;
  v_fim timestamptz := (coalesce(p_fim, '2999-01-01') + 1)::timestamp at time zone tz;
begin
  if not (pode('analises') or pode('clientes')) then raise exception 'Acesso negado'; end if;
  return (
    with ped as (
      select * from pedidos
      where cliente_id = p_cliente and criado_em >= v_ini and criado_em < v_fim and status not in ('cancelado', 'reembolsado')
    )
    select jsonb_build_object(
      'pedidos', (select count(*) from ped),
      'total', (select coalesce(sum(total), 0) from ped),
      'ticket_medio', (select coalesce(round(avg(total), 2), 0) from ped),
      'pizzas', (select coalesce(sum(i.quantidade), 0) from pedido_itens i join ped on ped.id = i.pedido_id where i.tamanho_id is not null),
      'ultimo_pedido_em', (select max(criado_em) from ped),
      'datas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'criado_em', criado_em, 'total', total) order by criado_em desc), '[]'::jsonb) from ped),
      'produtos', (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.quantidade desc), '[]'::jsonb)
        from (
          select s ->> 'nome' as nome,
                 round(sum(i.quantidade::numeric / greatest(jsonb_array_length(i.sabores), 1)), 1) as quantidade,
                 round(sum(i.total / greatest(jsonb_array_length(i.sabores), 1)), 2) as total
          from pedido_itens i
          join ped on ped.id = i.pedido_id
          cross join lateral jsonb_array_elements(i.sabores) s
          group by 1 order by 2 desc limit 15
        ) x
      )
    )
  );
end $$;

-- Linha do tempo de alterações de um pedido (quem mudou o quê e quando).
create function public.historico_pedido(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (pode('pedidos') or pode('cozinha')) then raise exception 'Acesso negado'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'quando', a.criado_em, 'usuario', a.usuario_nome, 'antes', a.antes, 'depois', a.depois
    ) order by a.criado_em), '[]'::jsonb)
    from auditoria a
    where a.tabela = 'pedidos' and a.registro_id = p_pedido::text
  );
end $$;
