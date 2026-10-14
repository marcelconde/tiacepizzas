-- =====================================================================
-- Tia Cê Pizzas — tamanho de pizza que não tem borda recheada
-- =====================================================================
-- A pizzaria só faz borda recheada na média e na grande; o brotinho não tem. Cada tamanho passa a dizer se
-- aceita borda: o site esconde a escolha da borda nesse tamanho e o servidor recusa o pedido que tentar.
alter table public.tamanhos add column aceita_borda boolean not null default true;

-- criar_pedido: mesma técnica das migrações 20261012000004 e 20261013203000 (troca de trecho, com falha se o
-- trecho não for encontrado). Nunca recriar a função a partir da migração original.
do $$
declare
  v_def text := pg_get_functiondef('public.criar_pedido(jsonb)'::regprocedure);
  v_de constant text := 'if v_n_bordas > 1 then';
  v_para constant text := 'if v_n_bordas > 0 and not v_tam.aceita_borda then raise exception ''A pizza % não tem borda recheada'', v_tam.nome; end if; if v_n_bordas > 1 then';
begin
  if position(v_de in v_def) = 0 then
    raise exception 'criar_pedido: trecho da conferência de bordas não encontrado';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;
