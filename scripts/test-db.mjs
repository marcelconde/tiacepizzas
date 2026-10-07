// Testa as migrações e as regras de negócio do banco num Postgres em memória (PGlite).
// Uso: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase')
const db = new PGlite()

// O mínimo do ambiente Supabase que as migrações esperam encontrar.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text,
    raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}'
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
`)

for (const arquivo of readdirSync(join(raiz, 'migrations')).sort()) {
  await db.exec(readFileSync(join(raiz, 'migrations', arquivo), 'utf8'))
  console.log('migração ok:', arquivo)
}
await db.exec(readFileSync(join(raiz, 'seed.sql'), 'utf8'))
console.log('seed ok')

let ok = 0
async function teste(nome, fn) {
  try {
    await fn()
    ok++
    console.log('  ✓', nome)
  } catch (e) {
    console.error('  ✗', nome, '\n   ', e.message)
    process.exitCode = 1
  }
}
const q = async (sql, params) => (await db.query(sql, params)).rows
const um = async (sql, params) => (await q(sql, params))[0]
async function como(papel, uid, fn) {
  await db.exec(`set role ${papel}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≠ ${b}`)
const falha = (promessa, trecho) =>
  promessa.then(
    () => assert.fail(`deveria falhar com "${trecho}"`),
    (e) => assert.match(e.message, new RegExp(trecho, 'i')),
  )

// usuários
const admin = (await um(`insert into auth.users (email) values ('dona@tiacepizzas.com.br') returning id`)).id
const intruso = (
  await um(
    `insert into auth.users (email, raw_user_meta_data) values ('x@x.com', '{"papel":"admin","ativo":true}') returning id`,
  )
).id

const id = async (tabela, nome) => (await um(`select id from ${tabela} where nome = $1`, [nome])).id
const grande = await id('tamanhos', 'Grande')
const broto = await id('tamanhos', 'Broto')
const mussarela = await id('produtos', 'Mussarela')
const quatroQueijos = await id('produtos', 'Quatro Queijos')
const calabresa = await id('produtos', 'Calabresa')
const coca = await id('produtos', 'Coca-Cola 2L')
const centro = await id('bairros', 'Centro')
const bordaCatupiry = await id('adicionais', 'Borda de catupiry')
const estoque = async (nome) => Number((await um(`select quantidade from insumos where nome = $1`, [nome])).quantidade)
const criar = (payload) => um(`select criar_pedido($1::jsonb) as r`, [JSON.stringify(payload)]).then((x) => x.r)

const pedidoSite = {
  tipo: 'entrega',
  cliente: { nome: 'Maria Souza', telefone: '(11) 98888-7777' },
  endereco: { logradouro: 'Rua das Flores', numero: '10', bairro_id: centro },
  forma_pagamento: 'dinheiro',
  troco_para: 200,
  itens: [
    { produto_id: mussarela, tamanho_id: grande, sabores: [mussarela, quatroQueijos], adicionais: [bordaCatupiry], quantidade: 1 },
    { produto_id: coca, quantidade: 2 },
  ],
}

console.log('\nSegurança')
await db.exec(`update configuracoes set loja_aberta_manual = true`)

await teste('primeiro usuário vira admin; os demais entram inativos mesmo forjando metadados', async () => {
  const perfis = await q(`select email, papel, ativo from perfis order by criado_em, email`)
  assert.deepEqual(perfis.find((p) => p.email === 'dona@tiacepizzas.com.br'), {
    email: 'dona@tiacepizzas.com.br', papel: 'admin', ativo: true,
  })
  assert.deepEqual(perfis.find((p) => p.email === 'x@x.com'), { email: 'x@x.com', papel: 'atendente', ativo: false })
})

await teste('visitante lê o cardápio, mas não lê pedidos, clientes nem caixa', async () => {
  await como('anon', null, async () => {
    assert.ok((await q(`select * from produtos`)).length > 0)
    for (const t of ['pedidos', 'clientes', 'caixas', 'insumos', 'perfis', 'notas_fiscais', 'config_fiscal']) {
      await falha(q(`select * from ${t}`), 'permission denied')
    }
    await falha(q(`insert into produtos (categoria_id, nome) select id, 'x' from categorias limit 1`), 'permission denied')
    await falha(q(`select relatorio_faturamento(current_date, current_date)`), 'permission denied')
    await falha(q(`select baixar_estoque_pedido(gen_random_uuid(), false)`), 'permission denied')
  })
})

await teste('usuário logado porém inativo não enxerga nada da operação', async () => {
  await como('authenticated', intruso, async () => {
    assert.equal((await q(`select * from pedidos`)).length, 0)
    assert.equal((await q(`select * from clientes`)).length, 0)
    await falha(q(`select abrir_caixa(100)`), 'Acesso negado')
    await falha(q(`select relatorio_faturamento(current_date, current_date)`), 'Acesso negado')
    await db.query(`update perfis set papel = 'admin', ativo = true where id = $1`, [intruso])
    assert.equal((await um(`select ativo from perfis where id = $1`, [intruso])).ativo, false)
  })
})

console.log('\nPedidos do site')
let pedido
await teste('preço é calculado no servidor (meio a meio = maior preço + borda)', async () => {
  await como('anon', null, async () => {
    pedido = await criar({ ...pedidoSite, itens: pedidoSite.itens.map((i) => ({ ...i, preco_unitario: 0.01 })) })
  })
  // Quatro Queijos G 62 (maior que Mussarela 58) + borda 10 = 72; 2 Cocas = 28; taxa 5
  assert.equal(Number(pedido.total), 72 + 28 + 5)
  assert.equal(pedido.status, 'novo')
  const p = await um(`select * from pedidos where id = $1`, [pedido.id])
  assert.equal(Number(p.troco_para), 200)
  assert.equal(p.cliente_telefone, '11988887777')
  const itens = await q(`select nome from pedido_itens where pedido_id = $1 order by ordem`, [pedido.id])
  assert.equal(itens[0].nome, '1/2 Mussarela + 1/2 Quatro Queijos (Grande)')
})

await teste('recusa: loja fechada, sabores demais, bairro inválido, produto indisponível', async () => {
  await como('anon', null, async () => {
    await falha(criar({ ...pedidoSite, itens: [{ produto_id: mussarela, tamanho_id: broto, sabores: [mussarela, calabresa] }] }), 'aceita até 1 sabor')
    await falha(criar({ ...pedidoSite, endereco: { logradouro: 'Rua A', numero: '1' } }), 'bairro atendido')
    await falha(criar({ ...pedidoSite, tipo: 'balcao' }), 'inválido')
    await falha(criar({ ...pedidoSite, cliente: { nome: 'Zé', telefone: '123' } }), 'telefone válido')
    await falha(criar({ ...pedidoSite, itens: [] }), 'vazio')
  })
  await db.exec(`update produtos set disponivel = false where nome = 'Calabresa'`)
  await como('anon', null, () => falha(criar({ ...pedidoSite, itens: [{ produto_id: calabresa, tamanho_id: grande }] }), 'indisponível'))
  await db.exec(`update produtos set disponivel = true where nome = 'Calabresa'; update configuracoes set loja_aberta_manual = false`)
  await como('anon', null, () => falha(criar(pedidoSite), 'fechada'))
  await db.exec(`update configuracoes set loja_aberta_manual = true`)
})

await teste('visitante não consegue se passar por atendente (status/pago/desconto ignorados)', async () => {
  let r
  await como('anon', null, async () => {
    r = await criar({ ...pedidoSite, status: 'entregue', pago: true, desconto: 100, taxa_entrega: 0, origem: 'balcao' })
  })
  const p = await um(`select status, pago, desconto, taxa_entrega, origem from pedidos where id = $1`, [r.id])
  assert.deepEqual({ ...p, desconto: Number(p.desconto), taxa_entrega: Number(p.taxa_entrega) }, {
    status: 'novo', pago: false, desconto: 0, taxa_entrega: 5, origem: 'site',
  })
})

await teste('limite de pedidos pendentes por telefone', async () => {
  await como('anon', null, async () => {
    await criar(pedidoSite)
    await falha(criar(pedidoSite), 'aguardando confirmação')
  })
})

await teste('acompanhamento público não expõe telefone nem endereço', async () => {
  await como('anon', null, async () => {
    const a = (await um(`select acompanhar_pedido($1) as r`, [pedido.codigo.toLowerCase()])).r
    assert.equal(a.status, 'novo')
    assert.equal(a.nome, 'Maria')
    assert.equal(a.itens.length, 2)
    assert.ok(!JSON.stringify(a).includes('98888') && !JSON.stringify(a).includes('Flores'))
    assert.equal((await um(`select acompanhar_pedido('NAOEXISTE') as r`)).r, null)
  })
})

await teste('cupom: valida, aplica e respeita o mínimo', async () => {
  await como('anon', null, async () => {
    const v = (await um(`select validar_cupom('bemvindo10', 100) as r`)).r
    assert.deepEqual([v.valido, Number(v.desconto)], [true, 10])
    assert.equal((await um(`select validar_cupom('BEMVINDO10', 20) as r`)).r.valido, false)
    await falha(criar({ ...pedidoSite, cliente: { nome: 'Ana', telefone: '11977776666' }, cupom: 'NAOEXISTE' }), 'Cupom inválido')
    const r = await criar({ ...pedidoSite, cliente: { nome: 'Ana', telefone: '11977776666' }, cupom: 'bemvindo10' })
    assert.equal(Number(r.total), 100 * 0.9 + 5)
  })
  assert.equal((await um(`select usos from cupons where codigo = 'BEMVINDO10'`)).usos, 1)
})

console.log('\nOperação (estoque, caixa, relatório)')
await teste('confirmar pedido baixa estoque pela ficha técnica; cancelar estorna', async () => {
  const antes = { mussarela: await estoque('Mussarela'), catupiry: await estoque('Catupiry'), caixa: await estoque('Caixa de pizza') }
  await como('authenticated', admin, () => db.query(`update pedidos set status = 'confirmado' where id = $1`, [pedido.id]))
  // meia Mussarela (0,28/2) + meia Quatro Queijos (0,28/2) = 0,28 kg de mussarela
  perto(await estoque('Mussarela'), antes.mussarela - 0.28)
  // meia Quatro Queijos (0,098/2) + borda de catupiry (0,10)
  perto(await estoque('Catupiry'), antes.catupiry - 0.049 - 0.1)
  assert.equal(await estoque('Caixa de pizza'), antes.caixa - 1)
  const p = await um(`select estoque_baixado, confirmado_em, previsao_em from pedidos where id = $1`, [pedido.id])
  assert.ok(p.estoque_baixado && p.confirmado_em && p.previsao_em)

  await como('authenticated', admin, () => db.query(`update pedidos set status = 'em_preparo' where id = $1`, [pedido.id]))
  perto(await estoque('Mussarela'), antes.mussarela - 0.28, 'não baixa duas vezes')

  await como('authenticated', admin, () => db.query(`update pedidos set status = 'cancelado', motivo_cancelamento = 'teste' where id = $1`, [pedido.id]))
  assert.equal(await estoque('Mussarela'), antes.mussarela)
  assert.equal(await estoque('Catupiry'), antes.catupiry)
  await como('authenticated', admin, () => falha(db.query(`update pedidos set status = 'confirmado' where id = $1`, [pedido.id]), 'não pode ser reaberto'))
})

await teste('entrada de estoque recalcula o custo médio ponderado', async () => {
  // 30 kg a 38,00 + 10 kg a 46,00 = 40 kg a 40,00
  await db.query(`update insumos set quantidade = 30, custo_unitario = 38 where nome = 'Mussarela'`)
  await como('authenticated', admin, () =>
    db.query(`insert into estoque_movimentos (insumo_id, tipo, quantidade, custo_unitario) select id, 'entrada', 10, 46 from insumos where nome = 'Mussarela'`))
  const i = await um(`select quantidade, custo_unitario from insumos where nome = 'Mussarela'`)
  assert.deepEqual([Number(i.quantidade), Number(i.custo_unitario)], [40, 40])
  await como('authenticated', admin, () =>
    db.query(`insert into estoque_movimentos (insumo_id, tipo, quantidade) select id, 'perda', 2 from insumos where nome = 'Mussarela'`))
  assert.equal(await estoque('Mussarela'), 38)
})

let balcao
await teste('caixa: abertura, venda do balcão paga, sangria, estorno e fechamento', async () => {
  await como('authenticated', admin, async () => {
    await db.query(`select abrir_caixa(100)`)
    await falha(db.query(`select abrir_caixa(50)`), 'Já existe um caixa aberto')
    balcao = await criar({
      tipo: 'balcao', origem: 'balcao', cliente: { nome: 'Cliente balcão' }, forma_pagamento: 'dinheiro', pago: true, desconto: 8,
      itens: [{ produto_id: calabresa, tamanho_id: grande }, { produto_id: coca }],
    })
    assert.equal(balcao.status, 'confirmado')
    assert.equal(Number(balcao.total), 58 + 14 - 8)
    const pix = await criar({
      tipo: 'retirada', origem: 'telefone', cliente: { nome: 'João', telefone: '11955554444' }, forma_pagamento: 'pix',
      itens: [{ produto_id: mussarela, tamanho_id: broto }],
    })
    await db.query(`update pedidos set status = 'entregue', pago = true where id = $1`, [pix.id])
    await db.query(`insert into caixa_movimentos (caixa_id, tipo, valor, descricao) select id, 'sangria', -30, 'Troco motoboy' from caixas where fechado_em is null`)
    const caixa = (await um(`select id from caixas where fechado_em is null`)).id
    let r = (await um(`select resumo_caixa($1) as r`, [caixa])).r
    assert.deepEqual(
      [Number(r.vendas), r.qtd_vendas, Number(r.sangrias), Number(r.esperado_dinheiro), Number(r.por_forma.pix)],
      [64 + 32, 2, 30, 100 + 64 - 30, 32],
    )
    // cancelar um pedido pago estorna no caixa
    await db.query(`update pedidos set status = 'cancelado' where id = $1`, [pix.id])
    r = (await um(`select resumo_caixa($1) as r`, [caixa])).r
    assert.equal(Number(r.vendas), 64)
    const f = await um(`select * from fechar_caixa(130, 'faltou troco')`)
    assert.deepEqual([Number(f.valor_esperado), Number(f.diferenca)], [134, -4])
    await falha(db.query(`select fechar_caixa(0)`), 'Não há caixa aberto')
  })
})

await teste('relatório de faturamento soma só pedidos válidos e divide meio a meio', async () => {
  let r
  await como('authenticated', admin, async () => {
    r = (await um(`select relatorio_faturamento((now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date) as r`)).r
  })
  const validos = await um(`select count(*)::int as n, sum(total) as total from pedidos where status <> 'cancelado'`)
  assert.equal(r.resumo.pedidos, validos.n)
  assert.equal(Number(r.resumo.faturamento), Number(validos.total))
  assert.equal(r.resumo.cancelados, 2)
  assert.equal(r.por_dia.length, 1)
  assert.ok(r.top_produtos.some((p) => p.nome === 'Quatro Queijos' && Number(p.quantidade) % 1 === 0.5))
  assert.ok(Number(r.resumo.cmv) > 0)
  assert.ok(r.por_pagamento.length > 0 && r.por_hora.length > 0 && r.por_bairro.length > 0)
})

await teste('visão de clientes traz totais de compras', async () => {
  let c
  await como('authenticated', admin, async () => {
    c = await um(`select total_pedidos, total_gasto from clientes_resumo where telefone = '11988887777'`)
  })
  assert.equal(Number(c.total_pedidos), 2)
})

await teste('horário de funcionamento, incluindo turno que vira a madrugada', async () => {
  await db.exec(`update configuracoes set loja_aberta_manual = null, horarios = (
    select jsonb_object_agg(d::text, '{"aberto": true, "abre": "00:00", "fecha": "23:59:59"}'::jsonb) from generate_series(0, 6) d)`)
  assert.equal((await um(`select loja_aberta() as r`)).r, true)
  await db.exec(`update configuracoes set horarios = (
    select jsonb_object_agg(d::text, '{"aberto": false, "abre": "18:00", "fecha": "23:00"}'::jsonb) from generate_series(0, 6) d)`)
  assert.equal((await um(`select loja_aberta() as r`)).r, false)
  // abre daqui a 1h e "fecha" 2h antes de agora => só o turno de ontem cobre o horário atual
  await db.exec(`update configuracoes set horarios = (
    select jsonb_object_agg(d::text, jsonb_build_object('aberto', true,
      'abre', to_char((now() at time zone fuso_horario) + interval '1 hour', 'HH24:MI'),
      'fecha', to_char((now() at time zone fuso_horario) + interval '30 minutes', 'HH24:MI')))
    from generate_series(0, 6) d)`)
  assert.equal((await um(`select loja_aberta() as r`)).r, true)
})

console.log(`\n${ok} testes passaram${process.exitCode ? ' (com falhas acima)' : ''}`)
