-- =====================================================================
-- Tia Cê Pizzas — desperdício (1/2): o novo tipo de movimento de estoque
-- =====================================================================
-- Desperdício é o ingrediente que caiu no chão, queimou ou foi feito errado durante o preparo.
-- Fica separado de "perda" (vencimento, quebra de embalagem) para a pizzaria enxergar cada um.
-- O PostgreSQL só deixa usar um valor novo de tipo depois que a transação que o criou termina;
-- por isso as regras que o usam ficam na migração seguinte.
alter type public.tipo_mov_estoque add value if not exists 'desperdicio';
