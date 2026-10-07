-- =====================================================================
-- Tia Cê Pizzas — integrações com o Supabase (login, fotos e tempo real)
-- =====================================================================

-- Todo usuário criado no Auth ganha um perfil. O primeiro vira admin;
-- os seguintes só entram se criados pelo painel (app_metadata é gravado
-- apenas pelo servidor, então ninguém se autopromove no cadastro).
create function public.tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_primeiro boolean;
begin
  select not exists (select 1 from perfis) into v_primeiro;
  insert into perfis (id, nome, email, papel, ativo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1)),
    new.email,
    case when v_primeiro then 'admin'::papel_usuario
         else coalesce((new.raw_app_meta_data ->> 'papel')::papel_usuario, 'atendente') end,
    v_primeiro or coalesce((new.raw_app_meta_data ->> 'ativo')::boolean, false)
  );
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
