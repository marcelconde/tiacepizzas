-- =====================================================================
-- Tia Cê Pizzas — ninguém se cadastra sozinho com e-mail e senha
-- =====================================================================
-- No Supabase, desligar o cadastro por e-mail desliga também a ENTRADA por e-mail, que a equipe usa.
-- Por isso o provedor de e-mail fica ligado e a trava é feita aqui:
--  * o primeiro usuário de e-mail (criado no painel do Supabase) vira administrador;
--  * depois disso, usuário de e-mail só nasce pelo painel da pizzaria, que grava o papel em app_metadata;
--  * qualquer outra tentativa de cadastro por e-mail é recusada.
-- Clientes continuam entrando com Google/Facebook, sem perfil de equipe.
create or replace function public.tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_papel text := new.raw_app_meta_data ->> 'papel';
  v_nome text := coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1));
  v_email boolean := coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email';
  v_primeiro boolean;
begin
  select v_email and not exists (select 1 from perfis) into v_primeiro;
  if v_papel is null and not v_primeiro then
    if v_email then
      raise exception 'Cadastro por e-mail não é permitido. Usuários da equipe são criados no painel, em Configurações → Usuários.';
    end if;
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
