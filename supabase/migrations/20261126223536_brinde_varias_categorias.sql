-- =====================================================================
-- Tia Cê Pizzas — brinde: a compra pode valer para mais de uma categoria
-- =====================================================================
-- Pedido do Marcel em 2026-11-26: escolher, por exemplo, Pizzas Salgadas e Pizzas Doces juntas. A categoria única
-- (compra_categoria_id) vira uma lista (compra_categorias); vazia = qualquer categoria. Ainda não havia brinde
-- cadastrado no banco real, então a coluna antiga sai sem cópia de dados.
alter table public.promocoes drop column compra_categoria_id;
alter table public.promocoes add column compra_categorias uuid[];

-- O site recebe as categorias da condição do brinde.
create or replace function public.promocoes_vigentes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id, 'nome', pr.nome, 'descricao', pr.descricao, 'tipo', pr.tipo, 'valor', pr.valor,
    'tamanho_id', pr.tamanho_id, 'selo', pr.selo, 'destaque', pr.destaque, 'imagem_url', pr.imagem_url,
    'data_fim', pr.data_fim, 'hora_fim', pr.hora_fim,
    'compra_categorias', coalesce(to_jsonb(pr.compra_categorias), '[]'::jsonb), 'compra_quantidade', pr.compra_quantidade,
    'produtos', (select coalesce(jsonb_agg(pp.produto_id), '[]'::jsonb) from promocao_produtos pp where pp.promocao_id = pr.id),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', ci.produto_id, 'tamanho_id', ci.tamanho_id, 'quantidade', ci.quantidade)), '[]'::jsonb)
              from promocao_itens ci where ci.promocao_id = pr.id)
  ) order by pr.criado_em), '[]'::jsonb)
  from promocoes pr
  where promocao_vigente(pr);
$$;

-- Desconto dos combos e dos brindes que cabem no pedido (criar_pedido já chama esta função).
-- Combos: só contam pizzas inteiras (um sabor) e produtos simples; cada unidade entra em um combo só; o mesmo
-- combo pode valer mais de uma vez; combo que sairia mais caro que os itens soltos não é aplicado.
-- Brindes: as unidades que são opção de brinde não contam para a condição; os brindes mais caros da sacola saem
-- de graça primeiro (pelo preço do cardápio; borda e adicionais continuam cobrados).
create or replace function public.combos_do_pedido(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_disp jsonb; -- {"<produto>|<tamanho>": unidades ainda livres}
  v_combo record;
  v_vezes int;
  v_cheio numeric;
  v_desc numeric := 0;
  v_nomes text[] := '{}';
  v_brinde record;
  v_compra int;
  v_gratis int;
  v_valor numeric;
  v_qtd int;
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

  for v_brinde in
    select pr.id, pr.nome, pr.valor, pr.tamanho_id, pr.compra_categorias, coalesce(pr.compra_quantidade, 1) as compra_quantidade
    from promocoes pr where pr.tipo = 'brinde' and promocao_vigente(pr) order by pr.criado_em, pr.id
  loop
    select coalesce(sum(i.quantidade), 0)::int into v_compra
    from pedido_itens i
    join produtos p on p.id = i.produto_id
    where i.pedido_id = p_pedido
      and (coalesce(cardinality(v_brinde.compra_categorias), 0) = 0 or p.categoria_id = any (v_brinde.compra_categorias))
      and (v_brinde.tamanho_id is null or i.tamanho_id = v_brinde.tamanho_id)
      and not (jsonb_array_length(i.sabores) <= 1 and exists (
        select 1 from promocao_itens b where b.promocao_id = v_brinde.id and b.produto_id = i.produto_id and b.tamanho_id is not distinct from i.tamanho_id));
    v_gratis := (v_compra / v_brinde.compra_quantidade) * greatest(floor(v_brinde.valor)::int, 1);
    continue when v_gratis < 1;

    select coalesce(sum(u.preco), 0), count(*)::int into v_valor, v_qtd
    from (
      select preco_com_promocao(i.produto_id, i.tamanho_id, coalesce(pp.preco, p.preco)) as preco
      from pedido_itens i
      join produtos p on p.id = i.produto_id
      left join produto_precos pp on pp.produto_id = i.produto_id and pp.tamanho_id = i.tamanho_id
      cross join generate_series(1, i.quantidade)
      where i.pedido_id = p_pedido and jsonb_array_length(i.sabores) <= 1
        and exists (select 1 from promocao_itens b where b.promocao_id = v_brinde.id and b.produto_id = i.produto_id and b.tamanho_id is not distinct from i.tamanho_id)
      order by 1 desc
      limit v_gratis
    ) u;
    if v_qtd > 0 and v_valor > 0 then
      v_desc := v_desc + v_valor;
      v_nomes := v_nomes || (case when v_qtd > 1 then v_qtd || 'x ' else '' end || v_brinde.nome);
    end if;
  end loop;

  return jsonb_build_object('desconto', v_desc, 'nomes', array_to_string(v_nomes, ' + '));
end $$;
revoke execute on function public.combos_do_pedido(uuid) from public, anon, authenticated;
