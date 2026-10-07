-- =====================================================================
-- Tia Cê Pizzas — DADOS DE EXEMPLO
-- Cardápio, bairros e estoque fictícios para o sistema já nascer navegável.
-- Tudo aqui pode (e deve) ser trocado pelo painel em /admin.
-- =====================================================================
do $$
declare
  c_trad uuid; c_esp uuid; c_doce uuid; c_beb uuid;
  t_broto uuid; t_media uuid; t_grande uuid; t_familia uuid;
  i_farinha uuid; i_molho uuid; i_mussarela uuid; i_calabresa uuid; i_frango uuid; i_catupiry uuid;
  i_bacon uuid; i_caixa uuid; i_chocolate uuid;
  v_id uuid;
  r record;
begin
  if exists (select 1 from categorias) then
    raise notice 'Cardápio já cadastrado: dados de exemplo ignorados.';
    return;
  end if;

  insert into categorias (nome, descricao, usa_tamanhos, ordem) values
    ('Pizzas Tradicionais', 'As clássicas de sempre', true, 1) returning id into c_trad;
  insert into categorias (nome, descricao, usa_tamanhos, ordem) values
    ('Pizzas Especiais', 'Receitas da casa', true, 2) returning id into c_esp;
  insert into categorias (nome, descricao, usa_tamanhos, ordem) values
    ('Pizzas Doces', 'Para fechar com chave de ouro', true, 3) returning id into c_doce;
  insert into categorias (nome, descricao, usa_tamanhos, ordem) values
    ('Bebidas', null, false, 4) returning id into c_beb;

  insert into tamanhos (nome, descricao, fatias, max_sabores, ordem) values
    ('Broto', '4 fatias', 4, 1, 1) returning id into t_broto;
  insert into tamanhos (nome, descricao, fatias, max_sabores, ordem) values
    ('Média', '6 fatias', 6, 2, 2) returning id into t_media;
  insert into tamanhos (nome, descricao, fatias, max_sabores, ordem) values
    ('Grande', '8 fatias', 8, 2, 3) returning id into t_grande;
  insert into tamanhos (nome, descricao, fatias, max_sabores, ordem) values
    ('Família', '12 fatias', 12, 3, 4) returning id into t_familia;

  -- pizzas: (categoria, nome, descrição, destaque, broto, média, grande, família)
  for r in
    select * from (values
      (c_trad, 'Mussarela', 'Molho de tomate, mussarela, orégano e azeitonas', true, 32, 48, 58, 78),
      (c_trad, 'Calabresa', 'Molho de tomate, calabresa fatiada, cebola e orégano', true, 32, 48, 58, 78),
      (c_trad, 'Marguerita', 'Molho de tomate, mussarela, tomate, manjericão fresco e parmesão', false, 34, 50, 60, 80),
      (c_trad, 'Portuguesa', 'Mussarela, presunto, ovos, cebola, ervilha e azeitonas', false, 34, 50, 60, 80),
      (c_trad, 'Frango com Catupiry', 'Frango desfiado temperado, catupiry e orégano', true, 34, 50, 60, 80),
      (c_trad, 'Quatro Queijos', 'Mussarela, provolone, parmesão e catupiry', false, 36, 52, 62, 84),
      (c_esp, 'Tia Cê', 'A da casa: mussarela, calabresa moída, bacon crocante, cebola caramelizada e catupiry', true, 38, 56, 68, 92),
      (c_esp, 'Carne Seca', 'Carne seca desfiada, catupiry, cebola roxa e cheiro-verde', false, 40, 58, 70, 94),
      (c_esp, 'Pepperoni', 'Mussarela, pepperoni e orégano', false, 38, 56, 68, 92),
      (c_esp, 'Bacon com Milho', 'Mussarela, bacon, milho e catupiry', false, 36, 54, 66, 90),
      (c_doce, 'Brigadeiro', 'Chocolate ao leite e granulado', false, 34, 50, 60, 80),
      (c_doce, 'Romeu e Julieta', 'Mussarela e goiabada cremosa', false, 34, 50, 60, 80),
      (c_doce, 'Banana com Canela', 'Banana, leite condensado, açúcar e canela', false, 32, 48, 58, 78)
    ) as v(cat, nome, descr, destaque, p1, p2, p3, p4)
  loop
    insert into produtos (categoria_id, nome, descricao, destaque) values (r.cat, r.nome, r.descr, r.destaque)
    returning id into v_id;
    insert into produto_precos (produto_id, tamanho_id, preco) values
      (v_id, t_broto, r.p1), (v_id, t_media, r.p2), (v_id, t_grande, r.p3), (v_id, t_familia, r.p4);
  end loop;

  insert into produtos (categoria_id, nome, descricao, preco, ncm, cfop, csosn, ordem) values
    (c_beb, 'Coca-Cola 2L', null, 14, '22021000', '5405', '500', 1),
    (c_beb, 'Guaraná Antarctica 2L', null, 12, '22021000', '5405', '500', 2),
    (c_beb, 'Refrigerante lata 350ml', 'Coca-Cola, Guaraná ou Fanta', 6, '22021000', '5405', '500', 3),
    (c_beb, 'Suco natural 500ml', 'Laranja ou limão', 9, '20098990', '5102', '102', 4),
    (c_beb, 'Água mineral 500ml', null, 4, '22011000', '5405', '500', 5);

  insert into adicionais (nome, tipo, preco, ordem) values
    ('Borda de catupiry', 'borda', 10, 1),
    ('Borda de cheddar', 'borda', 10, 2),
    ('Borda de chocolate', 'borda', 12, 3),
    ('Bacon extra', 'extra', 8, 1),
    ('Catupiry extra', 'extra', 7, 2),
    ('Mussarela extra', 'extra', 7, 3);

  insert into bairros (nome, taxa_entrega, tempo_extra_min) values
    ('Centro', 5, 0),
    ('Bairros próximos (até 3 km)', 7, 5),
    ('Bairros distantes (até 6 km)', 10, 15);

  insert into cupons (codigo, tipo, valor, pedido_minimo) values ('BEMVINDO10', 'percentual', 10, 50);

  -- estoque
  insert into insumos (nome, unidade, estoque_minimo) values ('Farinha de trigo', 'kg', 10) returning id into i_farinha;
  insert into insumos (nome, unidade, estoque_minimo) values ('Molho de tomate', 'kg', 5) returning id into i_molho;
  insert into insumos (nome, unidade, estoque_minimo) values ('Mussarela', 'kg', 8) returning id into i_mussarela;
  insert into insumos (nome, unidade, estoque_minimo) values ('Calabresa', 'kg', 4) returning id into i_calabresa;
  insert into insumos (nome, unidade, estoque_minimo) values ('Frango desfiado', 'kg', 3) returning id into i_frango;
  insert into insumos (nome, unidade, estoque_minimo) values ('Catupiry', 'kg', 3) returning id into i_catupiry;
  insert into insumos (nome, unidade, estoque_minimo) values ('Bacon', 'kg', 2) returning id into i_bacon;
  insert into insumos (nome, unidade, estoque_minimo) values ('Chocolate ao leite', 'kg', 2) returning id into i_chocolate;
  insert into insumos (nome, unidade, estoque_minimo) values ('Caixa de pizza', 'un', 50) returning id into i_caixa;

  insert into estoque_movimentos (insumo_id, tipo, quantidade, custo_unitario, observacao) values
    (i_farinha, 'entrada', 50, 4.50, 'Estoque inicial (exemplo)'),
    (i_molho, 'entrada', 20, 9.00, 'Estoque inicial (exemplo)'),
    (i_mussarela, 'entrada', 30, 38.00, 'Estoque inicial (exemplo)'),
    (i_calabresa, 'entrada', 10, 26.00, 'Estoque inicial (exemplo)'),
    (i_frango, 'entrada', 8, 22.00, 'Estoque inicial (exemplo)'),
    (i_catupiry, 'entrada', 8, 32.00, 'Estoque inicial (exemplo)'),
    (i_bacon, 'entrada', 5, 42.00, 'Estoque inicial (exemplo)'),
    (i_chocolate, 'entrada', 4, 45.00, 'Estoque inicial (exemplo)'),
    (i_caixa, 'entrada', 200, 1.80, 'Estoque inicial (exemplo)');

  -- fichas técnicas: base de toda pizza (massa, molho e caixa), por tamanho
  for r in
    select * from (values
      (t_broto, 0.12, 0.05, 0.12), (t_media, 0.20, 0.08, 0.20),
      (t_grande, 0.28, 0.11, 0.28), (t_familia, 0.40, 0.16, 0.40)
    ) as v(tam, farinha, molho, queijo)
  loop
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_farinha, r.farinha from produtos p join categorias c on c.id = p.categoria_id where c.usa_tamanhos;
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_caixa, 1 from produtos p join categorias c on c.id = p.categoria_id where c.usa_tamanhos;
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_molho, r.molho from produtos p where p.categoria_id in (c_trad, c_esp);
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_mussarela, r.queijo from produtos p
    where p.categoria_id in (c_trad, c_esp) and p.nome not in ('Calabresa', 'Frango com Catupiry');
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_calabresa, r.queijo * 0.7 from produtos p where p.nome in ('Calabresa', 'Tia Cê');
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_frango, r.queijo * 0.7 from produtos p where p.nome = 'Frango com Catupiry';
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_catupiry, r.queijo * 0.35 from produtos p where p.nome in ('Frango com Catupiry', 'Tia Cê', 'Quatro Queijos');
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_bacon, r.queijo * 0.3 from produtos p where p.nome in ('Tia Cê', 'Bacon com Milho');
    insert into fichas_tecnicas (produto_id, tamanho_id, insumo_id, quantidade)
    select p.id, r.tam, i_chocolate, r.queijo * 0.6 from produtos p where p.nome = 'Brigadeiro';
  end loop;

  insert into fichas_tecnicas (adicional_id, insumo_id, quantidade)
  select id, i_catupiry, 0.10 from adicionais where nome in ('Borda de catupiry', 'Catupiry extra');
  insert into fichas_tecnicas (adicional_id, insumo_id, quantidade)
  select id, i_bacon, 0.06 from adicionais where nome = 'Bacon extra';
  insert into fichas_tecnicas (adicional_id, insumo_id, quantidade)
  select id, i_mussarela, 0.08 from adicionais where nome = 'Mussarela extra';
  insert into fichas_tecnicas (adicional_id, insumo_id, quantidade)
  select id, i_chocolate, 0.10 from adicionais where nome = 'Borda de chocolate';
end $$;
