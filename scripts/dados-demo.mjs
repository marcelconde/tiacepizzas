// Dados fictícios para explorar o sistema e tirar as capturas do manual:
// cerca de um mês de pedidos, clientes, compras de estoque e despesas, mais os pedidos "de hoje" em cada etapa.
// Usado por: npm run dev:demo

// gerador com semente fixa: os mesmos dados a cada execução
function aleatorio(semente) {
  let a = semente
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOMES = [
  'Mariana Alves', 'João Pedro Lima', 'Fernanda Costa', 'Rafael Souza', 'Camila Rocha', 'Lucas Martins', 'Patrícia Gomes', 'Bruno Carvalho',
  'Juliana Ribeiro', 'Thiago Almeida', 'Aline Barbosa', 'Diego Fernandes', 'Larissa Pinto', 'Gustavo Araújo', 'Renata Cardoso', 'Marcelo Teixeira',
  'Vanessa Moreira', 'Felipe Correia', 'Beatriz Nunes', 'André Batista', 'Sabrina Dias', 'Rodrigo Mendes', 'Letícia Castro', 'Eduardo Freitas',
  'Priscila Ramos', 'Vinícius Lopes', 'Tatiane Cavalcanti', 'Leandro Azevedo',
]
const RUAS = ['Rua Augusta', 'Alameda Santos', 'Rua da Consolação', 'Rua Bela Cintra', 'Alameda Jaú', 'Rua Haddock Lobo', 'Rua Frei Caneca', 'Rua Oscar Freire', 'Alameda Lorena', 'Rua Peixoto Gomide']

export async function popular(db) {
  const r = aleatorio(20261008)
  const sorteio = (itens, pesos) => {
    let x = r() * pesos.reduce((a, b) => a + b, 0)
    for (let i = 0; i < itens.length; i++) if ((x -= pesos[i]) <= 0) return itens[i]
    return itens[itens.length - 1]
  }
  const entre = (a, b) => a + Math.floor(r() * (b - a + 1))
  const q = async (sql, p) => (await db.query(sql, p)).rows
  const como = (uid) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  const mais = (data, minutos) => new Date(data.getTime() + minutos * 60000)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const admin = (await q(`select id from perfis where papel = 'admin' limit 1`))[0].id
  const id = Object.fromEntries((await q(`select nome, id from produtos union all select nome, id from tamanhos union all select nome, id from bairros union all select nome, id from adicionais`)).map((x) => [x.nome, x.id]))
  const entregadores = (await q(`select id from entregadores order by nome`)).map((x) => x.id)
  const pizzas = ['Mussarela', 'Calabresa', 'Marguerita', 'Portuguesa', 'Frango com Catupiry', 'Quatro Queijos', 'Tia Cê', 'Carne Seca', 'Pepperoni', 'Bacon com Milho', 'Brigadeiro', 'Romeu e Julieta', 'Banana com Canela']
  const pesoPizza = [9, 12, 5, 6, 10, 6, 9, 3, 6, 4, 3, 2, 1]
  const bebidas = ['Coca-Cola 2L', 'Guaraná Antarctica 2L', 'Refrigerante lata 350ml', 'Suco natural 500ml', 'Água mineral 500ml']
  const bairros = [['Centro', 5], ['Bairros próximos (até 3 km)', 4], ['Bairros distantes (até 6 km)', 2]]

  // clientes: os primeiros da lista pedem com mais frequência
  const clientes = NOMES.map((nome, i) => {
    const [bairro] = sorteio(bairros, bairros.map((b) => b[1]))
    return {
      nome, telefone: `119${String(70000000 + i * 137911).slice(0, 8)}`, peso: i < 5 ? 8 : i < 12 ? 4 : 1.5,
      endereco: { logradouro: RUAS[i % RUAS.length], numero: String(100 + i * 37), complemento: i % 3 === 0 ? `Apto ${10 + i}` : '', bairro_id: id[bairro], cidade: 'São Paulo', uf: 'SP', lat: -23.565 + (r() - 0.5) * 0.05, lng: -46.652 + (r() - 0.5) * 0.05 },
    }
  })

  function itens() {
    const lista = []
    const qtd = sorteio([1, 2, 3], [60, 32, 8])
    for (let i = 0; i < qtd; i++) {
      const tamanho = sorteio(['Broto', 'Média', 'Grande', 'Família'], [8, 20, 55, 17])
      const sabor = sorteio(pizzas, pesoPizza)
      const meio = tamanho !== 'Broto' && r() < 0.35
      lista.push({
        produto_id: id[sabor], tamanho_id: id[tamanho], sabores: meio ? [id[sabor], id[sorteio(pizzas, pesoPizza)]] : undefined,
        adicionais: r() < 0.25 ? [id[sorteio(['Borda de catupiry', 'Borda de cheddar', 'Borda de chocolate'], [6, 3, 1])]] : [], quantidade: 1,
        observacoes: r() < 0.08 ? sorteio(['Sem cebola', 'Bem assada', 'Cortar em 12 pedaços'], [4, 3, 1]) : '',
      })
    }
    if (r() < 0.55) lista.push({ produto_id: id[sorteio(bebidas, [10, 6, 5, 2, 1])], quantidade: sorteio([1, 2], [4, 1]) })
    return lista
  }

  async function pedido(quando, extra = {}) {
    const c = sorteio(clientes, clientes.map((x) => x.peso))
    const tipo = extra.tipo ?? sorteio(['entrega', 'retirada', 'balcao'], [70, 20, 10])
    const pagamento = sorteio(['pix', 'credito', 'debito', 'dinheiro'], [40, 25, 15, 20])
    await como(admin)
    const p = (await q(`select criar_pedido($1::jsonb) as r`, [JSON.stringify({
      painel: true, tipo, origem: tipo === 'balcao' ? 'balcao' : sorteio(['site', 'whatsapp', 'telefone'], [60, 25, 15]),
      cliente: tipo === 'balcao' && r() < 0.6 ? { nome: 'Cliente balcão' } : { nome: c.nome, telefone: c.telefone },
      endereco: tipo === 'entrega' ? c.endereco : null, itens: itens(), forma_pagamento: pagamento,
      troco_para: pagamento === 'dinheiro' && r() < 0.5 ? 200 : null, status: 'novo', ...extra.pedido,
    })]))[0].r
    await como(null) // daqui em diante sem usuário: a auditoria ignora os ajustes de datas
    await db.query(`update pedidos set criado_em = $2, status_em = $2 where id = $1`, [p.id, quando])
    return { ...p, tipo, quando, endereco: c.endereco }
  }

  // leva o pedido até uma etapa, com os horários coerentes a partir da hora do pedido
  async function avancar(p, ate, opcoes = {}) {
    const preparo = entre(16, 34); const entrega = entre(12, 28)
    const t = { confirmado: mais(p.quando, entre(1, 4)), em_preparo: mais(p.quando, entre(4, 8)), pronto: mais(p.quando, 8 + preparo), saiu_entrega: mais(p.quando, 11 + preparo), entregue: mais(p.quando, (p.tipo === 'entrega' ? 11 + entrega : 14) + preparo) }
    const ordem = ['confirmado', 'em_preparo', 'pronto', ...(p.tipo === 'entrega' ? ['saiu_entrega'] : []), 'entregue']
    const entregador = p.tipo === 'entrega' ? (opcoes.entregador ?? entregadores[entre(0, entregadores.length - 1)]) : null
    for (const s of ordem) {
      await db.query(`update pedidos set status = $2, entregador_id = $3, pago = $4 where id = $1`, [p.id, s, entregador, s === 'entregue'])
      if (s === ate) break
    }
    await db.query(
      `update pedidos set confirmado_em = least(confirmado_em, $2), preparo_em = case when preparo_em is not null then $3::timestamptz end,
         pronto_em = case when pronto_em is not null then $4::timestamptz end, saiu_em = case when saiu_em is not null then $5::timestamptz end,
         entregue_em = case when entregue_em is not null then $6::timestamptz end, pago_em = case when pago then $6::timestamptz end,
         status_em = $7, previsao_em = $8 where id = $1`,
      [p.id, t.confirmado, t.em_preparo, t.pronto, t.saiu_entrega, t.entregue, opcoes.paradoDesde ?? t[ate], mais(p.quando, 60)],
    )
    await db.query(`update estoque_movimentos set criado_em = $2 where pedido_id = $1`, [p.id, t.confirmado])
  }

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const noDia = (dia, h, m) => { const d = new Date(dia); d.setHours(h, m, entre(0, 59), 0); return d }

  // ---------------- histórico: do dia -34 até ontem
  for (let atras = 34; atras >= 1; atras--) {
    const dia = new Date(hoje); dia.setDate(dia.getDate() - atras)
    const semana = dia.getDay()
    if (semana === 1) continue // segunda fechado
    const total = Math.round((semana === 5 || semana === 6 ? entre(15, 21) : semana === 0 ? entre(10, 14) : entre(6, 10)) * (1 + (34 - atras) * 0.006)) // leve crescimento
    const horarios = Array.from({ length: total }, () => noDia(dia, sorteio([18, 19, 20, 21, 22, 23], [2, 6, 8, 6, 4, 1]), entre(0, 59))).sort((a, b) => a - b)
    for (const quando of horarios) {
      const p = await pedido(quando)
      const sorte = r()
      if (sorte < 0.04) {
        await db.query(`update pedidos set status = 'cancelado', motivo_cancelamento = $2 where id = $1`, [p.id, sorteio(['Cliente desistiu', 'Endereço fora da área', 'Pedido em duplicidade'], [5, 2, 2])])
        await db.query(`update pedidos set cancelado_em = $2, status_em = $2 where id = $1`, [p.id, mais(quando, entre(2, 9))])
      } else {
        await avancar(p, 'entregue')
        if (sorte > 0.992) await db.query(`update pedidos set status = 'reembolsado', motivo_reembolso = 'Pizza chegou fria' where id = $1`, [p.id])
      }
    }
    // compras da semana (quarta) e despesas fixas
    if (semana === 3) {
      for (const [insumo, qtd, custo] of [['Farinha de trigo', 25, 4.6], ['Mussarela', 28, 38.5], ['Molho de tomate', 10, 9.2], ['Calabresa', 9, 26.5], ['Frango desfiado', 5, 22], ['Catupiry', 6, 32.5], ['Bacon', 3, 43], ['Caixa de pizza', 120, 1.8], ['Chocolate ao leite', 2, 45]]) {
        await db.query(`insert into estoque_movimentos (insumo_id, tipo, quantidade, custo_unitario, observacao, criado_em) select id, 'entrada', $2::numeric, $3::numeric, 'Compra da semana', $4::timestamptz from insumos where nome = $1`, [insumo, qtd, custo, noDia(dia, 15, 0)])
      }
      await db.query(`insert into despesas (descricao, categoria, valor, data, forma_pagamento) values ('Compra da semana — atacado', 'Ingredientes', $1, $2, 'pix'), ('Acerto dos motoboys', 'Motoboys', $3, $2, 'dinheiro')`, [entre(1650, 2050), iso(dia), entre(380, 520)])
    }
    if (semana === 2 && atras % 2 === 0) await db.query(`insert into despesas (descricao, categoria, valor, data, forma_pagamento) values ('Botijão de gás P45', 'Gás', 420, $1, 'pix'), ('Caixas e sacolas', 'Embalagens', $2, $1, 'credito')`, [iso(dia), entre(180, 260)])
  }
  const mes = (d) => { const x = new Date(hoje); x.setDate(x.getDate() - d); return x }
  await db.query(
    `insert into despesas (descricao, categoria, valor, data, forma_pagamento) values
      ('Aluguel do ponto', 'Aluguel', 2500, $1, 'pix'), ('Conta de luz', 'Energia', 684.30, $2, 'pix'), ('Conta de água', 'Água', 142.80, $2, 'pix'),
      ('Internet e telefone', 'Internet e telefone', 129.90, $3, 'debito'), ('Salário — ajudante de cozinha', 'Salários', 1900, $4, 'pix'),
      ('Impulsionamento no Instagram', 'Marketing', 150, $3, 'credito'), ('Conserto do forno', 'Manutenção', 280, $5, 'dinheiro')`,
    [mes(26), mes(18), mes(12), mes(4), mes(9)].map(iso),
  )
  await db.query(`insert into estoque_movimentos (insumo_id, tipo, quantidade, observacao, criado_em) select id, 'perda', 1.2, 'Venceu na geladeira', $1::timestamptz from insumos where nome = 'Frango desfiado'`, [mes(6)])
  // desperdício registrado pela cozinha ao longo do mês
  const cozinheiro = (await q(`select id from perfis where papel = 'cozinha' limit 1`))[0]?.id ?? admin
  for (const [insumo, qtd, motivo, dias] of [
    ['Mussarela', 0.25, 'A porção caiu no chão ao montar a pizza', 1],
    ['Catupiry', 0.2, 'Pizza montada com o sabor errado', 3],
    ['Calabresa', 0.15, 'Queimou no forno', 8],
    ['Molho de tomate', 0.4, 'O pote virou na bancada', 15],
    ['Mussarela', 0.3, 'Caiu no chão', 21],
  ]) {
    await db.query(
      `insert into estoque_movimentos (insumo_id, tipo, quantidade, observacao, usuario_id, criado_em) select id, 'desperdicio', $2::numeric, $3, $4, $5::timestamptz from insumos where nome = $1`,
      [insumo, qtd, motivo, cozinheiro, mes(dias)],
    )
  }

  // estoque de hoje: tudo em nível saudável, menos dois itens para mostrar o alerta de reposição
  await db.exec(`
    update insumos set quantidade = greatest(estoque_minimo * 2.4, 6);
    update insumos set quantidade = 1.4 where nome = 'Bacon';
    update insumos set quantidade = 2.1 where nome = 'Catupiry';
  `)
  await db.exec(`update clientes c set criado_em = coalesce((select min(criado_em) from pedidos p where p.cliente_id = c.id), c.criado_em)`)

  // ---------------- cliente com conta (a mesma do "Entrar com Google" simulado)
  const carla = (await q(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('carla.google@teste.local', '{"full_name":"Carla Cliente"}', '{"provider":"google"}') returning id`))[0].id
  await como(carla)
  const conta = (await q(`select minha_conta() as r`))[0].r
  await como(null)
  await db.query(`update clientes set telefone = '11955550000', criado_em = $2 where id = $1`, [conta.id, mes(20)])
  await db.query(
    `insert into enderecos (cliente_id, cep, logradouro, numero, complemento, bairro_id, bairro, cidade, uf, referencia, lat, lng) values
      ($1, '01311-000', 'Rua Augusta', '1500', 'Apto 42', $2, 'Centro', 'São Paulo', 'SP', 'Prédio azul, portaria 24h', -23.5575, -46.6590),
      ($1, '01415-000', 'Rua Bela Cintra', '800', null, $2, 'Centro', 'São Paulo', 'SP', 'Trabalho', -23.5560, -46.6625)`,
    [conta.id, id.Centro],
  )
  for (const atras of [15, 8, 3]) {
    const quando = noDia(mes(atras), 20, 15)
    await como(carla)
    const p = (await q(`select criar_pedido($1::jsonb) as r`, [JSON.stringify({ tipo: 'entrega', cliente: { nome: 'Carla Cliente', telefone: '11955550000' }, endereco: { logradouro: 'Rua Augusta', numero: '1500', complemento: 'Apto 42', bairro_id: id.Centro, cidade: 'São Paulo', uf: 'SP', lat: -23.5575, lng: -46.659 }, itens: itens(), forma_pagamento: 'pix' })]))[0].r
    await como(null)
    await db.query(`update pedidos set criado_em = $2, status_em = $2 where id = $1`, [p.id, quando])
    await avancar({ ...p, tipo: 'entrega', quando }, 'entregue')
  }

  // ---------------- hoje: caixa aberto, vendas concluídas e um pedido em cada etapa
  const agora = new Date()
  const ha = (min) => mais(agora, -min)
  await como(admin)
  await db.query(`select abrir_caixa(150)`)
  await como(null)
  await db.query(`update caixas set aberto_em = $1 where fechado_em is null`, [ha(190)])
  for (const min of [175, 160, 150, 138, 121, 110, 96, 88, 74]) await avancar(await pedido(ha(min)), 'entregue')
  await db.query(`insert into caixa_movimentos (caixa_id, tipo, valor, descricao, criado_em) select id, 'sangria', -60, 'Troco para o motoboy', $1::timestamptz from caixas where fechado_em is null`, [ha(100)])
  await db.query(`update caixa_movimentos m set criado_em = p.pago_em from pedidos p where p.id = m.pedido_id and m.tipo = 'venda' and p.criado_em > $1`, [ha(200)])

  const carlos = (await q(`select id from entregadores where nome = 'Carlos Moto'`))[0].id
  const emPreparo = { tipo: 'entrega', pedido: { origem: 'site' } }
  await avancar(await pedido(ha(58), emPreparo), 'em_preparo', { paradoDesde: ha(47) })            // crítico
  await avancar(await pedido(ha(36), emPreparo), 'em_preparo', { paradoDesde: ha(28) })            // atrasado
  await avancar(await pedido(ha(22), { tipo: 'retirada' }), 'pronto', { paradoDesde: ha(17) })     // atenção
  await avancar(await pedido(ha(31), { tipo: 'entrega' }), 'saiu_entrega', { entregador: carlos, paradoDesde: ha(9) })
  const problema = await pedido(ha(52), { tipo: 'entrega' })
  await avancar(problema, 'saiu_entrega', { entregador: entregadores.find((e) => e !== carlos), paradoDesde: ha(12) })
  await db.query(`update pedidos set status = 'problema_entrega', problema_entrega = 'Cliente não atende o interfone' where id = $1`, [problema.id])
  await db.query(`update pedidos set status_em = $2 where id = $1`, [problema.id, ha(6)])
  await avancar(await pedido(ha(12), { tipo: 'entrega', pedido: { entregador: carlos } }), 'em_preparo', { entregador: carlos, paradoDesde: ha(6) })
  await avancar(await pedido(ha(9), { tipo: 'entrega' }), 'confirmado', { paradoDesde: ha(7) })
  await pedido(ha(3), { tipo: 'entrega', pedido: { origem: 'site' } })
  await pedido(ha(1), { tipo: 'retirada', pedido: { origem: 'site' } })
  // o motoboy "na rua" já tem uma posição recente, para o mapa do acompanhamento
  await db.query(`update entregadores set lat = -23.5612, lng = -46.6561, posicao_em = now() + interval '12 hours' where id = $1`, [carlos])

  // a geração acima não deve aparecer na trilha de auditoria: ficam só alguns exemplos reais de alteração
  await db.exec(`delete from auditoria`)
  await como(admin)
  await db.query(`update produto_precos set preco = 60 where produto_id = $1 and tamanho_id = $2`, [id.Mussarela, id.Grande])
  await db.query(`update produto_precos set preco = 58 where produto_id = $1 and tamanho_id = $2`, [id.Mussarela, id.Grande])
  await db.query(`update bairros set taxa_entrega = 8 where nome = 'Bairros próximos (até 3 km)'`)
  await db.query(`update bairros set taxa_entrega = 7 where nome = 'Bairros próximos (até 3 km)'`)
  await db.query(`update produtos set disponivel = false where nome = 'Carne Seca'`)
  await db.query(`insert into estoque_movimentos (insumo_id, tipo, quantidade, observacao) select id, 'ajuste', -0.4, 'Contagem de estoque' from insumos where nome = 'Calabresa'`)
  await db.query(`update configuracoes set tempo_preparo_min = 35`)
  await como(null)
  console.log(`dados de demonstração: ${(await q(`select count(*)::int as n from pedidos`))[0].n} pedidos gerados`)
}
