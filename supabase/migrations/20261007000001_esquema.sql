-- =====================================================================
-- Tia Cê Pizzas — esquema principal
-- Tabelas, regras de segurança (RLS) e gatilhos.
-- =====================================================================

create type public.papel_usuario as enum ('admin', 'atendente', 'cozinha');
create type public.status_pedido as enum ('novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'entregue', 'cancelado');
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

create function public.eh_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo);
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
  telefone text not null unique,
  email text,
  cpf text,
  nascimento date,
  observacoes text,
  criado_em timestamptz not null default now()
);

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
  criado_em timestamptz not null default now()
);
create index on public.enderecos (cliente_id);

create table public.entregadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  valor_por_entrega numeric(10,2) not null default 0,
  ativo boolean not null default true
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
  numero bigint generated always as identity,
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
begin
  new.atualizado_em := now();

  if new.status is distinct from old.status then
    if old.status = 'cancelado' then
      raise exception 'Pedido cancelado não pode ser reaberto';
    end if;

    if new.status = 'confirmado' then
      new.confirmado_em := now();
    elsif new.status = 'em_preparo' then
      new.preparo_em := now();
    elsif new.status = 'pronto' then
      new.pronto_em := now();
    elsif new.status = 'saiu_entrega' then
      new.saiu_em := now();
    elsif new.status = 'entregue' then
      new.entregue_em := now();
    elsif new.status = 'cancelado' then
      new.cancelado_em := now();
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

  if new.status = 'cancelado' and old.status <> 'cancelado' then
    if old.pago then
      perform registrar_caixa_pedido(old, 'estorno');
    end if;
    new.pago := false;
    new.pago_em := null;
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
  where cliente_id = c.id and status <> 'cancelado'
) p on true;

-- ---------------------------------------------------------------------
-- Segurança (RLS)
-- Público lê só o cardápio; o painel exige usuário ativo; pedidos do site
-- entram exclusivamente pela função criar_pedido.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'perfis', 'configuracoes', 'config_fiscal', 'categorias', 'tamanhos', 'produtos', 'produto_precos',
    'adicionais', 'bairros', 'cupons', 'clientes', 'enderecos', 'entregadores', 'caixas', 'pedidos',
    'pedido_itens', 'caixa_movimentos', 'fornecedores', 'insumos', 'fichas_tecnicas', 'estoque_movimentos',
    'despesas', 'notas_fiscais'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- leitura pública do cardápio
  foreach t in array array['configuracoes', 'categorias', 'tamanhos', 'produtos', 'produto_precos', 'adicionais', 'bairros'] loop
    execute format('create policy "leitura publica" on public.%I for select to anon, authenticated using (true)', t);
    execute format('grant select on public.%I to anon', t);
  end loop;

  -- operação: qualquer usuário ativo do painel
  foreach t in array array[
    'categorias', 'tamanhos', 'produtos', 'produto_precos', 'adicionais', 'bairros', 'cupons', 'clientes',
    'enderecos', 'entregadores', 'caixas', 'pedidos', 'pedido_itens', 'caixa_movimentos', 'fornecedores',
    'insumos', 'fichas_tecnicas', 'estoque_movimentos', 'despesas'
  ] loop
    execute format('create policy "equipe" on public.%I for all to authenticated using (public.eh_staff()) with check (public.eh_staff())', t);
  end loop;
end $$;

create policy "equipe le perfis" on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_staff());
create policy "admin gerencia perfis" on public.perfis for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

create policy "admin altera configuracoes" on public.configuracoes for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

create policy "equipe le config fiscal" on public.config_fiscal for select to authenticated
  using (public.eh_staff());
create policy "admin altera config fiscal" on public.config_fiscal for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- notas fiscais: a equipe só lê; quem grava é a função de servidor (service role)
create policy "equipe le notas" on public.notas_fiscais for select to authenticated
  using (public.eh_staff());

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
