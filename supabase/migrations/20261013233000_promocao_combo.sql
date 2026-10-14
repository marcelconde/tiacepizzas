-- =====================================================================
-- Tia Cê Pizzas — promoção do tipo combo: vários produtos por um preço só
-- =====================================================================
-- Exemplo da pizzaria: às quintas, uma Calabresa grande + uma Mussarela média por R$ 80,00.
-- O combo usa os mesmos campos de período, horário e dias da semana das outras promoções; em "valor" vai o
-- preço do conjunto. Os itens ficam em promocao_itens. Quando o pedido tem todos os itens de um combo que está
-- valendo, o servidor dá de desconto a diferença entre o preço normal deles e o preço do combo.
alter table public.promocoes drop constraint promocoes_tipo_check;
alter table public.promocoes add constraint promocoes_tipo_check check (tipo in ('percentual', 'valor', 'preco', 'combo'));

create table public.promocao_itens (
  id uuid primary key default gen_random_uuid(),
  promocao_id uuid not null references public.promocoes (id) on delete cascade,
  produto_id uuid not null references public.produtos (id) on delete cascade,
  tamanho_id uuid references public.tamanhos (id) on delete cascade, -- nulo para produto sem tamanho (bebida)
  quantidade int not null default 1 check (quantidade between 1 and 20)
);
create index on public.promocao_itens (promocao_id);
alter table public.promocao_itens enable row level security;
create policy "leitura publica" on public.promocao_itens for select to anon, authenticated using (true);
create policy "equipe" on public.promocao_itens for all to authenticated
  using ((select pode('conteudo'))) with check ((select pode('conteudo')));
grant select on public.promocao_itens to anon;
grant all on public.promocao_itens to authenticated, service_role; -- quem pode o quê é decidido pelas políticas acima

-- nome dos combos aplicados, para o painel e o cupom impresso explicarem o desconto
alter table public.pedidos add column combo text;

-- O site passa a receber também os itens de cada combo.
create or replace function public.promocoes_vigentes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id, 'nome', pr.nome, 'descricao', pr.descricao, 'tipo', pr.tipo, 'valor', pr.valor,
    'tamanho_id', pr.tamanho_id, 'selo', pr.selo, 'destaque', pr.destaque, 'imagem_url', pr.imagem_url,
    'data_fim', pr.data_fim, 'hora_fim', pr.hora_fim,
    'produtos', (select coalesce(jsonb_agg(pp.produto_id), '[]'::jsonb) from promocao_produtos pp where pp.promocao_id = pr.id),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', ci.produto_id, 'tamanho_id', ci.tamanho_id, 'quantidade', ci.quantidade)), '[]'::jsonb)
              from promocao_itens ci where ci.promocao_id = pr.id)
  ) order by pr.criado_em), '[]'::jsonb)
  from promocoes pr
  where promocao_vigente(pr);
$$;

-- Desconto dos combos que cabem no pedido. Só contam pizzas inteiras (um sabor) e produtos simples; borda e
-- adicionais são cobrados à parte. Cada unidade do pedido entra em um combo só; o mesmo combo pode valer mais
-- de uma vez. Combo que sairia mais caro que os itens soltos não é aplicado.
create function public.combos_do_pedido(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_disp jsonb; -- {"<produto>|<tamanho>": unidades ainda livres}
  v_combo record;
  v_vezes int;
  v_cheio numeric;
  v_desc numeric := 0;
  v_nomes text[] := '{}';
begin
  select coalesce(jsonb_object_agg(t.chave, t.qtd), '{}'::jsonb) into v_disp
  from (
    select i.produto_id || '|' || coalesce(i.tamanho_id::text, '') as chave, sum(i.quantidade)::int as qtd
    from pedido_itens i
    where i.pedido_id = p_pedido and i.produto_id is not null and jsonb_array_length(i.sabores) <= 1
    group by 1
  ) t;

  for v_combo in
    select pr.id, pr.nome, pr.valor from promocoes pr where pr.tipo = 'combo' and promocao_vigente(pr) order by pr.criado_em, pr.id
  loop
    select min(coalesce((v_disp ->> (ci.produto_id || '|' || coalesce(ci.tamanho_id::text, '')))::int, 0) / ci.quantidade),
           sum(ci.quantidade * preco_com_promocao(ci.produto_id, ci.tamanho_id, coalesce(pp.preco, p.preco)))
    into v_vezes, v_cheio
    from (
      select produto_id, tamanho_id, sum(quantidade)::int as quantidade
      from promocao_itens where promocao_id = v_combo.id group by 1, 2
    ) ci
    join produtos p on p.id = ci.produto_id
    left join produto_precos pp on pp.produto_id = ci.produto_id and pp.tamanho_id = ci.tamanho_id;

    if coalesce(v_vezes, 0) >= 1 and v_cheio > v_combo.valor then
      v_desc := v_desc + v_vezes * (v_cheio - v_combo.valor);
      v_nomes := v_nomes || (case when v_vezes > 1 then v_vezes || 'x ' else '' end || v_combo.nome);
      select v_disp || jsonb_object_agg(k.chave, (v_disp ->> k.chave)::int - v_vezes * k.quantidade) into v_disp
      from (
        select produto_id || '|' || coalesce(tamanho_id::text, '') as chave, sum(quantidade)::int as quantidade
        from promocao_itens where promocao_id = v_combo.id group by 1
      ) k;
    end if;
  end loop;

  return jsonb_build_object('desconto', v_desc, 'nomes', array_to_string(v_nomes, ' + '));
end $$;
revoke execute on function public.combos_do_pedido(uuid) from public, anon, authenticated;

-- criar_pedido: soma o desconto dos combos ao do cupom e guarda o nome deles no pedido. Troca de trecho, como
-- nas migrações anteriores; nunca recriar a função a partir da migração original.
do $$
declare
  v_def text := pg_get_functiondef('public.criar_pedido(jsonb)'::regprocedure);
  v_de constant text := 'v_desc := least(v_desc, v_subtotal);';
  v_para constant text := 'v_desc := v_desc + coalesce((combos_do_pedido(v_pedido.id) ->> ''desconto'')::numeric, 0); v_desc := least(v_desc, v_subtotal);';
  v_de_nome constant text := 'cupom_codigo = v_cupom_codigo,';
  v_para_nome constant text := 'cupom_codigo = v_cupom_codigo, combo = nullif(combos_do_pedido(v_pedido.id) ->> ''nomes'', ''''),';
begin
  if position(v_de in v_def) = 0 or position(v_de_nome in v_def) = 0 then
    raise exception 'criar_pedido: trecho dos descontos não encontrado';
  end if;
  execute replace(replace(v_def, v_de, v_para), v_de_nome, v_para_nome);
end $$;
