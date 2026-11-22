-- =====================================================================
-- Tia Cê Pizzas — promoção de sabor só na pizza inteira
--
-- Uma promoção de sabor ("Calabresa Grande por R$ 49") valia também para a metade desse sabor numa pizza meio a
-- meio, que saía mais barata do que devia. Agora vale só para a pizza inteira daquele sabor, como os combos; no meio
-- a meio cada sabor entra pelo preço de tabela do tamanho. Pedido do Marcel em 2026-11-21.
-- =====================================================================

do $$
declare
  v_def text := pg_get_functiondef('public.criar_pedido(jsonb)'::regprocedure);
  v_de constant text := 'preco_com_promocao(s.id, v_tam.id, pp.preco)';
  v_para constant text := 'case when t.n = 1 then preco_com_promocao(s.id, v_tam.id, pp.preco) else pp.preco end';
begin
  -- duas ocorrências: a regra da média e a do sabor mais caro
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 2 then
    raise exception 'criar_pedido: trecho do preço dos sabores não encontrado';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;
