-- =====================================================================
-- Tia Cê Pizzas — configurações internas fora do alcance do visitante
-- =====================================================================
-- O site precisa ler nome, horários, taxa, Pix… mas metas de faturamento, categorias de despesa,
-- alertas, impressão e aceite automático só interessam à equipe. A leitura da tabela passa a ser
-- por coluna, e a parte interna sai por uma função que só responde a quem é da equipe.
revoke select on public.configuracoes from anon, authenticated;
grant select (
  id, nome_loja, slogan, telefone, whatsapp, instagram, cep, logradouro, numero, bairro, cidade, uf, fuso_horario, horarios,
  loja_aberta_manual, aceita_pedidos_online, pedido_minimo, tempo_preparo_min, tempo_entrega_min, regra_preco_sabores,
  chave_pix, mensagem_aviso, modo_entrega, loja_lat, loja_lng, rastreio_motoboy, exigir_login, login_google, login_facebook,
  atualizado_em
) on public.configuracoes to anon, authenticated;

create function public.config_interna() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when eh_staff() then (
    select jsonb_build_object(
      'auto_aceitar', auto_aceitar, 'impressao', impressao, 'alertas_pedido', alertas_pedido,
      'metas', metas, 'categorias_despesa', categorias_despesa)
    from configuracoes where id = 1
  ) end
$$;
revoke execute on function public.config_interna() from public, anon;
grant execute on function public.config_interna() to authenticated, service_role;
