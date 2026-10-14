-- =====================================================================
-- Tia Cê Pizzas — borda e adicional com preço por tamanho de pizza
-- =====================================================================
-- A borda recheada da pizza grande custa mais que a da média. Cada adicional continua com o preço padrão
-- (adicionais.preco) e pode ter um preço próprio por tamanho: {"<id do tamanho>": 25.00, ...}.
-- Tamanho sem preço próprio usa o padrão.
alter table public.adicionais
  add column precos_tamanho jsonb not null default '{}'::jsonb check (jsonb_typeof(precos_tamanho) = 'object');

create function public.preco_adicional(a public.adicionais, p_tamanho uuid) returns numeric
language sql immutable as $$
  select greatest(coalesce((a.precos_tamanho ->> p_tamanho::text)::numeric, a.preco), 0);
$$;
revoke execute on function public.preco_adicional(public.adicionais, uuid) from public, anon, authenticated;

-- criar_pedido passa a cobrar cada borda ou adicional pelo tamanho da pizza. É aqui que o preço vale de
-- verdade; o site só mostra. A função é longa e já foi alterada por outra migração (20261012000004): trocam-se
-- só os dois trechos, e a migração falha se algum não for encontrado.
do $$
declare
  v_def text := pg_get_functiondef('public.criar_pedido(jsonb)'::regprocedure);
  v_de_item constant text := '''preco'', a.preco, ''tipo'', a.tipo';
  v_para_item constant text := '''preco'', preco_adicional(a, v_tam.id), ''tipo'', a.tipo';
  v_de_soma constant text := 'coalesce(sum(a.preco), 0)';
  v_para_soma constant text := 'coalesce(sum(preco_adicional(a, v_tam.id)), 0)';
begin
  if position(v_de_item in v_def) = 0 or position(v_de_soma in v_def) = 0 then
    raise exception 'criar_pedido: trecho do preço dos adicionais não encontrado';
  end if;
  execute replace(replace(v_def, v_de_item, v_para_item), v_de_soma, v_para_soma);
end $$;
