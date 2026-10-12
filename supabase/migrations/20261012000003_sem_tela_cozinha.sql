-- =====================================================================
-- Tia Cê Pizzas — a tela "Cozinha" saiu do painel
--
-- O preparo passa a ser acompanhado só no quadro de Pedidos, e o botão "Registrar desperdício" foi para lá.
-- * O módulo "cozinha" deixa de existir na matriz de permissões: quem o tinha passa a ter "pedidos"
--   (senão a função Cozinha ficaria sem nenhuma tela).
-- * Quem usa a tela de Pedidos pode registrar desperdício (antes: estoque ou cozinha).
-- As políticas antigas ainda citam pode('cozinha'); sem o módulo na tabela, esse trecho nunca é verdadeiro.
-- =====================================================================

insert into public.permissoes (papel, modulo)
select papel, 'pedidos' from public.permissoes where modulo = 'cozinha'
on conflict do nothing;

delete from public.permissoes where modulo = 'cozinha';

create or replace function public.insumos_para_desperdicio() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (pode('estoque') or pode('pedidos')) then raise exception 'Acesso negado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'unidade', unidade, 'quantidade', quantidade) order by nome)
    from insumos where ativo), '[]'::jsonb);
end $$;

create or replace function public.registrar_desperdicio(p_insumo uuid, p_quantidade numeric, p_observacao text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v insumos%rowtype;
begin
  if not (pode('estoque') or pode('pedidos')) then raise exception 'Acesso negado'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe a quantidade desperdiçada'; end if;
  if nullif(btrim(coalesce(p_observacao, '')), '') is null then raise exception 'Escreva o que aconteceu'; end if;
  select * into v from insumos where id = p_insumo and ativo;
  if not found then raise exception 'Insumo não encontrado'; end if;

  insert into estoque_movimentos (insumo_id, tipo, quantidade, observacao)
  values (p_insumo, 'desperdicio', p_quantidade, btrim(p_observacao));

  return jsonb_build_object(
    'insumo', v.nome, 'unidade', v.unidade,
    'restante', v.quantidade - p_quantidade,
    'valor', round(p_quantidade * v.custo_unitario, 2));
end $$;
