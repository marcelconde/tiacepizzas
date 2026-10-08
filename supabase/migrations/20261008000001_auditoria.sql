-- =====================================================================
-- Tia Cê Pizzas — trilha de auditoria
-- Registra quem alterou o quê, com o valor anterior e o novo.
-- Uso do gatilho: tg_auditoria('<coluna que descreve o registro>', '<colunas vigiadas, ou *>')
-- =====================================================================

create function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_depois jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_linha jsonb := coalesce(v_depois, v_antes);
  v_colunas text := coalesce(tg_argv[1], '*');
  v_ignorar constant text[] := array['atualizado_em', 'criado_em', 'status_em', 'posicao_em', 'lat', 'lng', 'usos'];
  v_a jsonb := '{}'::jsonb;
  v_d jsonb := '{}'::jsonb;
  v_descricao text;
  k text;
begin
  -- cargas iniciais e ações do próprio sistema (sem usuário) não entram na trilha
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_depois) loop
      if (v_depois -> k) is distinct from (v_antes -> k)
         and not (k = any (v_ignorar))
         and (v_colunas = '*' or k = any (string_to_array(v_colunas, ','))) then
        v_a := v_a || jsonb_build_object(k, v_antes -> k);
        v_d := v_d || jsonb_build_object(k, v_depois -> k);
      end if;
    end loop;
    if v_d = '{}'::jsonb then
      return new; -- nada relevante mudou
    end if;
  elsif tg_op = 'INSERT' then
    v_a := null;
    v_d := jsonb_strip_nulls(v_depois);
  else
    v_a := jsonb_strip_nulls(v_antes);
    v_d := null;
  end if;

  if tg_table_name = 'produto_precos' then
    select p.nome || ' (' || t.nome || ')' into v_descricao
    from produtos p, tamanhos t
    where p.id = (v_linha ->> 'produto_id')::uuid and t.id = (v_linha ->> 'tamanho_id')::uuid;
  elsif tg_table_name = 'permissoes' then
    v_descricao := (v_linha ->> 'papel') || ' → ' || (v_linha ->> 'modulo');
  else
    v_descricao := v_linha ->> tg_argv[0];
  end if;

  insert into auditoria (tabela, registro_id, acao, descricao, antes, depois, usuario_id, usuario_nome)
  values (
    tg_table_name,
    coalesce(v_linha ->> 'id', v_linha ->> 'produto_id', v_linha ->> 'papel'),
    case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end,
    v_descricao, v_a, v_d, auth.uid(), (select nome from perfis where id = auth.uid())
  );
  return coalesce(new, old);
end $$;

-- pedidos: só mudanças (a criação já tem data e origem no próprio pedido)
create trigger auditoria after update on public.pedidos for each row
  execute function public.tg_auditoria('numero', 'status,pago,entregador_id,forma_pagamento,motivo_cancelamento,problema_entrega,motivo_reembolso');

create trigger auditoria after insert or update or delete on public.produtos for each row
  execute function public.tg_auditoria('nome', 'nome,preco,categoria_id,disponivel,ativo,destaque,descricao');
create trigger auditoria after insert or update or delete on public.produto_precos for each row
  execute function public.tg_auditoria('preco', 'preco');
create trigger auditoria after insert or update or delete on public.adicionais for each row
  execute function public.tg_auditoria('nome', 'nome,preco,ativo');
create trigger auditoria after insert or update or delete on public.promocoes for each row
  execute function public.tg_auditoria('nome');
create trigger auditoria after insert or update or delete on public.cupons for each row
  execute function public.tg_auditoria('codigo');
create trigger auditoria after insert or update or delete on public.bairros for each row
  execute function public.tg_auditoria('nome');
create trigger auditoria after insert or update or delete on public.faixas_entrega for each row
  execute function public.tg_auditoria('ate_km');
create trigger auditoria after insert or update or delete on public.entregadores for each row
  execute function public.tg_auditoria('nome', 'nome,telefone,valor_por_entrega,ativo');
create trigger auditoria after insert or update or delete on public.despesas for each row
  execute function public.tg_auditoria('descricao');
create trigger auditoria after update on public.insumos for each row
  execute function public.tg_auditoria('nome', 'nome,unidade,estoque_minimo,ativo');
create trigger auditoria after update on public.configuracoes for each row
  execute function public.tg_auditoria('nome_loja');
create trigger auditoria after update on public.config_fiscal for each row
  execute function public.tg_auditoria('ambiente');
create trigger auditoria after update on public.perfis for each row
  execute function public.tg_auditoria('nome', 'papel,ativo,nome');
create trigger auditoria after insert or delete on public.permissoes for each row
  execute function public.tg_auditoria('modulo');
