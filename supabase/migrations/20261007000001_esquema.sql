-- =====================================================================
-- Tia Cê Pizzas — esquema principal
-- Tabelas e gatilhos. As regras de acesso ficam em 20261008000002_seguranca.sql.
-- =====================================================================

create type public.papel_usuario as enum ('admin', 'atendente', 'cozinha', 'financeiro', 'motoboy');
create type public.status_pedido as enum (
  'novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'problema_entrega', 'entregue', 'cancelado', 'reembolsado'
);
create type public.tipo_pedido as enum ('entrega', 'retirada', 'balcao');
create type public.origem_pedido as enum ('site', 'balcao', 'telefone', 'whatsapp', 'ifood');
create type public.forma_pagamento as enum ('dinheiro', 'pix', 'credito', 'debito', 'vale_refeicao');
create type public.tipo_mov_estoque as enum ('entrada', 'saida', 'perda', 'ajuste', 'venda', 'estorno');
create type public.tipo_mov_caixa as enum ('venda', 'suprimento', 'sangria', 'estorno');
create type public.status_nota as enum ('processando', 'autorizada', 'rejeitada', 'cancelada', 'erro');

-- ---------------------------------------------------------------------
-- Usuários do painel
-- ---------------------------------------------------------------------
create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text,
  papel public.papel_usuario not null default 'atendente',
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Equipe interna do painel (o motoboy só usa o aplicativo de entregas).
create function public.eh_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo and papel <> 'motoboy');
$$;

create function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo and papel = 'admin');
$$;

-- ---------------------------------------------------------------------
-- Configurações da loja (linha única)
-- ---------------------------------------------------------------------
create table public.configuracoes (
  id int primary key default 1 check (id = 1),
  nome_loja text not null default 'Tia Cê Pizzas',
  slogan text default 'Pizza de verdade, feita com carinho.',
  telefone text,
  whatsapp text,
  instagram text,
  cep text,
  logradouro text,
  numero text,
  bairro text,
  cidade text,
  uf text,
  fuso_horario text not null default 'America/Sao_Paulo',
  -- chave = dia da semana (0 = domingo). "fecha" menor que "abre" significa que vira a madrugada.
  horarios jsonb not null default '{
    "0": {"aberto": true,  "abre": "18:00", "fecha": "23:30"},
    "1": {"aberto": false, "abre": "18:00", "fecha": "23:00"},
    "2": {"aberto": true,  "abre": "18:00", "fecha": "23:00"},
    "3": {"aberto": true,  "abre": "18:00", "fecha": "23:00"},
    "4": {"aberto": true,  "abre": "18:00", "fecha": "23:00"},
    "5": {"aberto": true,  "abre": "18:00", "fecha": "23:59"},
    "6": {"aberto": true,  "abre": "18:00", "fecha": "23:59"}
  }'::jsonb,
  loja_aberta_manual boolean, -- null = segue os horários
  aceita_pedidos_online boolean not null default true,
  auto_aceitar boolean not null default false,
  pedido_minimo numeric(10,2) not null default 0,
  tempo_preparo_min int not null default 40,
  tempo_entrega_min int not null default 20,
  regra_preco_sabores text not null default 'maior' check (regra_preco_sabores in ('maior', 'media')),
  chave_pix text,
  mensagem_aviso text,
  impressao jsonb not null default '{"largura": 80, "auto": true, "via_cozinha": true}'::jsonb,
  -- entrega: por bairro (tabela bairros) ou por distância (tabela faixas_entrega, a partir do ponto da loja)
  modo_entrega text not null default 'bairro' check (modo_entrega in ('bairro', 'distancia')),
  loja_lat numeric(9,6),
  loja_lng numeric(9,6),
  rastreio_motoboy boolean not null default true,
  -- conta do cliente
  exigir_login boolean not null default false,
  login_google boolean not null default true,
  login_facebook boolean not null default false,
  -- minutos sem mudança de status até cada nível de alerta
  alertas_pedido jsonb not null default '{"atencao": 15, "atrasado": 25, "critico": 40}'::jsonb,
  -- metas: abaixo de "ruim" fica vermelho, a partir de "bom" fica verde (ou o inverso quando menor é melhor)
  metas jsonb not null default '{
    "faturamento_dia": {"ruim": 1000, "bom": 2000},
    "pedidos_dia": {"ruim": 15, "bom": 30},
    "ticket_medio": {"ruim": 50, "bom": 70},
    "tempo_preparo": {"ruim": 45, "bom": 30, "menor_melhor": true},
    "cancelamentos_pct": {"ruim": 10, "bom": 3, "menor_melhor": true}
  }'::jsonb,
  categorias_despesa jsonb not null default '["Motoboys", "Ingredientes", "Embalagens", "Manutenção", "Aluguel", "Energia", "Água", "Gás", "Internet e telefone", "Salários", "Marketing", "Impostos e taxas", "Outros"]'::jsonb,
  atualizado_em timestamptz not null default now()
);
insert into public.configuracoes (id) values (1);

create table public.config_fiscal (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default false,
  auto_emitir boolean not null default true,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  cnpj text,
  razao_social text,
  inscricao_estadual text,
  ncm_padrao text not null default '19059090',
  cfop_padrao text not null default '5102',
  csosn_padrao text not null default '102',
  origem_padrao text not null default '0',
  aliquota_tributos numeric(5,2) not null default 0,
  indicar_entrega boolean not null default true,
  atualizado_em timestamptz not null default now()
);
insert into public.config_fiscal (id) values (1);

create function public.fuso() returns text
language sql stable security definer set search_path = public as $$
  select fuso_horario from configuracoes where id = 1;
$$;

-- ---------------------------------------------------------------------
-- Cardápio
-- ---------------------------------------------------------------------
create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  usa_tamanhos boolean not null default false, -- pizzas: preço por tamanho, meio a meio, bordas
  ordem int not null default 0,
  ativo boolean not null default true
);

create table public.tamanhos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  fatias int,
  max_sabores int not null default 1 check (max_sabores between 1 and 4),
  ordem int not null default 0,
  ativo boolean not null default true
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  nome text not null,
  descricao text,
  imagem_url text,
  preco numeric(10,2) check (preco >= 0), -- usado quando a categoria não usa tamanhos
  disponivel boolean not null default true,
  destaque boolean not null default false,
  ativo boolean not null default true,
  ordem int not null default 0,
  ncm text,
  cfop text,
  csosn text,
  ingredientes text,
  -- {porcao, calorias, carboidratos, proteinas, gorduras, sodio, alergenicos}
  nutricional jsonb,
  criado_em timestamptz not null default now()
);
create index on public.produtos (categoria_id);

create table public.produto_precos (
  produto_id uuid not null references public.produtos (id) on delete cascade,
  tamanho_id uuid not null references public.tamanhos (id) on delete cascade,
  preco numeric(10,2) not null check (preco >= 0),
  primary key (produto_id, tamanho_id)
);

create table public.adicionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'extra' check (tipo in ('borda', 'extra')),
  preco numeric(10,2) not null default 0 check (preco >= 0),
  ordem int not null default 0,
  ativo boolean not null default true
);

create table public.bairros (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  taxa_entrega numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  tempo_extra_min int not null default 0,
  ativo boolean not null default true
);

create table public.cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo = upper(codigo)),
  tipo text not null default 'percentual' check (tipo in ('percentual', 'valor')),
  valor numeric(10,2) not null check (valor > 0),
  pedido_minimo numeric(10,2) not null default 0,
  validade date,
  usos_max int,
  usos int not null default 0,
  ativo boolean not null default true
);

-- ---------------------------------------------------------------------
-- Clientes e entregas
-- ---------------------------------------------------------------------
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  email text,
  cpf text,
  nascimento date,
  observacoes text,
  -- preenchido quando o cliente tem conta (login social); convidados ficam sem
  usuario_id uuid unique references auth.users (id) on delete set null,
  criado_em timestamptz not null default now()
);
-- convidados são identificados pelo telefone; contas podem repetir um telefone (não há verificação por SMS)
create unique index clientes_telefone_convidado on public.clientes (telefone) where usuario_id is null;
create index on public.clientes (telefone);

create table public.enderecos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  cep text,
  logradouro text not null,
  numero text,
  complemento text,
  bairro_id uuid references public.bairros (id) on delete set null,
  bairro text,
  cidade text,
  uf text,
  referencia text,
  lat numeric(9,6),
  lng numeric(9,6),
  criado_em timestamptz not null default now()
);
create index on public.enderecos (cliente_id);

create table public.entregadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  valor_por_entrega numeric(10,2) not null default 0,
  ativo boolean not null default true,
  -- login do motoboy no aplicativo de entregas e última posição enviada
  usuario_id uuid unique references auth.users (id) on delete set null,
  lat numeric(9,6),
  lng numeric(9,6),
  posicao_em timestamptz
);

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------
create table public.caixas (
  id uuid primary key default gen_random_uuid(),
  aberto_por uuid references public.perfis (id) on delete set null,
  aberto_em timestamptz not null default now(),
  valor_abertura numeric(10,2) not null default 0,
  fechado_por uuid references public.perfis (id) on delete set null,
  fechado_em timestamptz,
  valor_esperado numeric(10,2),
  valor_informado numeric(10,2),
  diferenca numeric(10,2),
  observacoes text
);
create unique index caixa_aberto_unico on public.caixas ((true)) where fechado_em is null;

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create function public.gerar_codigo() returns text
language plpgsql volatile as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  posicoes constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  codigo text := '';
  i int;
begin
  foreach i in array posicoes loop
    codigo := codigo || substr(alfabeto, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return codigo;
end $$;

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity (start with 1001),
  codigo text not null unique default public.gerar_codigo(),
  cliente_id uuid references public.clientes (id) on delete set null,
  cliente_nome text not null,
  cliente_telefone text,
  tipo public.tipo_pedido not null,
  origem public.origem_pedido not null default 'site',
  status public.status_pedido not null default 'novo',
  endereco jsonb,
  bairro_id uuid references public.bairros (id) on delete set null,
  bairro text,
  subtotal numeric(10,2) not null default 0,
  taxa_entrega numeric(10,2) not null default 0,
  desconto numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  forma_pagamento public.forma_pagamento not null,
  troco_para numeric(10,2),
  pago boolean not null default false,
  pago_em timestamptz,
  cupom_codigo text,
  cpf_nota text,
  observacoes text,
  entregador_id uuid references public.entregadores (id) on delete set null,
  estoque_baixado boolean not null default false,
  chave uuid unique, -- enviada pelo site: reenviar o mesmo pedido não o duplica
  lat numeric(9,6),
  lng numeric(9,6),
  distancia_km numeric(6,2),
  problema_entrega text,
  motivo_reembolso text,
  reembolsado_em timestamptz,
  status_em timestamptz not null default now(), -- última mudança de status (base dos alertas de atraso)
  previsao_em timestamptz,
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz,
  preparo_em timestamptz,
  pronto_em timestamptz,
  saiu_em timestamptz,
  entregue_em timestamptz,
  cancelado_em timestamptz,
  motivo_cancelamento text,
  atualizado_em timestamptz not null default now()
);
create index on public.pedidos (criado_em desc);
create index on public.pedidos (status);
create index on public.pedidos (cliente_id);
create index on public.pedidos (cliente_telefone);

create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  produto_id uuid references public.produtos (id) on delete set null,
  nome text not null,
  tamanho_id uuid references public.tamanhos (id) on delete set null,
  tamanho text,
  sabores jsonb not null default '[]'::jsonb,    -- [{produto_id, nome}]
  adicionais jsonb not null default '[]'::jsonb, -- [{id, nome, preco, tipo}]
  quantidade int not null check (quantidade > 0),
  preco_unitario numeric(10,2) not null,
  total numeric(10,2) not null,
  observacoes text,
  ordem int not null default 0
);
create index on public.pedido_itens (pedido_id);

create table public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.caixas (id) on delete cascade,
  tipo public.tipo_mov_caixa not null,
  forma_pagamento public.forma_pagamento not null default 'dinheiro',
  valor numeric(10,2) not null, -- positivo entra, negativo sai
  descricao text,
  pedido_id uuid references public.pedidos (id) on delete set null,
  usuario_id uuid,
  criado_em timestamptz not null default now()
);
create index on public.caixa_movimentos (caixa_id);

-- ---------------------------------------------------------------------
-- Estoque
-- ---------------------------------------------------------------------
create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  cnpj text,
  observacoes text,
  ativo boolean not null default true
);

create table public.insumos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  unidade text not null default 'un',
  quantidade numeric(12,3) not null default 0,
  estoque_minimo numeric(12,3) not null default 0,
  custo_unitario numeric(12,4) not null default 0, -- custo médio ponderado
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  ativo boolean not null default true
);

-- Quanto de cada insumo um produto (ou adicional) consome. tamanho_id nulo = vale para qualquer tamanho.
create table public.fichas_tecnicas (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid references public.produtos (id) on delete cascade,
  adicional_id uuid references public.adicionais (id) on delete cascade,
  tamanho_id uuid references public.tamanhos (id) on delete cascade,
  insumo_id uuid not null references public.insumos (id) on delete cascade,
  quantidade numeric(12,3) not null check (quantidade > 0),
  check ((produto_id is not null) <> (adicional_id is not null))
);
create index on public.fichas_tecnicas (produto_id);
create index on public.fichas_tecnicas (adicional_id);

create table public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos (id) on delete cascade,
  tipo public.tipo_mov_estoque not null,
  quantidade numeric(12,3) not null, -- positivo entra, negativo sai (o gatilho ajusta o sinal)
  custo_unitario numeric(12,4),
  pedido_id uuid references public.pedidos (id) on delete set null,
  observacao text,
  usuario_id uuid,
  criado_em timestamptz not null default now()
);
create index on public.estoque_movimentos (insumo_id, criado_em desc);
create index on public.estoque_movimentos (criado_em);

-- ---------------------------------------------------------------------
-- Financeiro e fiscal
-- ---------------------------------------------------------------------
create table public.despesas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria text not null default 'Outros',
  valor numeric(10,2) not null check (valor > 0),
  data date not null default current_date,
  forma_pagamento public.forma_pagamento,
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  observacao text,
  criado_em timestamptz not null default now()
);
create index on public.despesas (data);

create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  ref text not null unique,
  status public.status_nota not null default 'processando',
  ambiente text not null,
  numero text,
  serie text,
  chave text,
  protocolo text,
  qrcode_url text,
  url_consulta text,
  danfe_url text,
  xml_url text,
  valor numeric(10,2),
  mensagem text,
  resposta jsonb,
  justificativa_cancelamento text,
  cancelada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on public.notas_fiscais (pedido_id);
create index on public.notas_fiscais (criado_em desc);
-- no máximo uma nota em andamento ou autorizada por pedido (evita emissão em dobro)
create unique index nota_unica_por_pedido on public.notas_fiscais (pedido_id) where status in ('processando', 'autorizada');

-- ---------------------------------------------------------------------
-- Gatilhos: estoque
-- ---------------------------------------------------------------------
create function public.tg_estoque_movimento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v insumos%rowtype;
begin
  select * into v from insumos where id = new.insumo_id for update;
  new.usuario_id := coalesce(new.usuario_id, auth.uid());

  if new.tipo in ('entrada', 'estorno') then
    new.quantidade := abs(new.quantidade);
  elsif new.tipo in ('saida', 'perda', 'venda') then
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

  if new.tipo in ('entrada', 'saida', 'perda', 'ajuste') and auth.uid() is not null then
    insert into auditoria (tabela, registro_id, acao, descricao, antes, depois, usuario_id, usuario_nome)
    values ('estoque', new.insumo_id::text, 'alterou', v.nome || ' — ' || new.tipo,
            jsonb_build_object('quantidade', v.quantidade), jsonb_build_object('quantidade', v.quantidade + new.quantidade),
            auth.uid(), (select nome from perfis where id = auth.uid()));
  end if;
  return new;
end $$;

create trigger estoque_movimento before insert on public.estoque_movimentos
  for each row execute function public.tg_estoque_movimento();

-- Dá baixa (ou estorna) os insumos de um pedido conforme as fichas técnicas.
-- Pizza com mais de um sabor consome a fração correspondente de cada sabor.
create function public.baixar_estoque_pedido(p_pedido uuid, p_estorno boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into estoque_movimentos (insumo_id, tipo, quantidade, pedido_id, observacao)
  select c.insumo_id,
         (case when p_estorno then 'estorno' else 'venda' end)::tipo_mov_estoque,
         sum(c.qtd),
         p_pedido,
         case when p_estorno then 'Estorno de pedido cancelado' else 'Baixa automática de pedido' end
  from (
    select f.insumo_id, f.quantidade * i.quantidade / greatest(jsonb_array_length(i.sabores), 1) as qtd
    from pedido_itens i
    cross join lateral jsonb_array_elements(i.sabores) s
    join fichas_tecnicas f
      on f.produto_id = (s ->> 'produto_id')::uuid
     and (f.tamanho_id is null or f.tamanho_id = i.tamanho_id)
    where i.pedido_id = p_pedido
    union all
    select f.insumo_id, f.quantidade * i.quantidade
    from pedido_itens i
    cross join lateral jsonb_array_elements(i.adicionais) a
    join fichas_tecnicas f
      on f.adicional_id = (a ->> 'id')::uuid
     and (f.tamanho_id is null or f.tamanho_id = i.tamanho_id)
    where i.pedido_id = p_pedido
  ) c
  group by c.insumo_id
  having sum(c.qtd) > 0;
end $$;

-- ---------------------------------------------------------------------
-- Gatilhos: pedidos (linha do tempo, estoque e caixa)
-- ---------------------------------------------------------------------
create function public.registrar_caixa_pedido(p_pedido public.pedidos, p_tipo public.tipo_mov_caixa) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_caixa uuid;
begin
  select id into v_caixa from caixas where fechado_em is null;
  if v_caixa is null then
    return; -- sem caixa aberto o pagamento fica só no pedido
  end if;
  insert into caixa_movimentos (caixa_id, tipo, forma_pagamento, valor, descricao, pedido_id, usuario_id)
  values (
    v_caixa, p_tipo, p_pedido.forma_pagamento,
    case when p_tipo = 'estorno' then -p_pedido.total else p_pedido.total end,
    'Pedido #' || p_pedido.numero, p_pedido.id, auth.uid()
  );
end $$;

create function public.tg_pedido_atualizado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cfg configuracoes%rowtype;
  v_extra int := 0;
  v_encerrado constant status_pedido[] := array['cancelado', 'reembolsado']::status_pedido[];
begin
  new.atualizado_em := now();

  if new.status is distinct from old.status then
    if old.status = any (v_encerrado) then
      raise exception 'Pedido cancelado ou reembolsado não pode ser reaberto';
    end if;
    if new.status = 'reembolsado' and old.status not in ('entregue', 'problema_entrega') then
      raise exception 'Só é possível reembolsar pedidos entregues ou com problema na entrega';
    end if;
    new.status_em := now();

    if new.status = 'confirmado' then
      new.confirmado_em := now();
    elsif new.status = 'em_preparo' then
      new.preparo_em := now();
    elsif new.status = 'pronto' then
      new.pronto_em := now();
    elsif new.status = 'saiu_entrega' then
      new.saiu_em := coalesce(new.saiu_em, now());
    elsif new.status = 'entregue' then
      new.entregue_em := now();
    elsif new.status = 'cancelado' then
      new.cancelado_em := now();
    elsif new.status = 'reembolsado' then
      new.reembolsado_em := now();
    end if;

    if old.status = 'novo' and new.status <> 'cancelado' then
      new.confirmado_em := coalesce(new.confirmado_em, now());
      select * into v_cfg from configuracoes where id = 1;
      if new.tipo = 'entrega' then
        select coalesce(tempo_extra_min, 0) into v_extra from bairros where id = new.bairro_id;
        v_extra := coalesce(v_extra, 0) + v_cfg.tempo_entrega_min;
      end if;
      new.previsao_em := now() + make_interval(mins => v_cfg.tempo_preparo_min + v_extra);
    end if;

    -- estoque: baixa ao confirmar, devolve ao cancelar (reembolso não devolve: a pizza foi feita)
    if new.status = 'cancelado' then
      if old.estoque_baixado then
        perform baixar_estoque_pedido(new.id, true);
        new.estoque_baixado := false;
      end if;
    elsif new.status <> 'novo' and not old.estoque_baixado then
      perform baixar_estoque_pedido(new.id, false);
      new.estoque_baixado := true;
    end if;
  end if;

  -- caixa
  if new.status = any (v_encerrado) and not (old.status = any (v_encerrado)) then
    if old.pago then
      perform registrar_caixa_pedido(old, 'estorno');
    end if;
    new.pago := false;
  elsif new.pago and not old.pago then
    new.pago_em := now();
    perform registrar_caixa_pedido(new, 'venda');
  elsif old.pago and not new.pago then
    new.pago_em := null;
    perform registrar_caixa_pedido(old, 'estorno');
  end if;

  return new;
end $$;

create trigger pedido_atualizado before update on public.pedidos
  for each row execute function public.tg_pedido_atualizado();

create function public.tg_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger configuracoes_atualizado before update on public.configuracoes
  for each row execute function public.tg_atualizado_em();
create trigger config_fiscal_atualizado before update on public.config_fiscal
  for each row execute function public.tg_atualizado_em();
create trigger notas_fiscais_atualizado before update on public.notas_fiscais
  for each row execute function public.tg_atualizado_em();

-- ---------------------------------------------------------------------
-- Visão: clientes com totais
-- ---------------------------------------------------------------------
create view public.clientes_resumo with (security_invoker = true) as
select c.*,
       coalesce(p.pedidos, 0) as total_pedidos,
       coalesce(p.gasto, 0) as total_gasto,
       p.ultimo_pedido_em
from public.clientes c
left join lateral (
  select count(*) as pedidos, sum(total) as gasto, max(criado_em) as ultimo_pedido_em
  from public.pedidos
  where cliente_id = c.id and status not in ('cancelado', 'reembolsado')
) p on true;

-- ---------------------------------------------------------------------
-- Entrega por distância: faixas a partir do ponto da loja. A maior faixa ativa é o raio de atendimento.
-- ---------------------------------------------------------------------
create table public.faixas_entrega (
  id uuid primary key default gen_random_uuid(),
  ate_km numeric(5,2) not null unique check (ate_km > 0),
  taxa numeric(10,2) not null default 0 check (taxa >= 0),
  tempo_extra_min int not null default 0,
  ativo boolean not null default true
);

-- ---------------------------------------------------------------------
-- Promoções: desconto sobre produtos, com período, horário e dias da semana opcionais.
-- ---------------------------------------------------------------------
create table public.promocoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  tipo text not null default 'percentual' check (tipo in ('percentual', 'valor', 'preco')), -- % de desconto, R$ de desconto ou preço final
  valor numeric(10,2) not null check (valor > 0),
  tamanho_id uuid references public.tamanhos (id) on delete cascade, -- nulo = todos os tamanhos
  data_inicio date,
  data_fim date,
  hora_inicio time,
  hora_fim time,
  dias_semana int[], -- 0 = domingo; nulo = todos os dias
  selo text not null default 'Em promoção',
  destaque boolean not null default true, -- aparece na faixa de promoções da página inicial
  imagem_url text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.promocao_produtos (
  promocao_id uuid not null references public.promocoes (id) on delete cascade,
  produto_id uuid not null references public.produtos (id) on delete cascade,
  primary key (promocao_id, produto_id)
);
create index on public.promocao_produtos (produto_id);

-- ---------------------------------------------------------------------
-- Conteúdo do site (CMS)
-- ---------------------------------------------------------------------
create table public.banners (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  subtitulo text,
  imagem_url text,
  cor text not null default 'molho' check (cor in ('molho', 'forno', 'queijo', 'manjericao')),
  link text,
  botao text,
  posicao text not null default 'inicio_meio'
    check (posicao in ('inicio_topo', 'inicio_meio', 'cardapio_topo', 'cardapio_entre_categorias', 'cardapio_produtos', 'cardapio_fim')),
  categoria_id uuid references public.categorias (id) on delete set null, -- para as posições ligadas a uma categoria
  tamanho text not null default 'medio' check (tamanho in ('pequeno', 'medio', 'grande')),
  ordem int not null default 0,
  ativo boolean not null default true,
  data_inicio date,
  data_fim date
);

-- Textos, logo, seções da página inicial e o que aparece na tela do produto (linha única).
create table public.site_conteudo (
  id int primary key default 1 check (id = 1),
  dados jsonb not null default '{
    "logo_url": null,
    "hero": {
      "titulo": "Pizza de verdade, feita pela Tia Cê.",
      "destaque": "Tia Cê",
      "subtitulo": "Receita de família, ingredientes escolhidos a dedo e entrega quentinha na sua porta.",
      "imagem_url": null
    },
    "secoes": [
      {"id": "hero", "ativo": true, "tamanho": "grande"},
      {"id": "banners", "ativo": true, "tamanho": "medio"},
      {"id": "promocoes", "ativo": true, "tamanho": "medio"},
      {"id": "destaques", "ativo": true, "tamanho": "medio"},
      {"id": "como_funciona", "ativo": true, "tamanho": "medio"}
    ],
    "destaques_titulo": "As mais pedidas",
    "promocoes_titulo": "Promoções de hoje",
    "passos": [
      {"titulo": "Monte do seu jeito", "texto": "Escolha o tamanho, divida em até três sabores e capriche na borda."},
      {"titulo": "A gente prepara na hora", "texto": "Massa aberta à mão e forno bem quente. Nada de pizza pronta esperando."},
      {"titulo": "Acompanhe até a porta", "texto": "Veja cada etapa do pedido em tempo real, do forno à entrega."}
    ],
    "produto": {"foto": true, "descricao": true, "ingredientes": true, "nutricional": true, "observacoes": true, "complementos": true}
  }'::jsonb,
  atualizado_em timestamptz not null default now()
);
insert into public.site_conteudo (id) values (1);
create trigger site_conteudo_atualizado before update on public.site_conteudo
  for each row execute function public.tg_atualizado_em();

-- ---------------------------------------------------------------------
-- Permissões por papel (o administrador sempre pode tudo) e trilha de auditoria
-- ---------------------------------------------------------------------
create table public.permissoes (
  papel public.papel_usuario not null,
  modulo text not null,
  primary key (papel, modulo)
);

create table public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text,
  acao text not null, -- criou, alterou, excluiu
  descricao text,
  antes jsonb,
  depois jsonb,
  usuario_id uuid,
  usuario_nome text,
  criado_em timestamptz not null default now()
);
create index on public.auditoria (criado_em desc);
create index on public.auditoria (tabela, registro_id);
