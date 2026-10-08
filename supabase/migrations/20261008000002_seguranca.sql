-- =====================================================================
-- Tia Cê Pizzas — quem pode o quê
--
-- * Visitante: lê cardápio, promoções, banners e configurações públicas; pede e acompanha por funções.
-- * Cliente com conta: além disso, lê e altera o próprio cadastro e os próprios endereços.
-- * Equipe: cada papel acessa os módulos marcados em "permissoes" (o administrador acessa todos).
-- * Motoboy: não acessa tabelas; usa apenas as funções do aplicativo de entregas.
-- =====================================================================

insert into public.permissoes (papel, modulo) values
  ('atendente', 'pedidos'), ('atendente', 'clientes'), ('atendente', 'cozinha'),
  ('cozinha', 'cozinha'),
  ('financeiro', 'painel'), ('financeiro', 'pedidos'), ('financeiro', 'caixa'), ('financeiro', 'financeiro'),
  ('financeiro', 'analises'), ('financeiro', 'fiscal');

create function public.pode(p_modulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfis pf
    where pf.id = auth.uid() and pf.ativo and pf.papel <> 'motoboy'
      and (pf.papel = 'admin' or exists (select 1 from permissoes pm where pm.papel = pf.papel and pm.modulo = p_modulo))
  );
$$;

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  r record;
begin
  foreach t in array array[
    'perfis', 'permissoes', 'configuracoes', 'config_fiscal', 'site_conteudo', 'banners', 'promocoes', 'promocao_produtos',
    'categorias', 'tamanhos', 'produtos', 'produto_precos', 'adicionais', 'bairros', 'faixas_entrega', 'cupons',
    'clientes', 'enderecos', 'entregadores', 'caixas', 'pedidos', 'pedido_itens', 'caixa_movimentos', 'fornecedores',
    'insumos', 'fichas_tecnicas', 'estoque_movimentos', 'despesas', 'notas_fiscais', 'auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- leitura pública
  foreach t in array array[
    'configuracoes', 'site_conteudo', 'banners', 'promocoes', 'promocao_produtos', 'categorias', 'tamanhos', 'produtos',
    'produto_precos', 'adicionais', 'bairros', 'faixas_entrega'
  ] loop
    execute format('create policy "leitura publica" on public.%I for select to anon, authenticated using (true)', t);
    execute format('grant select on public.%I to anon', t);
  end loop;

  -- escrita (e leitura, quando a tabela não é pública) por módulo
  for r in
    select * from (values
      ('configuracoes', $c$pode('configuracoes') or pode('entregas')$c$), -- a tela de Entregas grava o modo e o ponto da loja
      ('site_conteudo', $c$pode('conteudo')$c$),
      ('banners', $c$pode('conteudo')$c$),
      ('promocoes', $c$pode('conteudo')$c$),
      ('promocao_produtos', $c$pode('conteudo')$c$),
      ('cupons', $c$pode('conteudo')$c$),
      ('categorias', $c$pode('cardapio')$c$),
      ('tamanhos', $c$pode('cardapio')$c$),
      ('produtos', $c$pode('cardapio')$c$),
      ('produto_precos', $c$pode('cardapio')$c$),
      ('adicionais', $c$pode('cardapio')$c$),
      ('fichas_tecnicas', $c$pode('cardapio') or pode('estoque')$c$),
      ('bairros', $c$pode('entregas')$c$),
      ('faixas_entrega', $c$pode('entregas')$c$),
      ('entregadores', $c$pode('entregas')$c$),
      ('clientes', $c$pode('clientes') or pode('pedidos')$c$),
      ('enderecos', $c$pode('clientes') or pode('pedidos')$c$),
      ('pedidos', $c$pode('pedidos') or pode('cozinha')$c$),
      ('pedido_itens', $c$pode('pedidos') or pode('cozinha')$c$),
      ('caixas', $c$pode('caixa')$c$),
      ('caixa_movimentos', $c$pode('caixa')$c$),
      ('fornecedores', $c$pode('estoque')$c$),
      ('insumos', $c$pode('estoque')$c$),
      ('estoque_movimentos', $c$pode('estoque')$c$),
      ('despesas', $c$pode('financeiro')$c$)
    ) as v(tabela, regra)
  loop
    -- (select ...) faz o banco avaliar a permissão uma vez por consulta, não uma vez por linha
    execute format('create policy "equipe" on public.%I for all to authenticated using ((select %s)) with check ((select %s))',
                   r.tabela, r.regra, r.regra);
  end loop;
end $$;

-- leituras extras da equipe
create policy "equipe le insumos" on public.insumos for select to authenticated
  using ((select pode('cardapio') or pode('painel')));
create policy "equipe le entregadores" on public.entregadores for select to authenticated
  using ((select eh_staff()));
create policy "equipe le notas" on public.notas_fiscais for select to authenticated
  using ((select pode('fiscal') or pode('pedidos')));
create policy "equipe le config fiscal" on public.config_fiscal for select to authenticated
  using ((select eh_staff()));
create policy "fiscal altera config fiscal" on public.config_fiscal for update to authenticated
  using ((select pode('fiscal'))) with check ((select pode('fiscal')));
create policy "auditoria leitura" on public.auditoria for select to authenticated
  using ((select pode('auditoria')));

-- usuários e permissões: só o administrador altera
create policy "le perfis" on public.perfis for select to authenticated
  using (id = (select auth.uid()) or (select eh_staff()));
create policy "admin gerencia perfis" on public.perfis for update to authenticated
  using ((select eh_admin())) with check ((select eh_admin()));
create policy "equipe le permissoes" on public.permissoes for select to authenticated
  using ((select eh_staff()));
create policy "admin gerencia permissoes" on public.permissoes for all to authenticated
  using ((select eh_admin())) with check ((select eh_admin()));

-- cliente com conta: o próprio cadastro e os próprios endereços
create policy "cliente le o proprio cadastro" on public.clientes for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy "cliente altera o proprio cadastro" on public.clientes for update to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));
create policy "cliente gerencia os proprios enderecos" on public.enderecos for all to authenticated
  using (exists (select 1 from clientes c where c.id = cliente_id and c.usuario_id = (select auth.uid())))
  with check (exists (select 1 from clientes c where c.id = cliente_id and c.usuario_id = (select auth.uid())));

-- notas fiscais e auditoria: ninguém grava pelo navegador (só funções de servidor e gatilhos)

-- ---------------------------------------------------------------------
-- Concessões: o RLS acima decide linha a linha; aqui só se abre a porta
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- site (visitante e cliente)
grant execute on function
  public.loja_aberta(),
  public.calcular_entrega(numeric, numeric),
  public.promocoes_vigentes(),
  public.validar_cupom(text, numeric),
  public.criar_pedido(jsonb),
  public.acompanhar_pedido(text)
to anon, authenticated;

-- quem está logado (cada função confere internamente se a pessoa pode)
grant execute on function
  public.eh_staff(),
  public.eh_admin(),
  public.pode(text),
  public.gerar_codigo(),
  public.minha_conta(),
  public.meus_pedidos(),
  public.minhas_entregas(),
  public.entrega_acao(uuid, text, text),
  public.entrega_posicao(numeric, numeric),
  public.abrir_caixa(numeric),
  public.fechar_caixa(numeric, text),
  public.resumo_caixa(uuid),
  public.relatorio_faturamento(date, date, text),
  public.analise_produtos(date, date),
  public.analise_clientes(date, date),
  public.analise_cliente(uuid, date, date),
  public.historico_pedido(uuid)
to authenticated;
