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

// ---------------------------------------------------------------- usuários
const usuario = async (email, app = {}, meta = {}) =>
  (await um(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, $2::jsonb, $3::jsonb) returning id`, [
    email, JSON.stringify(app), JSON.stringify(meta),
  ])).id
// cliente do Google que tenta chegar antes da dona: não pode virar administrador
const cliente = await usuario('cliente@gmail.com', { provider: 'google' }, { full_name: 'Carla Cliente', papel: 'admin', ativo: true })
const admin = await usuario('dona@tiacepizzas.com.br', { provider: 'email' })
const atendente = await usuario('atendente@x.com', { papel: 'atendente', ativo: true }, { nome: 'Ana Atendente' })
const cozinha = await usuario('cozinha@x.com', { papel: 'cozinha', ativo: true })
const financeiro = await usuario('fin@x.com', { papel: 'financeiro', ativo: true })
const motoboy = await usuario('moto@x.com', { papel: 'motoboy', ativo: true }, { nome: 'Carlos Moto' })
const outroMotoboy = await usuario('moto2@x.com', { papel: 'motoboy', ativo: true }, { nome: 'Outro Moto' })
// depois que a dona existe, quem se cadastra por e-mail é cliente: sem perfil (o papel em user_metadata não vale nada)
const clienteEmail = await usuario('cida@x.com', { provider: 'email' }, { nome: 'Cida Cliente', papel: 'admin', ativo: true })
// o Supabase cria os usuários do painel em dois passos: INSERT sem o papel e, em seguida, UPDATE do app_metadata
const doisPassos = async (email, papel, nome) => {
  const id = await usuario(email, { provider: 'email', providers: ['email'] }, { nome })
  await db.query(`update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1`, [id, JSON.stringify({ papel, ativo: true })])
  return id
}
const cozinha2 = await doisPassos('cozinha2@x.com', 'cozinha', 'Zé Cozinha')
// entregador cadastrado à mão antes de ter login: o usuário criado depois é ligado a ele, sem duplicar
await db.exec(`insert into entregadores (nome, diaria) values ('Terceiro Moto', 70)`)
const motoboy3 = await doisPassos('moto3@x.com', 'motoboy', '  terceiro moto ')

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
const status = (pedido, valores) => db.query(`update pedidos set ${Object.keys(valores).map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [pedido, ...Object.values(valores)])

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
const balcao = (extra) => ({ painel: true, tipo: 'balcao', origem: 'balcao', cliente: { nome: 'Cliente balcão' }, forma_pagamento: 'dinheiro', itens: [{ produto_id: coca }], ...extra })

await db.exec(`update configuracoes set loja_aberta_manual = true`)

console.log('\nAcesso')
await teste('só o primeiro usuário de e-mail vira administrador; cliente (Google ou e-mail) não ganha perfil; usuário do painel ganha', async () => {
  const perfis = await q(`select email, papel, ativo from perfis order by email`)
  assert.deepEqual(perfis.map((p) => `${p.email}:${p.papel}:${p.ativo}`), [
    'atendente@x.com:atendente:true', 'cozinha2@x.com:cozinha:true', 'cozinha@x.com:cozinha:true', 'dona@tiacepizzas.com.br:admin:true',
    'fin@x.com:financeiro:true', 'moto2@x.com:motoboy:true', 'moto3@x.com:motoboy:true', 'moto@x.com:motoboy:true',
  ])
  assert.equal((await q(`select 1 from entregadores where usuario_id = $1`, [motoboy])).length, 1, 'motoboy ganha cadastro de entregador')
  const terceiro = await q(`select usuario_id, diaria from entregadores where lower(nome) like '%terceiro moto%'`)
  assert.deepEqual([terceiro.length, terceiro[0].usuario_id, Number(terceiro[0].diaria)], [1, motoboy3, 70], 'motoboy criado em dois passos é ligado ao entregador que já existia')
  // ...e o painel pode indicar a qual entregador ligar, mesmo com outro nome
  await db.exec(`begin`)
  const avulso = (await um(`insert into entregadores (nome) values ('Apelido') returning id`)).id
  const id4 = await usuario('moto4@x.com', { provider: 'email' }, { nome: 'Nome Completo' })
  await db.query(`update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1`, [id4, JSON.stringify({ papel: 'motoboy', ativo: true, entregador_id: avulso })])
  assert.deepEqual((await q(`select nome from entregadores where usuario_id = $1`, [id4])).map((e) => e.nome), ['Apelido'])
  await db.exec(`rollback`)
  assert.equal((await um(`select nome from perfis where id = $1`, [cozinha2])).nome, 'Zé Cozinha')
  assert.equal((await um(`select admin_criado from configuracoes`)).admin_criado, true)
  // a conta por e-mail é só de cliente: tem cadastro próprio e não enxerga nada da equipe
  await como('authenticated', clienteEmail, async () => {
    assert.equal((await um(`select minha_conta() as r`)).r.nome, 'Cida Cliente')
    assert.equal((await um(`select eh_staff() as r`)).r, false)
    assert.equal((await q(`select 1 from pedidos`)).length, 0)
    await falha(db.query(`select registrar_pagamento('outro', 10, null, 'Eu mesma')`), 'Acesso negado')
  })
  // apagados todos os perfis, um cadastro novo continua sendo cliente (o primeiro administrador só nasce uma vez)
  await db.exec(`begin; delete from perfis`)
  const tardio = await usuario('tardio@x.com', { provider: 'email' })
  assert.equal((await q(`select 1 from perfis where id = $1`, [tardio])).length, 0)
  await db.exec(`rollback`)
})

await teste('visitante lê cardápio, promoções e banners, mas nada da operação', async () => {
  await como('anon', null, async () => {
    for (const t of ['produtos', 'promocoes', 'banners', 'site_conteudo', 'faixas_entrega']) assert.ok((await q(`select * from ${t}`)).length > 0, t)
    for (const t of ['pedidos', 'clientes', 'caixas', 'insumos', 'perfis', 'notas_fiscais', 'config_fiscal', 'auditoria', 'cupons', 'permissoes']) {
      await falha(q(`select * from ${t}`), 'permission denied')
    }
    await falha(q(`insert into produtos (categoria_id, nome) select id, 'x' from categorias limit 1`), 'permission denied')
    await falha(q(`select relatorio_faturamento(current_date, current_date)`), 'permission denied')
    await falha(q(`select baixar_estoque_pedido(gen_random_uuid(), false)`), 'permission denied')
    await falha(q(`select minhas_entregas()`), 'permission denied')
    // da loja o visitante lê o que o site mostra, não o que é interno
    assert.ok((await q(`select nome_loja, horarios, pedido_minimo, chave_pix from configuracoes`)).length === 1)
    for (const c of ['metas', 'categorias_despesa', 'alertas_pedido', 'impressao', 'auto_aceitar', '*']) await falha(q(`select ${c} from configuracoes`), 'permission denied')
    await falha(q(`select config_interna()`), 'permission denied')
  })
  // cliente com conta não é equipe: a função responde vazio; a equipe recebe as configurações internas
  assert.equal(await como('authenticated', cliente, async () => (await q(`select config_interna() as c`))[0].c), null)
  await como('authenticated', cliente, () => falha(q(`select metas from configuracoes`), 'permission denied'))
  const interna = await como('authenticated', cozinha, async () => (await q(`select config_interna() as c`))[0].c)
  assert.deepEqual(Object.keys(interna).sort(), ['alertas_pedido', 'auto_aceitar', 'categorias_despesa', 'impressao', 'metas'])
  // e a administradora continua conseguindo gravar
  const atual = await um(`select metas, auto_aceitar from configuracoes`)
  await como('authenticated', admin, () => db.query(`update configuracoes set metas = $1::jsonb, auto_aceitar = $2 where id = 1`, [JSON.stringify(atual.metas), atual.auto_aceitar]))
})

await teste('cada papel só alcança os módulos liberados para ele', async () => {
  const conta = async (uid, tabela) => como('authenticated', uid, async () => (await q(`select * from ${tabela}`)).length)
  await db.exec(`insert into despesas (descricao, valor) values ('Gás', 100)`)
  // a tela Cozinha saiu do painel: o módulo "cozinha" não existe mais e quem o tinha ficou com Pedidos
  assert.deepEqual((await db.query(`select papel::text || ':' || modulo as p from permissoes where papel = 'cozinha' or modulo = 'cozinha' order by 1`)).rows.map((r) => r.p), ['cozinha:pedidos'])
  assert.ok((await db.query(`select 1 from permissoes where papel = 'atendente' and modulo = 'pedidos'`)).rows.length === 1)
  // cozinha: usa a tela de Pedidos; não vê despesas nem estoque
  assert.equal(await conta(cozinha, 'despesas'), 0)
  assert.ok((await conta(cozinha, 'insumos')) === 0)
  // atendente: clientes sim; despesas e estoque não
  assert.equal(await conta(atendente, 'despesas'), 0)
  assert.equal(await conta(atendente, 'insumos'), 0)
  // financeiro: despesas sim; não altera o cardápio
  assert.equal(await conta(financeiro, 'despesas'), 1)
  await como('authenticated', financeiro, async () => {
    await db.query(`update produtos set preco = 1 where nome = 'Coca-Cola 2L'`)
    await falha(db.query(`insert into produtos (categoria_id, nome) select id, 'x' from categorias limit 1`), 'row-level security')
  })
  assert.equal(Number((await um(`select preco from produtos where nome = 'Coca-Cola 2L'`)).preco), 14)
  // motoboy e cliente logado: nenhuma tabela da operação
  for (const uid of [motoboy, cliente]) {
    for (const t of ['pedidos', 'clientes', 'despesas', 'insumos', 'caixas', 'auditoria']) assert.equal(await conta(uid, t), 0, t)
    await como('authenticated', uid, () => falha(q(`select abrir_caixa(100)`), 'Acesso negado'))
    await como('authenticated', uid, () => falha(q(`select relatorio_faturamento(current_date, current_date)`), 'Acesso negado'))
  }
  // o administrador libera o estoque para a atendente
  await como('authenticated', admin, () => db.query(`insert into permissoes (papel, modulo) values ('atendente', 'estoque')`))
  assert.ok((await conta(atendente, 'insumos')) > 0)
  await como('authenticated', atendente, () => falha(db.query(`insert into permissoes (papel, modulo) values ('atendente', 'financeiro')`), 'row-level security'))
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
  assert.ok(pedido.numero >= 1001)
  const p = await um(`select * from pedidos where id = $1`, [pedido.id])
  assert.equal(Number(p.troco_para), 200)
  assert.equal(p.cliente_telefone, '11988887777')
  const itens = await q(`select nome from pedido_itens where pedido_id = $1 order by ordem`, [pedido.id])
  assert.equal(itens[0].nome, '1/2 Mussarela + 1/2 Quatro Queijos (Grande)')
})

await teste('borda com preço por tamanho: vale o do tamanho da pizza; sem preço próprio, o padrão', async () => {
  const media = await id('tamanhos', 'Média')
  // padrão 10; na grande custa 14. O navegador não manda preço: quem decide é o servidor
  await db.query(`update adicionais set precos_tamanho = $2::jsonb where id = $1`, [bordaCatupiry, JSON.stringify({ [grande]: 14 })])
  // telefone próprio: o limite de pedidos pendentes por telefone não pode pesar nos outros testes
  const base = { ...pedidoSite, chave: undefined, tipo: 'retirada', endereco: null, cliente: { nome: 'Teste Borda', telefone: '11955550001' } }
  const pizza = (tamanho) => criar({ ...base, itens: [{ produto_id: mussarela, tamanho_id: tamanho, adicionais: [bordaCatupiry], quantidade: 2 }] })
  let g, m
  await como('anon', null, async () => {
    g = await pizza(grande)
    m = await pizza(media)
  })
  // Mussarela G 58 + borda 14 = 72 (x2); Mussarela M 48 + borda 10 = 58 (x2)
  assert.deepEqual([Number(g.total), Number(m.total)], [144, 116])
  const item = await um(`select adicionais from pedido_itens where pedido_id = $1`, [g.id])
  assert.equal(Number(item.adicionais[0].preco), 14)
  // tamanho sem borda recheada (o brotinho da pizzaria): o servidor recusa a borda nele
  await db.query(`update tamanhos set aceita_borda = false where id = $1`, [broto])
  await como('anon', null, async () => {
    await falha(pizza(broto), 'não tem borda recheada')
    const semBorda = await criar({ ...base, itens: [{ produto_id: mussarela, tamanho_id: broto, quantidade: 1 }] })
    assert.equal(Number(semBorda.total), 32)
  })
  await db.query(`update tamanhos set aceita_borda = true where id = $1`, [broto])
  await falha(db.query(`update adicionais set precos_tamanho = '[]'::jsonb where id = $1`, [bordaCatupiry]), 'check')
  await db.query(`update adicionais set precos_tamanho = '{}'::jsonb where id = $1`, [bordaCatupiry])
  await db.query(`update pedidos set status = 'cancelado', motivo_cancelamento = 'teste' where cliente_telefone = '11955550001'`)
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

await teste('visitante não consegue se passar por atendente (painel/status/pago/desconto ignorados)', async () => {
  let r
  await como('anon', null, async () => {
    r = await criar({ ...pedidoSite, painel: true, status: 'entregue', pago: true, desconto: 100, taxa_entrega: 0, origem: 'balcao' })
  })
  const p = await um(`select status, pago, desconto, taxa_entrega, origem from pedidos where id = $1`, [r.id])
  assert.deepEqual({ ...p, desconto: Number(p.desconto), taxa_entrega: Number(p.taxa_entrega) }, {
    status: 'novo', pago: false, desconto: 0, taxa_entrega: 5, origem: 'site',
  })
})

await teste('reenviar o mesmo pedido (mesma chave) não duplica', async () => {
  const chave = '11111111-2222-3333-4444-555555555555'
  const cli = { nome: 'Duda', telefone: '11911112222' }
  let a, b
  await como('anon', null, async () => {
    a = await criar({ ...pedidoSite, cliente: cli, chave })
    b = await criar({ ...pedidoSite, cliente: cli, chave })
  })
  assert.equal(a.id, b.id)
  assert.equal(b.repetido, true)
  assert.equal((await q(`select 1 from pedidos where cliente_telefone = '11911112222'`)).length, 1)
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

await teste('promoção: preço cai no servidor, respeita dias e horário, e vale para meio a meio', async () => {
  const cli = { nome: 'Pedro', telefone: '11933334444' }
  const so = (itens) => como('anon', null, () => criar({ tipo: 'retirada', cliente: cli, forma_pagamento: 'pix', itens }))
  // Semana da Calabresa (exemplo): 15% → Grande 58,00 vira 49,30
  assert.equal(Number((await so([{ produto_id: calabresa, tamanho_id: grande }])).total), 49.3)
  const vigentes = (await um(`select promocoes_vigentes() as r`)).r
  assert.deepEqual([vigentes.length, vigentes[0].produtos.length, vigentes[0].selo], [1, 1, '15% OFF'])
  // meio a meio com Mussarela (58): vale o maior entre 49,30 e 58
  assert.equal(Number((await so([{ produto_id: calabresa, tamanho_id: grande, sabores: [calabresa, mussarela] }])).total), 58)
  // fora do dia da semana ou da janela de horário a promoção não vale
  await db.exec(`update promocoes set dias_semana = array[(extract(dow from now() at time zone 'America/Sao_Paulo')::int + 1) % 7]`)
  assert.equal((await um(`select promocoes_vigentes() as r`)).r.length, 0)
  await db.exec(`update pedidos set status = 'cancelado' where cliente_telefone = '11933334444'`)
  assert.equal(Number((await so([{ produto_id: calabresa, tamanho_id: grande }])).total), 58)
  await db.exec(`update promocoes set dias_semana = null, hora_inicio = (now() at time zone 'America/Sao_Paulo')::time + interval '1 hour',
                 hora_fim = (now() at time zone 'America/Sao_Paulo')::time + interval '2 hours'`)
  assert.equal((await um(`select promocoes_vigentes() as r`)).r.length, 0)
  // preço fixo só para um tamanho
  await db.exec(`update promocoes set hora_inicio = null, hora_fim = null, tipo = 'preco', valor = 25, tamanho_id = '${broto}'`)
  await db.exec(`update pedidos set status = 'cancelado' where cliente_telefone = '11933334444'`)
  assert.equal(Number((await so([{ produto_id: calabresa, tamanho_id: broto }])).total), 25)
  assert.equal(Number((await so([{ produto_id: calabresa, tamanho_id: grande }])).total), 58)
  await db.exec(`update promocoes set ativo = false; update pedidos set status = 'cancelado' where cliente_telefone = '11933334444'`)
})

await teste('entrega por distância: faixa certa, fora da área e ponto obrigatório', async () => {
  await db.exec(`update configuracoes set modo_entrega = 'distancia', loja_lat = -23.550000, loja_lng = -46.630000`)
  const em = async (lat, lng) => (await um(`select calcular_entrega($1::numeric, $2::numeric) as r`, [lat, lng])).r
  // sem o trajeto pelas ruas (serviço de rotas fora do ar): linha reta + 30%
  const perto1 = await em(-23.56, -46.63) // ~1,1 km em linha reta
  assert.deepEqual([perto1.por_rota, Number(perto1.linha_reta_km), Number(perto1.distancia_km)], [false, 1.11, 1.44])
  assert.deepEqual([perto1.dentro, Number(perto1.taxa)], [true, 5])
  const medio = await em(-23.58, -46.63) // ~3,3 km em linha reta, ~4,3 km estimados
  assert.deepEqual([medio.dentro, Number(medio.taxa)], [true, 8])
  const longe = await em(-23.70, -46.63) // ~16,7 km em linha reta
  assert.deepEqual([longe.dentro, longe.mensagem], [false, 'Este endereço está fora da nossa área de entrega.'])
  // com o trajeto enviado pelo site: vale o trajeto, nunca menos que a linha reta, e um valor absurdo é ignorado
  const rota = async (km) => (await um(`select calcular_entrega(-23.56, -46.63, $1::numeric) as r`, [km])).r
  assert.deepEqual(await rota(2.4).then((x) => [x.por_rota, Number(x.distancia_km), Number(x.taxa)]), [true, 2.4, 5])
  assert.deepEqual(await rota(4.5).then((x) => [x.por_rota, Number(x.distancia_km), Number(x.taxa)]), [true, 4.5, 8], 'o rio no caminho muda a faixa')
  assert.deepEqual(await rota(0.2).then((x) => [x.por_rota, Number(x.distancia_km)]), [true, 1.11], 'não dá para encurtar o caminho')
  assert.deepEqual(await rota(0).then((x) => [x.por_rota, Number(x.distancia_km)]), [true, 1.11])
  assert.deepEqual(await rota(-5).then((x) => [x.por_rota, Number(x.distancia_km)]), [false, 1.44])
  assert.deepEqual(await rota(80).then((x) => [x.por_rota, Number(x.distancia_km)]), [false, 1.44])
  // visitante chama a função, com e sem o trajeto
  await como('anon', null, async () => { assert.equal((await q(`select calcular_entrega(-23.56, -46.63) as r`))[0].r.dentro, true); assert.equal((await q(`select calcular_entrega(-23.56, -46.63, 2.4) as r`))[0].r.por_rota, true) })

  const cli = { nome: 'Rita', telefone: '11922223333' }
  const ped = (endereco) => como('anon', null, () => criar({ ...pedidoSite, cliente: cli, endereco: { logradouro: 'Rua B', numero: '5', ...endereco } }))
  const r = await ped({ lat: -23.58, lng: -46.63 })
  assert.equal(Number(r.total), 100 + 8)
  assert.equal(Number((await um(`select distancia_km from pedidos where id = $1`, [r.id])).distancia_km) > 4, true)
  // o pedido usa o trajeto que veio com o endereço: perto em linha reta, mais longe pelas ruas
  const pelaRua = await ped({ lat: -23.56, lng: -46.63, rota_km: 4.5 })
  assert.deepEqual([Number(pelaRua.total), Number((await um(`select distancia_km from pedidos where id = $1`, [pelaRua.id])).distancia_km)], [100 + 8, 4.5])
  await falha(ped({ lat: -23.70, lng: -46.63 }), 'fora da nossa área de entrega')
  await falha(ped({}), 'localizar o endereço')
  // aumentar o raio pelo painel passa a atender o endereço
  await db.exec(`insert into faixas_entrega (ate_km, taxa) values (25, 22)`)
  assert.equal(Number((await ped({ lat: -23.70, lng: -46.63 })).total), 100 + 22)
  await db.exec(`update configuracoes set modo_entrega = 'bairro'; delete from faixas_entrega where ate_km = 25`)
})

console.log('\nConta do cliente')
await teste('cliente logado: cadastro próprio, endereços próprios e pedidos próprios', async () => {
  let conta, r
  await como('authenticated', cliente, async () => {
    conta = (await um(`select minha_conta() as r`)).r
    assert.equal(conta.nome, 'Carla Cliente')
    await db.query(`update clientes set telefone = '11955550000' where id = $1`, [conta.id])
    await db.query(`insert into enderecos (cliente_id, logradouro, numero, bairro_id) values ($1, 'Av. Um', '1', $2)`, [conta.id, centro])
    assert.equal((await q(`select * from clientes`)).length, 1, 'só enxerga o próprio cadastro')
    assert.equal((await q(`select * from enderecos`)).length, 1)
    r = await criar({ ...pedidoSite, cliente: { nome: 'Carla Cliente', telefone: '11955550000' } })
    const meus = (await um(`select meus_pedidos() as r`)).r
    assert.deepEqual([meus.length, meus[0].numero], [1, r.numero])
  })
  assert.equal((await um(`select cliente_id from pedidos where id = $1`, [r.id])).cliente_id, conta.id)
  // não consegue gravar endereço no cadastro de outra pessoa nem tomar o cadastro de alguém
  const maria = (await um(`select id from clientes where telefone = '11988887777'`)).id
  await como('authenticated', cliente, async () => {
    await falha(db.query(`insert into enderecos (cliente_id, logradouro) values ($1, 'Invasão')`, [maria]), 'row-level security')
    await db.query(`update clientes set usuario_id = $1 where id = $2`, [cliente, maria])
  })
  assert.equal((await um(`select usuario_id from clientes where id = $1`, [maria])).usuario_id, null)
  // conta com o mesmo telefone de um convidado não herda o histórico dele
  await como('authenticated', cliente, () => db.query(`update clientes set telefone = '11988887777' where usuario_id = $1`, [cliente]))
  await como('authenticated', cliente, async () => assert.equal((await um(`select meus_pedidos() as r`)).r.length, 1))
})

console.log('\nOperação (estoque, caixa, entregas, relatórios)')
await teste('confirmar pedido baixa estoque pela ficha técnica; cancelar estorna', async () => {
  const antes = { mussarela: await estoque('Mussarela'), catupiry: await estoque('Catupiry'), caixa: await estoque('Caixa de pizza') }
  await como('authenticated', cozinha, () => status(pedido.id, { status: 'confirmado' }))
  // meia Mussarela (0,28/2) + meia Quatro Queijos (0,28/2) = 0,28 kg de mussarela
  perto(await estoque('Mussarela'), antes.mussarela - 0.28)
  // meia Quatro Queijos (0,098/2) + borda de catupiry (0,10)
  perto(await estoque('Catupiry'), antes.catupiry - 0.049 - 0.1)
  assert.equal(await estoque('Caixa de pizza'), antes.caixa - 1)
  const p = await um(`select estoque_baixado, confirmado_em, previsao_em from pedidos where id = $1`, [pedido.id])
  assert.ok(p.estoque_baixado && p.confirmado_em && p.previsao_em)

  await como('authenticated', cozinha, () => status(pedido.id, { status: 'em_preparo' }))
  perto(await estoque('Mussarela'), antes.mussarela - 0.28, 'não baixa duas vezes')

  await como('authenticated', atendente, () => status(pedido.id, { status: 'cancelado', motivo_cancelamento: 'teste' }))
  perto(await estoque('Mussarela'), antes.mussarela)
  perto(await estoque('Catupiry'), antes.catupiry)
  await como('authenticated', admin, () => falha(status(pedido.id, { status: 'confirmado' }), 'não pode ser reaberto'))
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

let vendaBalcao
await teste('desperdício: cozinha registra com motivo, baixa o estoque, entra nas perdas e na auditoria', async () => {
  const insumo = await um(`select id, quantidade, custo_unitario from insumos where nome = 'Mussarela'`)
  const antes = Number(insumo.quantidade)
  const hoje = (await um(`select (now() at time zone fuso())::date::text as d`)).d
  const perdasAntes = Number((await como('authenticated', admin, () => um(`select relatorio_faturamento($1, $1) as r`, [hoje]))).r.resumo.perdas)
  // a cozinha não entra no Estoque, mas enxerga a lista de insumos para registrar e registra
  await como('authenticated', cozinha, () => falha(q(`select * from insumos`), 'permission denied|row-level'))
    .catch(async () => assert.equal((await como('authenticated', cozinha, () => q(`select * from insumos`))).length, 0))
  const lista = (await como('authenticated', cozinha, () => um(`select insumos_para_desperdicio() as r`))).r
  assert.ok(lista.some((i) => i.nome === 'Mussarela' && i.unidade) && !('custo_unitario' in lista[0]), 'lista sem custos')
  const r = (await como('authenticated', cozinha, () => um(`select registrar_desperdicio($1, 0.3, 'Caiu no chão ao montar a pizza') as r`, [insumo.id]))).r
  perto(Number(r.restante), antes - 0.3)
  perto(await estoque('Mussarela'), antes - 0.3)
  perto(Number(r.valor), Math.round(0.3 * Number(insumo.custo_unitario) * 100) / 100)
  // quem cuida dos pedidos também registra (o botão fica na tela de Pedidos)
  assert.ok((await como('authenticated', atendente, () => um(`select insumos_para_desperdicio() as r`))).r.length > 0)
  // sem motivo, quantidade zero e quem não é da equipe: recusado
  await como('authenticated', cozinha, () => falha(q(`select registrar_desperdicio($1, 0.2, '  ')`, [insumo.id]), 'Escreva o que aconteceu'))
  await como('authenticated', cozinha, () => falha(q(`select registrar_desperdicio($1, 0, 'x')`, [insumo.id]), 'Informe a quantidade'))
  await como('authenticated', cliente, () => falha(q(`select registrar_desperdicio($1, 0.2, 'x')`, [insumo.id]), 'Acesso negado')) // cliente com conta não é equipe
  await como('authenticated', motoboy, () => falha(q(`select registrar_desperdicio($1, 0.2, 'x')`, [insumo.id]), 'Acesso negado'))
  await falha(db.query(`insert into estoque_movimentos (insumo_id, tipo, quantidade) values ($1, 'desperdicio', 1)`, [insumo.id]), 'desperdicio_com_motivo')
  // aparece na lista do período (com quem registrou), nas perdas do resultado e na auditoria
  const d = (await como('authenticated', admin, () => um(`select listar_desperdicios($1, $1) as r`, [hoje]))).r
  assert.equal(d.registros.length, 1)
  assert.deepEqual([d.registros[0].insumo, Number(d.registros[0].quantidade), d.registros[0].observacao, d.registros[0].usuario], ['Mussarela', 0.3, 'Caiu no chão ao montar a pizza', 'cozinha'])
  perto(Number(d.total), Number(r.valor)); perto(Number(d.por_insumo[0].valor), Number(r.valor))
  await como('authenticated', cozinha, () => falha(q(`select listar_desperdicios($1, $1)`, [hoje]), 'Acesso negado'))
  const perdasDepois = Number((await como('authenticated', admin, () => um(`select relatorio_faturamento($1, $1) as r`, [hoje]))).r.resumo.perdas)
  perto(perdasDepois - perdasAntes, Number(r.valor))
  const aud = await um(`select descricao, usuario_nome from auditoria where tabela = 'estoque' order by id desc limit 1`)
  assert.deepEqual([aud.descricao, aud.usuario_nome], ['Mussarela — desperdicio', 'cozinha'])
})

await teste('caixa: abertura, venda do balcão paga, sangria, estorno e fechamento', async () => {
  await como('authenticated', atendente, () => falha(db.query(`select abrir_caixa(100)`), 'Acesso negado'))
  await como('authenticated', admin, async () => {
    await db.query(`select abrir_caixa(100)`)
    await falha(db.query(`select abrir_caixa(50)`), 'Já existe um caixa aberto')
    vendaBalcao = await criar(balcao({ pago: true, desconto: 8, itens: [{ produto_id: calabresa, tamanho_id: grande }, { produto_id: coca }] }))
    assert.equal(vendaBalcao.status, 'confirmado')
    assert.equal(Number(vendaBalcao.total), 58 + 14 - 8)
    const pix = await criar({
      painel: true, tipo: 'retirada', origem: 'telefone', cliente: { nome: 'João', telefone: '11955554444' }, forma_pagamento: 'pix',
      itens: [{ produto_id: mussarela, tamanho_id: broto }],
    })
    await status(pix.id, { status: 'entregue', pago: true })
    await db.query(`insert into caixa_movimentos (caixa_id, tipo, valor, descricao) select id, 'sangria', -30, 'Troco motoboy' from caixas where fechado_em is null`)
    const caixa = (await um(`select id from caixas where fechado_em is null`)).id
    let r = (await um(`select resumo_caixa($1) as r`, [caixa])).r
    assert.deepEqual(
      [Number(r.vendas), r.qtd_vendas, Number(r.sangrias), Number(r.esperado_dinheiro), Number(r.por_forma.pix)],
      [64 + 32, 2, 30, 100 + 64 - 30, 32],
    )
    // reembolsar um pedido entregue e pago estorna no caixa, mas não devolve estoque
    const farinha = await estoque('Farinha de trigo')
    await status(pix.id, { status: 'reembolsado', motivo_reembolso: 'Pizza errada' })
    r = (await um(`select resumo_caixa($1) as r`, [caixa])).r
    assert.equal(Number(r.vendas), 64)
    assert.equal(await estoque('Farinha de trigo'), farinha)
    await falha(status(vendaBalcao.id, { status: 'reembolsado' }), 'Só é possível reembolsar')
    const f = await um(`select * from fechar_caixa(130, 'faltou troco')`)
    assert.deepEqual([Number(f.valor_esperado), Number(f.diferenca)], [134, -4])
    await falha(db.query(`select fechar_caixa(0)`), 'Não há caixa aberto')
  })
})

await teste('motoboy: vê e move só as entregas dele, registra problema e posição', async () => {
  const entregador = (await um(`select id from entregadores where usuario_id = $1`, [motoboy])).id
  let entrega
  await como('authenticated', admin, async () => {
    entrega = await criar({ ...pedidoSite, painel: true, origem: 'telefone', cliente: { nome: 'Lia', telefone: '11944445555' } })
    await status(entrega.id, { status: 'pronto', entregador_id: entregador })
  })
  await como('authenticated', outroMotoboy, async () => {
    assert.equal((await um(`select minhas_entregas() as r`)).r.entregas.length, 0)
    await falha(db.query(`select entrega_acao($1, 'sair')`, [entrega.id]), 'não está atribuída a você')
  })
  await como('authenticated', atendente, () => falha(db.query(`select minhas_entregas()`), 'restrito aos entregadores'))
  await como('authenticated', motoboy, async () => {
    const m = (await um(`select minhas_entregas() as r`)).r
    assert.deepEqual([m.entregas.length, m.entregas[0].numero, m.entregas[0].endereco.logradouro], [1, entrega.numero, 'Rua das Flores'])
    await falha(db.query(`select entrega_acao($1, 'entregar')`, [entrega.id]), 'não permitida')
    await db.query(`select entrega_acao($1, 'sair')`, [entrega.id])
    await db.query(`select entrega_posicao(-23.551, -46.631)`)
    await falha(db.query(`select entrega_acao($1, 'problema', '')`, [entrega.id]), 'Descreva o problema')
    await db.query(`select entrega_acao($1, 'problema', 'Cliente não atende')`, [entrega.id])
  })
  let a = (await um(`select acompanhar_pedido($1) as r`, [entrega.codigo])).r
  assert.deepEqual([a.status, a.problema_entrega, a.motoboy], ['problema_entrega', 'Cliente não atende', null])
  await como('authenticated', motoboy, () => db.query(`select entrega_acao($1, 'sair')`, [entrega.id]))
  a = (await um(`select acompanhar_pedido($1) as r`, [entrega.codigo])).r
  assert.deepEqual([a.status, Number(a.motoboy.lat), a.entregador], ['saiu_entrega', -23.551, 'Carlos'])
  await como('authenticated', motoboy, async () => {
    await db.query(`select entrega_acao($1, 'entregar')`, [entrega.id])
    assert.equal((await um(`select minhas_entregas() as r`)).r.entregues_hoje, 1)
  })
  const p = await um(`select status, pago from pedidos where id = $1`, [entrega.id])
  assert.deepEqual([p.status, p.pago], ['entregue', true])
  // rastreio desligado nas configurações não expõe a posição
  await db.exec(`update configuracoes set rastreio_motoboy = false`)
})

await teste('aviso de pedido pronto: só o motoboy registra e remove o aparelho dele; ninguém lê a lista pelo site', async () => {
  const aparelho = 'aparelho-de-teste-'.padEnd(60, 'x')
  const dono = async () => (await um(`select e.usuario_id from entregador_aparelhos a join entregadores e on e.id = a.entregador_id where a.token = $1`, [aparelho]))?.usuario_id
  await como('authenticated', atendente, () => falha(db.query(`select entrega_aparelho($1)`, [aparelho]), 'restrito aos entregadores'))
  await como('anon', null, () => falha(db.query(`select entrega_aparelho($1)`, [aparelho]), 'permission denied'))
  await como('authenticated', motoboy, async () => {
    await falha(db.query(`select entrega_aparelho('curto')`), 'Aparelho inválido')
    await db.query(`select entrega_aparelho($1)`, [aparelho])
    await db.query(`select entrega_aparelho($1)`, [aparelho]) // entrar de novo no aplicativo não duplica
    await falha(db.query(`select * from entregador_aparelhos`), 'permission denied')
  })
  assert.deepEqual([await dono(), (await q(`select 1 from entregador_aparelhos`)).length], [motoboy, 1])
  // outro motoboy entra no mesmo celular: o aparelho passa a avisar só ele, e o primeiro não consegue removê-lo
  await como('authenticated', outroMotoboy, () => db.query(`select entrega_aparelho($1)`, [aparelho]))
  await como('authenticated', motoboy, () => db.query(`select entrega_aparelho($1, false)`, [aparelho]))
  assert.equal(await dono(), outroMotoboy)
  await como('authenticated', outroMotoboy, () => db.query(`select entrega_aparelho($1, false)`, [aparelho]))
  assert.equal((await q(`select 1 from entregador_aparelhos`)).length, 0)
  for (const papel of [admin, atendente]) await como('authenticated', papel, () => falha(db.query(`select * from entregador_aparelhos`), 'permission denied'))
})

await teste('auditoria: registra quem mudou preço, status e permissões, com antes e depois', async () => {
  await como('authenticated', admin, async () => {
    await db.query(`update produto_precos set preco = 60 where produto_id = $1 and tamanho_id = $2`, [mussarela, grande])
    await db.query(`update produto_precos set preco = 58 where produto_id = $1 and tamanho_id = $2`, [mussarela, grande])
    await db.query(`update bairros set taxa_entrega = 6 where nome = 'Centro'`)
    await db.query(`update bairros set taxa_entrega = 5 where nome = 'Centro'`)
    const preco = await um(`select * from auditoria where tabela = 'produto_precos' order by id limit 1`)
    assert.deepEqual([preco.descricao, preco.antes.preco, preco.depois.preco, preco.acao], ['Mussarela (Grande)', 58, 60, 'alterou'])
    assert.ok(preco.usuario_id === admin && preco.usuario_nome)
    const taxa = await um(`select * from auditoria where tabela = 'bairros' order by id limit 1`)
    assert.deepEqual([taxa.antes.taxa_entrega, taxa.depois.taxa_entrega], [5, 6])
    assert.ok((await q(`select 1 from auditoria where tabela = 'estoque'`)).length >= 2, 'movimentos manuais de estoque')
    assert.ok((await q(`select 1 from auditoria where tabela = 'permissoes'`)).length >= 1)
    const h = (await um(`select historico_pedido($1) as r`, [pedido.id])).r
    assert.deepEqual(h.map((x) => x.depois.status), ['confirmado', 'em_preparo', 'cancelado'])
    assert.equal(h[2].usuario, 'Ana Atendente')
  })
  await como('authenticated', atendente, async () => assert.equal((await q(`select * from auditoria`)).length, 0))
  // ninguém apaga nem reescreve a trilha pelo painel, nem o administrador
  const total = (await q(`select 1 from auditoria`)).length
  await como('authenticated', admin, async () => {
    await db.query(`delete from auditoria`)
    await db.query(`update auditoria set usuario_nome = 'outro'`)
    await falha(db.query(`insert into auditoria (tabela, acao) values ('x', 'criou')`), 'row-level security')
  })
  assert.equal((await q(`select 1 from auditoria where usuario_nome <> 'outro' or usuario_nome is null`)).length, total)
})

await teste('relatório de faturamento soma só pedidos válidos e agrupa por dia, semana ou mês', async () => {
  const hoje = `(now() at time zone 'America/Sao_Paulo')::date`
  let r, mes
  await como('authenticated', financeiro, async () => {
    r = (await um(`select relatorio_faturamento(${hoje}, ${hoje}) as r`)).r
    mes = (await um(`select relatorio_faturamento(${hoje} - 59, ${hoje}, 'mes') as r`)).r
  })
  const validos = await um(`select count(*)::int as n, sum(total) as total from pedidos where status not in ('cancelado', 'reembolsado')`)
  assert.equal(r.resumo.pedidos, validos.n)
  assert.equal(Number(r.resumo.faturamento), Number(validos.total))
  assert.equal(r.resumo.reembolsados, 1)
  assert.ok(r.resumo.cancelados >= 1)
  assert.equal(r.por_dia.length, 1)
  assert.ok(mes.por_dia.length >= 2 && mes.por_dia.length <= 3, 'série mensal')
  assert.equal(Number(mes.resumo.faturamento), Number(validos.total))
  // cada pizza meio a meio conta meia unidade para cada sabor
  const meias = await um(`select count(*)::int as n from pedido_itens i join pedidos p on p.id = i.pedido_id
    where p.status not in ('cancelado', 'reembolsado') and i.nome like '%Quatro Queijos%'`)
  assert.equal(Number(r.top_produtos.find((p) => p.nome === 'Quatro Queijos').quantidade), meias.n / 2)
  assert.ok(Number(r.resumo.cmv) > 0)
  assert.ok(r.por_pagamento.length > 0 && r.por_hora.length > 0 && r.por_bairro.length > 0 && r.top_clientes.length > 0)
  assert.deepEqual(r.despesas_por_categoria, [{ categoria: 'Outros', valor: 100 }])
  assert.equal(r.por_entregador[0].nome, 'Carlos Moto')
})

await teste('análises: ranking de produtos com participação e de clientes com detalhes', async () => {
  const hoje = `(now() at time zone 'America/Sao_Paulo')::date`
  await como('authenticated', financeiro, async () => {
    const produtos = (await um(`select analise_produtos(${hoje}, ${hoje}) as r`)).r
    assert.ok(Math.abs(produtos.reduce((s, p) => s + Number(p.participacao), 0) - 100) < 1)
    assert.ok(Number(produtos[0].faturamento) >= Number(produtos[1].faturamento))
    assert.ok(produtos.some((p) => Number(p.quantidade) === 0), 'lista também quem não vendeu')
    const clientes = (await um(`select analise_clientes(${hoje}, ${hoje}) as r`)).r
    assert.ok(clientes.length >= 3 && Number(clientes[0].total) >= Number(clientes[1].total))
    const maria = clientes.find((c) => c.telefone === '11988887777' && c.pedidos >= 2)
    const d = (await um(`select analise_cliente($1) as r`, [maria.id])).r
    assert.deepEqual([d.pedidos, d.datas.length, d.produtos.length > 0, Number(d.pizzas) >= 2], [maria.pedidos, maria.pedidos, true, true])
  })
  await como('authenticated', cozinha, () => falha(db.query(`select analise_produtos(current_date, current_date)`), 'Acesso negado'))
})

await teste('visão de clientes traz totais de compras', async () => {
  let c
  await como('authenticated', atendente, async () => {
    c = await um(`select total_pedidos, total_gasto from clientes_resumo where telefone = '11988887777' and usuario_id is null`)
  })
  assert.ok(Number(c.total_pedidos) >= 2)
})

await teste('horário de funcionamento, incluindo turno que vira a madrugada', async () => {
  await db.exec(`update configuracoes set loja_aberta_manual = null, horarios = (
    select jsonb_object_agg(d::text, '{"aberto": true, "abre": "00:00", "fecha": "23:59:59"}'::jsonb) from generate_series(0, 6) d)`)
  assert.equal((await um(`select loja_aberta() as r`)).r, true)
  await db.exec(`update configuracoes set horarios = (
    select jsonb_object_agg(d::text, '{"aberto": false, "abre": "18:00", "fecha": "23:00"}'::jsonb) from generate_series(0, 6) d)`)
  assert.equal((await um(`select loja_aberta() as r`)).r, false)
  // abre daqui a 1h e "fecha" antes de agora => só o turno de ontem cobre o horário atual
  await db.exec(`update configuracoes set horarios = (
    select jsonb_object_agg(d::text, jsonb_build_object('aberto', true,
      'abre', to_char((now() at time zone fuso_horario) + interval '1 hour', 'HH24:MI'),
      'fecha', to_char((now() at time zone fuso_horario) + interval '30 minutes', 'HH24:MI')))
    from generate_series(0, 6) d)`)
  assert.equal((await um(`select loja_aberta() as r`)).r, true)
})

console.log('\nPagamentos à equipe')
await teste('motoboy recebe diária + entregas; pagamento vira despesa, abate do acerto e pode sair do caixa', async () => {
  const hoje = `(now() at time zone 'America/Sao_Paulo')::date`
  const carlos = await um(`select id, diaria, repasse from entregadores where usuario_id = $1`, [motoboy])
  assert.deepEqual([Number(carlos.diaria), carlos.repasse], [50, 'taxa'], 'padrão: diária de R$ 50 + taxas das entregas')
  const feitas = await um(`select count(*)::int as n, sum(taxa_entrega) as taxas from pedidos where entregador_id = $1 and status = 'entregue'`, [carlos.id])
  assert.ok(feitas.n >= 1 && Number(feitas.taxas) > 0)
  const acerto = async () => (await um(`select acerto_entregadores(${hoje}, ${hoje}) as r`)).r.find((e) => e.id === carlos.id)
  const despesasAntes = Number((await um(`select coalesce(sum(valor), 0) as v from despesas`)).v)

  await como('authenticated', atendente, async () => {
    await falha(db.query(`select acerto_entregadores(current_date, current_date)`), 'Acesso negado')
    await falha(db.query(`select registrar_pagamento('motoboy', 10, $1)`, [carlos.id]), 'Acesso negado')
  })
  await como('authenticated', financeiro, async () => {
    let a = await acerto()
    assert.deepEqual(
      [a.entregas, a.dias, Number(a.diarias), Number(a.por_entregas), Number(a.a_receber), Number(a.pago)],
      [feitas.n, 1, 50, Number(feitas.taxas), 50 + Number(feitas.taxas), 0],
    )
    await falha(db.query(`select registrar_pagamento('motoboy', 10)`), 'Escolha o motoboy')
    await falha(db.query(`select registrar_pagamento('cozinha', 10)`), 'Informe o nome')
    await falha(db.query(`select registrar_pagamento('motoboy', 0, $1)`, [carlos.id]), 'Informe o valor')
    await falha(db.query(`select registrar_pagamento('cozinha', 80, null, 'Zé', null, 'dinheiro', true)`), 'Não há caixa aberto')
    await db.query(`select registrar_pagamento('motoboy', $2, $1)`, [carlos.id, a.a_receber])
    a = await acerto()
    assert.deepEqual([Number(a.pago), Number(a.falta)], [50 + Number(feitas.taxas), 0])
    const d = await um(`select categoria, descricao, favorecido_tipo, data::text = (${hoje})::text as hoje from despesas where entregador_id = $1`, [carlos.id])
    assert.deepEqual([d.categoria, d.descricao, d.favorecido_tipo, d.hoje], ['Motoboys', 'Pagamento — Carlos Moto', 'motoboy', true])
    // o pagamento já entra nas saídas do dia
    const r = (await um(`select relatorio_faturamento(${hoje}, ${hoje}) as r`)).r
    assert.equal(Number(r.resumo.despesas), despesasAntes + 50 + Number(feitas.taxas))
  })
  // valor fixo por entrega, sem diária
  await db.query(`update entregadores set repasse = 'fixo', valor_por_entrega = 6, diaria = 0 where id = $1`, [carlos.id])
  await como('authenticated', financeiro, async () => {
    const a = await acerto()
    assert.deepEqual([Number(a.diarias), Number(a.por_entregas)], [0, 6 * feitas.n])
  })
  // pagamento em dinheiro do caixa lança a sangria junto; apagar o pagamento devolve o dinheiro
  await como('authenticated', admin, async () => {
    await db.query(`select abrir_caixa(200)`)
    const caixa = (await um(`select id from caixas where fechado_em is null`)).id
    const pg = (await um(`select registrar_pagamento('cozinha', 80, null, ' Zé da Cozinha ', null, 'pix', true, 'Diária de sábado') as r`)).r
    assert.deepEqual([pg.nome, pg.do_caixa], ['Zé da Cozinha', true])
    const d = await um(`select categoria, forma_pagamento, observacao from despesas where id = $1`, [pg.id])
    assert.deepEqual([d.categoria, d.forma_pagamento, d.observacao], ['Salários', 'dinheiro', 'Diária de sábado'])
    assert.equal(Number((await um(`select resumo_caixa($1) as r`, [caixa])).r.sangrias), 80)
    await db.query(`delete from despesas where id = $1`, [pg.id])
    assert.equal(Number((await um(`select resumo_caixa($1) as r`, [caixa])).r.sangrias), 0)
    // com o caixa fechado, o pagamento que saiu dele não pode mais ser apagado
    const outro = (await um(`select registrar_pagamento('outro', 30, null, 'Faxina', null, 'dinheiro', true) as r`)).r
    await db.query(`select fechar_caixa(170)`)
    await falha(db.query(`delete from despesas where id = $1`, [outro.id]), 'caixa que já foi fechado')
  })
})

console.log(`\n${ok} testes passaram${process.exitCode ? ' (com falhas acima)' : ''}`)
