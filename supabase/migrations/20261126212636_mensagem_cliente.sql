-- =====================================================================
-- Tia Cê Pizzas — texto da mensagem para o cliente
-- =====================================================================
-- No pedido, o painel tem um botão que copia a mensagem para o cliente (com o número, a situação e o link de
-- acompanhamento) para colar no WhatsApp Web. O texto é da loja e muda em Configurações → Pedidos; vazio quer
-- dizer o texto padrão, que fica no painel (src/lib/mensagem.ts). É interno: o visitante não lê; a equipe recebe
-- por config_interna(). Pedido do Marcel em 2026-11-26.
alter table public.configuracoes
  add column mensagem_cliente text check (char_length(mensagem_cliente) <= 1000);

create or replace function public.config_interna() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when eh_staff() then (
    select jsonb_build_object(
      'auto_aceitar', auto_aceitar, 'impressao', impressao, 'alertas_pedido', alertas_pedido,
      'metas', metas, 'categorias_despesa', categorias_despesa, 'mensagem_cliente', mensagem_cliente)
    from configuracoes where id = 1
  ) end
$$;
revoke execute on function public.config_interna() from public, anon;
grant execute on function public.config_interna() to authenticated, service_role;
