-- =====================================================================
-- Tia Cê Pizzas — aviso no celular do motoboy quando o pedido fica pronto
-- =====================================================================
-- O aplicativo Android (Tia Cê Entregas) registra aqui o "endereço" do aparelho para receber avisos
-- (Firebase Cloud Messaging). Quem envia o aviso é a função de servidor avisar-entregador, com a chave
-- mestra; ninguém lê esta tabela pelo site.
create table public.entregador_aparelhos (
  token text primary key,
  entregador_id uuid not null references public.entregadores (id) on delete cascade,
  atualizado_em timestamptz not null default now()
);
create index entregador_aparelhos_entregador on public.entregador_aparelhos (entregador_id);
alter table public.entregador_aparelhos enable row level security; -- sem políticas: fechada para o site
revoke all on public.entregador_aparelhos from anon, authenticated;

-- O motoboy liga os avisos neste aparelho ao entrar no aplicativo e desliga ao sair da conta.
create function public.entrega_aparelho(p_token text, p_ligar boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entregador uuid;
begin
  select id into v_entregador from entregadores where usuario_id = auth.uid() and ativo;
  if v_entregador is null then
    raise exception 'Acesso restrito aos entregadores';
  end if;
  if p_token is null or length(p_token) not between 20 and 4096 then
    raise exception 'Aparelho inválido';
  end if;
  if p_ligar then
    -- um aparelho avisa só o último motoboy que entrou nele
    insert into entregador_aparelhos (token, entregador_id) values (p_token, v_entregador)
    on conflict (token) do update set entregador_id = excluded.entregador_id, atualizado_em = now();
  else
    delete from entregador_aparelhos where token = p_token and entregador_id = v_entregador;
  end if;
end $$;
revoke execute on function public.entrega_aparelho(text, boolean) from public, anon;
grant execute on function public.entrega_aparelho(text, boolean) to authenticated, service_role;
