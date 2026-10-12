-- =====================================================================
-- Tia Cê Pizzas — conta do cliente com e-mail e senha, pagamentos à equipe
-- e pagamento do motoboy por diária + entregas
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Despesa sem data usa o dia da loja, não o do servidor (que está em UTC:
--    das 21h à meia-noite ele já está no dia seguinte)
-- ---------------------------------------------------------------------
grant execute on function public.fuso() to anon, authenticated;
alter table public.despesas alter column data set default ((now() at time zone public.fuso())::date);

-- ---------------------------------------------------------------------
-- 2. Conta do cliente com e-mail e senha
-- ---------------------------------------------------------------------
-- Antes, todo cadastro por e-mail sem papel era recusado. Dois problemas:
--  * o cliente não podia criar conta sem Google/Facebook;
--  * o Supabase cria o usuário em dois passos (INSERT sem o papel, depois UPDATE do app_metadata),
--    então até os usuários criados pelo painel da pizzaria eram recusados no primeiro passo.
-- Agora quem nasce sem papel é cliente (sem perfil de equipe), e o perfil é criado quando o papel
-- aparece no app_metadata — no INSERT ou no UPDATE. Só o servidor grava app_metadata.
alter table public.configuracoes
  add column login_email boolean not null default true,
  add column cnpj text,
  -- o primeiro usuário de e-mail da instalação vira administrador, uma única vez
  add column admin_criado boolean not null default false;
update public.configuracoes set admin_criado = exists (select 1 from public.perfis where papel = 'admin');
grant select (login_email, cnpj) on public.configuracoes to anon, authenticated;

create or replace function public.tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_papel text := new.raw_app_meta_data ->> 'papel';
  v_nome text := coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1));
  v_primeiro boolean;
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
  -- o motoboy já nasce ligado a um cadastro de entregador
  if v_papel = 'motoboy' then
    insert into entregadores (nome, usuario_id) values (v_nome, new.id);
  end if;
  return new;
end $$;
revoke execute on function public.tg_novo_usuario() from public, anon, authenticated;

create trigger papel_usuario after update on auth.users
  for each row when (new.raw_app_meta_data is distinct from old.raw_app_meta_data)
  execute function public.tg_novo_usuario();

-- ---------------------------------------------------------------------
-- 3. Motoboy: diária + entregas
-- ---------------------------------------------------------------------
-- "taxa": recebe a taxa de entrega cobrada do cliente em cada pedido que entregou;
-- "fixo": recebe valor_por_entrega em cada entrega.
alter table public.entregadores
  add column diaria numeric(10,2) not null default 50 check (diaria >= 0),
  add column repasse text not null default 'taxa' check (repasse in ('taxa', 'fixo'));
-- quem já tinha um valor por entrega combinado continua recebendo assim
update public.entregadores set repasse = 'fixo', diaria = 0 where valor_por_entrega > 0;

drop trigger auditoria on public.entregadores;
create trigger auditoria after insert or update or delete on public.entregadores for each row
  execute function public.tg_auditoria('nome', 'nome,telefone,diaria,repasse,valor_por_entrega,ativo');

-- ---------------------------------------------------------------------
-- 4. Pagamentos à equipe: são despesas com o favorecido identificado
-- ---------------------------------------------------------------------
alter table public.despesas
  add column favorecido_tipo text check (favorecido_tipo in ('motoboy', 'cozinha', 'outro')),
  add column favorecido text,
  add column entregador_id uuid references public.entregadores (id) on delete set null,
  -- quando o dinheiro saiu do caixa aberto, a sangria que foi lançada junto
  add column caixa_movimento_id uuid references public.caixa_movimentos (id) on delete set null;
create index on public.despesas (entregador_id) where entregador_id is not null;

create function public.registrar_pagamento(
  p_tipo text,
  p_valor numeric,
  p_entregador uuid default null,
  p_nome text default null,
  p_data date default null,
  p_forma public.forma_pagamento default 'dinheiro',
  p_do_caixa boolean default false,
  p_observacao text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
  v_caixa uuid;
  v_mov uuid;
  v_id uuid;
begin
  if not pode('financeiro') then
    raise exception 'Acesso negado';
  end if;
  if p_tipo is null or p_tipo not in ('motoboy', 'cozinha', 'outro') then
    raise exception 'Escolha para quem é o pagamento';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe o valor do pagamento';
  end if;
  if p_tipo = 'motoboy' then
    select nome into v_nome from entregadores where id = p_entregador;
    if v_nome is null then
      raise exception 'Escolha o motoboy';
    end if;
  elsif v_nome is null then
    raise exception 'Informe o nome de quem recebeu';
  end if;

  if p_do_caixa then
    select id into v_caixa from caixas where fechado_em is null;
    if v_caixa is null then
      raise exception 'Não há caixa aberto. Abra o caixa ou desmarque a opção de tirar do dinheiro do caixa.';
    end if;
    insert into caixa_movimentos (caixa_id, tipo, forma_pagamento, valor, descricao, usuario_id)
    values (v_caixa, 'sangria', 'dinheiro', -p_valor, 'Pagamento — ' || v_nome, auth.uid())
    returning id into v_mov;
  end if;

  insert into despesas (descricao, categoria, valor, data, forma_pagamento, observacao, favorecido_tipo, favorecido, entregador_id, caixa_movimento_id)
  values (
    'Pagamento — ' || v_nome,
    case p_tipo when 'motoboy' then 'Motoboys' else 'Salários' end,
    p_valor,
    coalesce(p_data, (now() at time zone fuso())::date),
    case when p_do_caixa then 'dinheiro' else p_forma end,
    nullif(btrim(coalesce(p_observacao, '')), ''),
    p_tipo, v_nome,
    case when p_tipo = 'motoboy' then p_entregador end,
    v_mov
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'nome', v_nome, 'do_caixa', v_mov is not null);
end $$;

-- apagar o pagamento devolve o dinheiro ao caixa; se o caixa daquele dia já fechou, não apaga
create function public.tg_despesa_apagada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.caixa_movimento_id is not null and exists (select 1 from caixa_movimentos where id = old.caixa_movimento_id) then
    if not exists (
      select 1 from caixa_movimentos m join caixas c on c.id = m.caixa_id
      where m.id = old.caixa_movimento_id and c.fechado_em is null
    ) then
      raise exception 'Este pagamento saiu de um caixa que já foi fechado e não pode mais ser apagado.';
    end if;
    delete from caixa_movimentos where id = old.caixa_movimento_id;
  end if;
  return old;
end $$;
create trigger apagada after delete on public.despesas
  for each row execute function public.tg_despesa_apagada();

-- acerto do período: quanto cada motoboy tem a receber, quanto já foi pago e quanto falta
create function public.acerto_entregadores(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := fuso();
begin
  if not (pode('entregas') or pode('financeiro')) then
    raise exception 'Acesso negado';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(y) order by y.nome), '[]'::jsonb)
    from (
      select x.*, x.diarias + x.por_entregas as a_receber, x.diarias + x.por_entregas - x.pago as falta
      from (
        select e.id, e.nome, e.ativo, e.diaria, e.repasse, e.valor_por_entrega,
               coalesce(t.entregas, 0) as entregas,
               coalesce(t.dias, 0) as dias,
               coalesce(t.taxas, 0) as taxas,
               coalesce(t.dias, 0) * e.diaria as diarias,
               case e.repasse when 'taxa' then coalesce(t.taxas, 0) else coalesce(t.entregas, 0) * e.valor_por_entrega end as por_entregas,
               coalesce(g.pago, 0) as pago
        from entregadores e
        left join (
          -- só entregas concluídas; o dia é o do pedido, no fuso da loja
          select p.entregador_id, count(*) as entregas, count(distinct (p.criado_em at time zone tz)::date) as dias, sum(p.taxa_entrega) as taxas
          from pedidos p
          where p.tipo = 'entrega' and p.status = 'entregue' and p.entregador_id is not null
            and (p.criado_em at time zone tz)::date between p_inicio and p_fim
          group by p.entregador_id
        ) t on t.entregador_id = e.id
        left join (
          select d.entregador_id, sum(d.valor) as pago
          from despesas d
          where d.entregador_id is not null and d.data between p_inicio and p_fim
          group by d.entregador_id
        ) g on g.entregador_id = e.id
        where e.ativo or t.entregas > 0 or g.pago > 0
      ) x
    ) y
  );
end $$;

revoke execute on function
  public.registrar_pagamento(text, numeric, uuid, text, date, public.forma_pagamento, boolean, text),
  public.tg_despesa_apagada(),
  public.acerto_entregadores(date, date)
from public, anon, authenticated;
grant execute on function
  public.registrar_pagamento(text, numeric, uuid, text, date, public.forma_pagamento, boolean, text),
  public.acerto_entregadores(date, date)
to authenticated;
grant execute on function
  public.registrar_pagamento(text, numeric, uuid, text, date, public.forma_pagamento, boolean, text),
  public.tg_despesa_apagada(),
  public.acerto_entregadores(date, date)
to service_role;
