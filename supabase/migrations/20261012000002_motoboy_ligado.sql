-- =====================================================================
-- Tia Cê Pizzas — login de motoboy para um entregador que já está cadastrado
-- =====================================================================
-- Criar o usuário de um motoboy sempre criava um entregador novo. Quem já tinha sido cadastrado à mão em
-- Entregas → Entregadores ficava duplicado. Agora o login é ligado ao cadastro existente:
--  * o que o painel indicar (app_metadata.entregador_id), se ainda não tiver login;
--  * senão, um entregador sem login com o mesmo nome;
--  * só se não houver nenhum é que nasce um cadastro novo.
create or replace function public.tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_papel text := new.raw_app_meta_data ->> 'papel';
  v_nome text := coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1));
  v_primeiro boolean;
  v_entregador uuid;
begin
  if exists (select 1 from perfis where id = new.id) then
    return new; -- quem já é da equipe é administrado pelo painel
  end if;

  if v_papel is null then
    if tg_op = 'INSERT' and coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email' then
      update configuracoes set admin_criado = true where id = 1 and not admin_criado returning true into v_primeiro;
    end if;
    if v_primeiro is not true then
      return new; -- cliente: entra no site, nunca no painel
    end if;
  elsif v_papel = 'admin' then
    update configuracoes set admin_criado = true where id = 1 and not admin_criado;
  end if;

  insert into perfis (id, nome, email, papel, ativo)
  values (
    new.id, v_nome, new.email,
    case when v_primeiro then 'admin'::papel_usuario else v_papel::papel_usuario end,
    coalesce(v_primeiro, (new.raw_app_meta_data ->> 'ativo')::boolean, false)
  );

  if v_papel = 'motoboy' then
    select id into v_entregador from entregadores
    where usuario_id is null and id::text = new.raw_app_meta_data ->> 'entregador_id';
    if v_entregador is null then
      select id into v_entregador from entregadores
      where usuario_id is null and lower(btrim(nome)) = lower(btrim(v_nome))
      order by ativo desc limit 1;
    end if;
    if v_entregador is not null then
      update entregadores set usuario_id = new.id where id = v_entregador;
    else
      insert into entregadores (nome, usuario_id) values (v_nome, new.id);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_novo_usuario() from public, anon, authenticated;
