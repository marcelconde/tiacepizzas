-- =====================================================================
-- Tia Cê Pizzas — integrações com o Supabase (login, fotos e tempo real)
-- =====================================================================

-- Quem ganha perfil no painel:
--  * o primeiro usuário criado por e-mail e senha (no painel do Supabase) vira administrador;
--  * usuários criados pelo painel do sistema, que chegam com o papel em app_metadata (só o servidor grava ali).
-- Clientes que entram pelo site com Google/Facebook não ganham perfil: são apenas clientes.
create function public.tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_papel text := new.raw_app_meta_data ->> 'papel';
  v_nome text := coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1));
  v_primeiro boolean;
begin
  select not exists (select 1 from perfis) and coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email'
  into v_primeiro;
  if v_papel is null and not v_primeiro then
    return new;
  end if;

  insert into perfis (id, nome, email, papel, ativo)
  values (
    new.id, v_nome, new.email,
    case when v_primeiro then 'admin'::papel_usuario else v_papel::papel_usuario end,
    v_primeiro or coalesce((new.raw_app_meta_data ->> 'ativo')::boolean, false)
  );
  -- o motoboy já nasce ligado a um cadastro de entregador
  if v_papel = 'motoboy' and not v_primeiro then
    insert into entregadores (nome, usuario_id) values (v_nome, new.id);
  end if;
  return new;
end $$;
revoke execute on function public.tg_novo_usuario() from public, anon, authenticated;

create trigger novo_usuario after insert on auth.users
  for each row execute function public.tg_novo_usuario();

-- Fotos dos produtos
insert into storage.buckets (id, name, public) values ('produtos', 'produtos', true)
on conflict (id) do nothing;

create policy "fotos: leitura publica" on storage.objects for select
  using (bucket_id = 'produtos');
create policy "fotos: equipe envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and public.eh_staff());
create policy "fotos: equipe altera" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and public.eh_staff());
create policy "fotos: equipe remove" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and public.eh_staff());

-- Painel recebe pedidos novos em tempo real
alter publication supabase_realtime add table public.pedidos;
