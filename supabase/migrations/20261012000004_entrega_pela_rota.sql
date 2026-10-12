-- =====================================================================
-- Tia Cê Pizzas — entrega cobrada pela distância das ruas, não em linha reta
--
-- Em linha reta, um endereço do outro lado do rio ficava muito mais "perto" do que o motoboy de fato roda
-- (caso real: 14,6 km em linha reta, 18,7 km pelo trajeto).
--
-- O trajeto é calculado no navegador (serviço de rotas do OpenStreetMap) e chega aqui como p_rota_km.
-- O banco não confia cegamente nele:
--   * nunca vale menos que a linha reta (ninguém consegue "encurtar" o caminho para pagar menos);
--   * acima de 4x a linha reta + 3 km é descartado como erro;
--   * sem trajeto (serviço fora do ar, site antigo em cache), usa a linha reta + 30%, que é a média das cidades.
-- =====================================================================

drop function public.calcular_entrega(numeric, numeric);

create function public.calcular_entrega(p_lat numeric, p_lng numeric, p_rota_km numeric default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c configuracoes%rowtype;
  f faixas_entrega%rowtype;
  v_reta numeric;
  d numeric;
  v_rota boolean := false;
begin
  select * into c from configuracoes where id = 1;
  if c.loja_lat is null or c.loja_lng is null then
    return jsonb_build_object('dentro', false, 'mensagem', 'A localização da loja ainda não foi configurada.');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('dentro', false, 'mensagem', 'Não foi possível localizar o endereço.');
  end if;
  v_reta := distancia_km(c.loja_lat, c.loja_lng, p_lat, p_lng);
  if p_rota_km >= 0 and p_rota_km <= v_reta * 4 + 3 then
    d := round(greatest(p_rota_km, v_reta), 2);
    v_rota := true;
  else
    d := round(v_reta * 1.3, 2);
  end if;
  select * into f from faixas_entrega where ativo and ate_km >= d order by ate_km limit 1;
  if not found then
    return jsonb_build_object('dentro', false, 'distancia_km', d, 'linha_reta_km', v_reta, 'por_rota', v_rota,
                              'mensagem', 'Este endereço está fora da nossa área de entrega.');
  end if;
  return jsonb_build_object('dentro', true, 'distancia_km', d, 'linha_reta_km', v_reta, 'por_rota', v_rota,
                            'taxa', f.taxa, 'tempo_extra_min', f.tempo_extra_min);
end $$;

revoke execute on function public.calcular_entrega(numeric, numeric, numeric) from public;
grant execute on function public.calcular_entrega(numeric, numeric, numeric) to anon, authenticated, service_role;

-- criar_pedido passa a usar o trajeto enviado junto com o endereço (endereco.rota_km).
-- A função é longa; troca-se só a chamada, e a migração falha se o trecho não for encontrado.
do $$
declare
  v_def text := pg_get_functiondef('public.criar_pedido(jsonb)'::regprocedure);
  v_de constant text := 'calcular_entrega(v_lat, v_lng)';
  v_para constant text := 'calcular_entrega(v_lat, v_lng, nullif(v_end ->> ''rota_km'', '''')::numeric)';
begin
  if position(v_de in v_def) = 0 then
    raise exception 'criar_pedido: trecho do cálculo de entrega não encontrado';
  end if;
  execute replace(v_def, v_de, v_para);
end $$;
