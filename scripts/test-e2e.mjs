// Testes de ponta a ponta: sobe o ambiente de demonstração e usa o sistema pelas telas, como uma pessoa faria,
// conferindo o resultado direto no banco. Cobre as ações principais do painel, do site e do app do motoboy.
// Uso: npm run test:e2e   (usa o Google Chrome instalado; CHROME=/caminho/do/chrome para outro local)
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { CHROME, encerrarProcesso } from './plataforma.mjs'

const PROJ = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTA_API = 54351, PORTA_SITE = 5203
const BASE = `http://localhost:${PORTA_SITE}`, API = `http://localhost:${PORTA_API}`
const SENHA = 'teste1234' // senha dos usuários fictícios do ambiente local (scripts/dev-local.mjs)
const DL = mkdtempSync(join(tmpdir(), 'tiace-e2e-'))
const abrirZip = (arquivo) => Object.fromEntries(Object.entries(unzipSync(readFileSync(join(DL, arquivo)))).map(([nome, dados]) => [nome, strFromU8(dados)]))

const servidor = spawn(process.execPath, [join(PROJ, 'scripts/dev-local.mjs')], { cwd: PROJ, stdio: 'ignore', env: { ...process.env, DEMO: '1', PORTA_API: String(PORTA_API), PORTA_SITE: String(PORTA_SITE) } })
const encerrar = () => { encerrarProcesso(servidor); rmSync(DL, { recursive: true, force: true }) }
process.on('exit', encerrar)
for (let i = 0; ; i++) {
  if (i > 90) throw new Error('o ambiente de demonstração não respondeu')
  await new Promise((r) => setTimeout(r, 1000))
  if (await fetch(BASE + '/').then((r) => r.ok, () => false)) break
}

const nav = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] })
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const erros = []
async function nova(tipo) {
  const ctx = await nav.createBrowserContext()
  await ctx.overridePermissions(BASE, ['geolocation'])
  const p = await ctx.newPage()
  await p.setViewport(tipo === 'celular' ? { width: 390, height: 800, isMobile: true, hasTouch: true } : { width: 1360, height: 860 })
  await p.setGeolocation({ latitude: -23.5612, longitude: -46.6561 })
  p.on('pageerror', (e) => erros.push(`exceção ${p.url()}: ${e.message.slice(0, 200)}`))
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|realtime|favicon|openstreetmap|Failed to load resource/.test(m.text()) && erros.push(`console ${p.url()}: ${m.text().slice(0, 200)}`))
  p.on('response', async (r) => {
    if (!r.url().startsWith(API) || r.status() < 400 || /realtime/.test(r.url())) return
    const corpo = (await r.text().catch(() => '')).slice(0, 160)
    if (/Invalid login credentials/.test(corpo)) return // senha errada digitada de propósito
    erros.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '').slice(0, 110)} ${corpo}`)
  })
  p.on('dialog', (d) => d.accept())
  const cdp = await p.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, browserContextId: ctx.id })
  return p
}
const ir = async (p, rota, espera = 900) => { await p.goto(BASE + rota, { waitUntil: 'networkidle2', timeout: 40000 }); await dormir(espera) }
async function clicar(p, trecho, seletor = 'button, a, [role=tab], summary, label') {
  const ok = await p.evaluate((trecho, seletor) => {
    const visivel = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'
    const alvo = [...document.querySelectorAll(seletor)].filter(visivel).find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().includes(trecho))
    alvo?.scrollIntoView({ block: 'center' }); alvo?.click(); return Boolean(alvo)
  }, trecho, seletor)
  assert.ok(ok, `não achei "${trecho}" em ${p.url()}`)
  await dormir(800)
}
async function preencher(p, rotulo, valor) {
  const campo = await p.evaluateHandle((rotulo) => {
    const visivel = (e) => e.offsetParent !== null
    const porRotulo = [...document.querySelectorAll('label')].filter(visivel).find((l) => l.innerText.trim().startsWith(rotulo))?.querySelector('input, select, textarea')
    return porRotulo ?? [...document.querySelectorAll('input, select, textarea')].filter(visivel).find((e) => (e.getAttribute('aria-label') ?? e.placeholder ?? '').startsWith(rotulo)) ?? null
  }, rotulo)
  const el = campo.asElement(); assert.ok(el, `campo "${rotulo}" não encontrado em ${p.url()}`)
  if ((await el.evaluate((e) => e.tagName)) === 'SELECT') {
    const v = await el.evaluate((e, valor) => [...e.options].find((o) => o.text.includes(valor) || o.value === valor)?.value, valor)
    await el.select(v ?? valor)
  } else { await el.evaluate((e) => { e.scrollIntoView({ block: 'center' }); e.focus(); e.select() }); await p.keyboard.press('Backspace'); await el.type(String(valor), { delay: 5 }) }
  await dormir(150)
}
const entrar = async (p, rota, email) => { await ir(p, rota); await p.type('input[type=email]', email); await p.type('input[type=password]', SENHA); await p.click('button[type=submit]'); await dormir(2500) }
const tok = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dona@teste.local', password: SENHA }) })).json()).access_token
const api = async (caminho, opcoes = {}) => (await fetch(`${API}/rest/v1/${caminho}`, { ...opcoes, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation', ...opcoes.headers } })).text().then((t) => (t ? JSON.parse(t) : null))
const rpc = (fn, args) => api(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
const baixados = async (n) => { for (let i = 0; i < 40; i++) { const f = readdirSync(DL).filter((x) => !x.endsWith('.crdownload')); if (f.length >= n) return f; await dormir(300) } return readdirSync(DL) }
async function teste(nome, fn) { try { await fn(); console.log("  ✓", nome) } catch (e) { console.log("  ✗", nome, "\n     ", e.stack.split("\n").slice(0, 8).join("\n      ")); process.exitCode = 1 } }

const pc = await nova('desktop')
await entrar(pc, '/admin', 'dona@teste.local')

await teste('exportar histórico de pedidos em PDF, Excel e CSV', async () => {
  await ir(pc, '/admin/pedidos'); await clicar(pc, 'Histórico', '[role=tab]')
  for (const f of ['PDF', 'Excel', 'CSV']) await clicar(pc, f, 'button')
  const arq = await baixados(3)
  const pdf = arq.find((f) => f.endsWith('.pdf')), xlsx = arq.find((f) => f.endsWith('.xlsx')), csv = arq.find((f) => f.endsWith('.csv'))
  assert.ok(pdf && xlsx && csv, 'arquivos: ' + arq.join(', '))
  assert.equal(readFileSync(`${DL}/${pdf}`).subarray(0, 5).toString(), '%PDF-')
  const partes = abrirZip(xlsx)
  assert.ok(partes['xl/worksheets/sheet1.xml'] && partes['xl/workbook.xml'])
  const planilha = partes['xl/worksheets/sheet1.xml']
  assert.ok(planilha.includes('Cliente') && /<v>\d+/.test(planilha))
  assert.ok(readFileSync(`${DL}/${csv}`).toString().includes('Nº;Data;Cliente'))
})

await teste('exportar relatório financeiro (Excel com uma aba por parte)', async () => {
  await ir(pc, '/admin/financeiro', 1500)
  await clicar(pc, 'Excel', 'button'); await clicar(pc, 'PDF', 'button')
  const arq = await baixados(5)
  const xlsx = arq.find((f) => f.startsWith('financeiro') && f.endsWith('.xlsx'))
  assert.ok(xlsx && arq.some((f) => f.startsWith('financeiro') && f.endsWith('.pdf')), arq.join(', '))
  const wb = abrirZip(xlsx)['xl/workbook.xml']
  assert.equal((wb.match(/<sheet /g) ?? []).length, 6)
  assert.ok(wb.includes('Resultado') && wb.includes('Saídas por categoria'))
})

await teste('editar produto: preço por tamanho e ingredientes (com registro na auditoria)', async () => {
  await ir(pc, '/admin/cardapio', 1200)
  await pc.evaluate(() => [...document.querySelectorAll('li')].find((l) => l.innerText.startsWith('Marguerita')).querySelector('[aria-label=Editar]').click()); await dormir(700)
  await preencher(pc, 'Grande', '61'); await preencher(pc, 'Ingredientes', 'Molho, mussarela, tomate e manjericão')
  await clicar(pc, 'Salvar', '[role=dialog] button[type=submit]'); await dormir(800)
  const p = (await api('produtos?select=id,ingredientes,produto_precos(preco)&nome=eq.Marguerita'))[0]
  assert.equal(p.ingredientes, 'Molho, mussarela, tomate e manjericão')
  assert.ok(p.produto_precos.some((x) => Number(x.preco) === 61))
  const aud = await api('auditoria?select=*&tabela=eq.produto_precos&order=id.desc&limit=1')
  assert.deepEqual([aud[0].descricao, aud[0].depois.preco, aud[0].usuario_nome], ['Marguerita (Grande)', 61, 'Tia Cê'])
})

await teste('criar promoção e ver o preço cair no site', async () => {
  await ir(pc, '/admin/conteudo', 1000); await clicar(pc, 'Promoções', '[role=tab]'); await clicar(pc, 'Nova promoção', 'button')
  await preencher(pc, 'Nome da promoção', 'Quarta da Mussarela'); await preencher(pc, 'Desconto (%)', '20')
  await clicar(pc, 'Mussarela', '[role=dialog] label')
  await clicar(pc, 'Salvar promoção', 'button'); await dormir(900)
  const vig = await rpc('promocoes_vigentes', {})
  const mus = (await api('produtos?select=id&nome=eq.Mussarela'))[0].id
  assert.ok(vig.some((v) => v.nome === 'Quarta da Mussarela' && v.produtos.includes(mus)))
  const cli = await nova('desktop'); await ir(cli, '/cardapio', 1200)
  assert.ok(await cli.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.includes('Mussarela'))?.innerText.includes('25,60')), 'preço promocional no cardápio (32,00 → 25,60)')
  await cli.close()
})

await teste('criar banner com imagem enviada', async () => {
  await ir(pc, '/admin/conteudo', 1000); await clicar(pc, 'Banners', '[role=tab]'); await clicar(pc, 'Novo banner', 'button')
  await preencher(pc, 'Título', 'Banner de teste')
  const arquivo = await pc.$('[role=dialog] input[type=file]'); await arquivo.uploadFile(join(PROJ, 'public/icone-192.png')); await dormir(1200)
  await clicar(pc, 'Salvar', '[role=dialog] button[type=submit]'); await dormir(800)
  const b = (await api('banners?select=*&titulo=eq.Banner%20de%20teste'))[0]
  assert.ok(b?.imagem_url, 'banner salvo com imagem')
  const img = await fetch(b.imagem_url); assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/png/)
})

await teste('entrada de estoque soma a quantidade', async () => {
  const antes = Number((await api('insumos?select=quantidade&nome=eq.Bacon'))[0].quantidade)
  await ir(pc, '/admin/estoque', 1200)
  await pc.evaluate(() => [...document.querySelectorAll('tr')].find((t) => t.innerText.startsWith('Bacon')).querySelector('button').click()); await dormir(600)
  await preencher(pc, 'Quantidade', '10'); await preencher(pc, 'Custo por', '42,50'); await clicar(pc, 'Registrar', 'button[type=submit]'); await dormir(800)
  assert.equal(Number((await api('insumos?select=quantidade&nome=eq.Bacon'))[0].quantidade), antes + 10)
})

await teste('desperdício: registro na aba do Estoque e pelo botão da tela de Pedidos', async () => {
  const qtd = async (nome) => Number((await api(`insumos?select=quantidade&nome=eq.${encodeURIComponent(nome)}`))[0].quantidade)
  const hoje = new Date(), dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  const antes = await qtd('Mussarela')
  await ir(pc, '/admin/estoque', 1200); await clicar(pc, 'Desperdício', '[role=tab]')
  await preencher(pc, 'Item do estoque', 'Mussarela'); await preencher(pc, 'Quantidade desperdiçada', '0,5'); await preencher(pc, 'O que aconteceu?', 'A porção caiu no chão')
  await clicar(pc, 'Registrar desperdício', 'button[type=submit]'); await dormir(1200)
  assert.ok(Math.abs((await qtd('Mussarela')) - (antes - 0.5)) < 1e-6, 'baixou do estoque')
  assert.ok(await pc.evaluate(() => [...document.querySelectorAll('main tbody tr')].some((t) => t.innerText.includes('A porção caiu no chão') && t.innerText.includes('Tia Cê'))), 'aparece na lista, com quem registrou')
  // sem motivo o formulário não envia
  await preencher(pc, 'Item do estoque', 'Bacon'); await preencher(pc, 'Quantidade desperdiçada', '1')
  const baconAntes = await qtd('Bacon')
  await clicar(pc, 'Registrar desperdício', 'button[type=submit]'); await dormir(600)
  assert.equal(await qtd('Bacon'), baconAntes)
  // a tela Cozinha saiu: quem tem essa função usa Pedidos (o endereço antigo cai lá) e registra sem ter acesso ao Estoque
  const coz = await nova('desktop'); await entrar(coz, '/admin', 'ze@teste.local')
  await ir(coz, '/admin/cozinha', 1000)
  assert.ok(coz.url().endsWith('/admin/pedidos'), coz.url())
  const menuCoz = await coz.evaluate(() => [...document.querySelectorAll('aside nav a')].map((a) => a.innerText.trim().split('\n')[0]))
  assert.deepEqual(menuCoz, ['Pedidos', 'Novo pedido'], 'função Cozinha: só Pedidos e Novo pedido')
  await clicar(coz, 'Registrar desperdício', 'main button'); await dormir(600)
  await preencher(coz, 'Item do estoque', 'Calabresa'); await preencher(coz, 'Quantidade desperdiçada', '0.2'); await clicar(coz, 'Queimou no forno', '[role=dialog] button')
  const calAntes = await qtd('Calabresa')
  await clicar(coz, 'Registrar desperdício', '[role=dialog] button[type=submit]'); await dormir(1200)
  assert.ok(Math.abs((await qtd('Calabresa')) - (calAntes - 0.2)) < 1e-6, 'cozinha baixou do estoque')
  const lista = await rpc('listar_desperdicios', { p_inicio: dia, p_fim: dia })
  assert.ok(lista.registros.some((d) => d.insumo === 'Calabresa' && d.observacao === 'Queimou no forno' && d.usuario.startsWith('Zé')), JSON.stringify(lista.registros.slice(0, 2)))
  await coz.close()
})

await teste('caixa: sangria, fechamento com diferença e nova abertura', async () => {
  await ir(pc, '/admin/caixa', 1500)
  await clicar(pc, 'Sangria', 'button'); await preencher(pc, 'Valor', '20'); await preencher(pc, 'Motivo', 'Teste'); await clicar(pc, 'Registrar', 'button[type=submit]'); await dormir(800)
  await clicar(pc, 'Fechar caixa', 'button'); await preencher(pc, 'Dinheiro contado', '60'); await clicar(pc, 'Confirmar fechamento', 'button'); await dormir(1200)
  const cx = (await api('caixas?select=*&order=aberto_em.desc&limit=1'))[0]
  assert.ok(cx.fechado_em && Number(cx.valor_informado) === 60 && Number(cx.diferenca) === 60 - Number(cx.valor_esperado))
  await preencher(pc, 'Troco inicial', '100'); await clicar(pc, 'Abrir caixa', 'button'); await dormir(1000)
  assert.equal((await api('caixas?select=id&fechado_em=is.null')).length, 1)
})

const numero = async (status) => (await api(`pedidos?select=id,numero&status=eq.${status}&order=criado_em.desc&limit=1`))[0]
const abrirPedido = async (n) => { await ir(pc, '/admin/pedidos', 1000); await preencher(pc, 'Buscar pedido pelo número', String(n)); await pc.keyboard.press('Enter'); await dormir(1300) }
const situacao = async (id) => (await api(`pedidos?select=status,pago,motivo_cancelamento,motivo_reembolso,problema_entrega&id=eq.${id}`))[0]

await teste('aceitar pelo quadro e cancelar com motivo', async () => {
  const p = await numero('novo')
  await ir(pc, '/admin/pedidos', 1200)
  await pc.evaluate((n) => [...[...document.querySelectorAll('article')].find((a) => a.innerText.includes(`#${n}`)).querySelectorAll('button')].find((b) => b.innerText.includes('Aceitar')).click(), p.numero); await dormir(1500)
  assert.equal((await situacao(p.id)).status, 'confirmado')
  await abrirPedido(p.numero)
  await clicar(pc, 'Cancelar', '[role=dialog] footer button'); await preencher(pc, 'Motivo', 'Cliente desistiu'); await clicar(pc, 'Confirmar cancelamento', 'button'); await dormir(1200)
  assert.deepEqual(await situacao(p.id), { status: 'cancelado', pago: false, motivo_cancelamento: 'Cliente desistiu', motivo_reembolso: null, problema_entrega: null })
})

await teste('problema na entrega, nova tentativa e reembolso de pedido entregue', async () => {
  const rua = await numero('saiu_entrega')
  await abrirPedido(rua.numero)
  await clicar(pc, 'Problema', '[role=dialog] footer button'); await preencher(pc, 'O que aconteceu?', 'Endereço não encontrado'); await clicar(pc, 'Registrar problema', 'button'); await dormir(1200)
  assert.deepEqual([(await situacao(rua.id)).status, (await situacao(rua.id)).problema_entrega], ['problema_entrega', 'Endereço não encontrado'])
  await clicar(pc, 'Tentar entregar de novo', '[role=dialog] footer button'); await dormir(1200)
  assert.deepEqual([(await situacao(rua.id)).status, (await situacao(rua.id)).problema_entrega], ['saiu_entrega', null])
  const ent = await numero('entregue')
  await abrirPedido(ent.numero)
  await clicar(pc, 'Reembolsar', '[role=dialog] footer button'); await preencher(pc, 'Motivo do reembolso', 'Pizza errada'); await clicar(pc, 'Confirmar reembolso', 'button'); await dormir(1200)
  assert.deepEqual([(await situacao(ent.id)).status, (await situacao(ent.id)).pago, (await situacao(ent.id)).motivo_reembolso], ['reembolsado', false, 'Pizza errada'])
  const h = await rpc('historico_pedido', { p_pedido: ent.id })
  assert.equal(h.at(-1).depois.status, 'reembolsado')
})

await teste('permissões: liberar e retirar uma tela de uma função', async () => {
  await ir(pc, '/admin/configuracoes', 1000); await clicar(pc, 'Permissões', '[role=tab]')
  await pc.click('[aria-label="Atendimento pode usar Estoque"]'); await dormir(900)
  assert.equal((await api('permissoes?select=*&papel=eq.atendente&modulo=eq.estoque')).length, 1)
  await pc.click('[aria-label="Atendimento pode usar Estoque"]'); await dormir(900)
  assert.equal((await api('permissoes?select=*&papel=eq.atendente&modulo=eq.estoque')).length, 0)
})

await teste('criar usuário motoboy já ligado a um entregador; metas salvas', async () => {
  await ir(pc, '/admin/configuracoes', 1000); await clicar(pc, 'Usuários', '[role=tab]'); await clicar(pc, 'Novo usuário', 'button')
  await preencher(pc, 'Nome', 'João Entregas'); await preencher(pc, 'E-mail', 'joao@teste.local'); await preencher(pc, 'Senha inicial', 'teste1234'); await preencher(pc, 'Função', 'Motoboy')
  await clicar(pc, 'Criar usuário', 'button'); await dormir(1200)
  const perfil = (await api('perfis?select=*&email=eq.joao@teste.local'))[0]
  assert.deepEqual([perfil?.papel, perfil?.ativo], ['motoboy', true])
  const ent = (await api(`entregadores?select=nome,diaria,repasse&usuario_id=eq.${perfil.id}`))[0]
  assert.deepEqual([ent.nome, Number(ent.diaria), ent.repasse], ['João Entregas', 50, 'taxa'], 'motoboy nasce com diária de R$ 50 + taxa das entregas')
  // e consegue entrar no aplicativo de entregas com a senha criada
  const joao = await nova('celular'); await entrar(joao, '/entregador', 'joao@teste.local')
  assert.ok(await joao.evaluate(() => /entrega/i.test(document.body.innerText) && !document.querySelector('input[type=password]')), 'entrou no aplicativo de entregas')
  await joao.close()
  await clicar(pc, 'Metas e indicadores', '[role=tab]')
  await preencher(pc, 'Faturamento por dia: ruim', '1200'); await clicar(pc, 'Salvar', 'button[type=submit]'); await dormir(900)
  assert.equal((await rpc('config_interna', {})).metas.faturamento_dia.ruim, 1200)
})

await teste('marcar pronto avisa o celular do motoboy que entrou no aplicativo', async () => {
  // o aplicativo Android registra o aparelho ao entrar; aqui o registro é feito direto, como o motoboy
  const aparelho = 'aparelho-e2e-'.padEnd(60, 'x')
  const moto = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'carlos@teste.local', password: SENHA }) })).json()).access_token
  const registrar = (ligar) => fetch(`${API}/rest/v1/rpc/entrega_aparelho`, { method: 'POST', headers: { authorization: `Bearer ${moto}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_token: aparelho, p_ligar: ligar }) })
  assert.ok((await registrar(true)).ok)
  const carlos = (await api(`entregadores?select=id&nome=eq.${encodeURIComponent('Carlos Moto')}`))[0]
  const p = (await api(`pedidos?select=id,numero&status=eq.em_preparo&tipo=eq.entrega&entregador_id=eq.${carlos.id}&limit=1`))[0]
  await ir(pc, '/admin/pedidos', 1200)
  const aviso = pc.waitForResponse((r) => r.url().includes('/functions/v1/avisar-entregador') && r.request().method() === 'POST', { timeout: 10000 })
  await pc.evaluate((n) => [...[...document.querySelectorAll('article')].find((a) => a.innerText.includes(`#${n}`)).querySelectorAll('button')].find((b) => b.innerText.includes('Marcar pronto')).click(), p.numero)
  assert.deepEqual(await (await aviso).json(), { avisados: 1 })
  assert.equal((await situacao(p.id)).status, 'pronto')
  assert.ok((await registrar(false)).ok)
})

await teste('motoboy conclui a entrega pelo aplicativo', async () => {
  const moto = await nova('celular'); await entrar(moto, '/entregador', 'carlos@teste.local'); await dormir(1200)
  const rua = await numero('saiu_entrega')
  await clicar(moto, 'Entreguei', 'button'); await dormir(1500)
  assert.deepEqual([(await situacao(rua.id)).status, (await situacao(rua.id)).pago], ['entregue', true])
  assert.ok(await moto.evaluate(() => document.body.innerText.includes('entrega(s) hoje')))
  await moto.close()
})

await teste('pagamentos: motoboy recebe diária + entregas, o dinheiro sai do caixa e desconta do líquido', async () => {
  const hoje = new Date(), dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  const acerto = async () => (await rpc('acerto_entregadores', { p_inicio: dia, p_fim: dia })).find((e) => e.nome === 'Carlos Moto')
  const antes = await acerto()
  assert.ok(antes.entregas >= 1 && Number(antes.diarias) === 50 && Number(antes.a_receber) === 50 + Number(antes.taxas), JSON.stringify(antes))
  const saidasAntes = Number((await rpc('relatorio_faturamento', { p_inicio: dia, p_fim: dia, p_agrupar: 'dia' })).resumo.despesas)
  await ir(pc, '/admin/pagamentos', 1800)
  assert.ok(await pc.evaluate(() => [...document.querySelectorAll('main tbody tr')].some((t) => t.innerText.includes('Carlos Moto') && t.innerText.includes('diária de R$') && t.innerText.includes('a taxa de cada entrega'))), 'regra do motoboy na tabela')
  await pc.evaluate(() => [...[...document.querySelectorAll('main tbody tr')].find((t) => t.innerText.includes('Carlos Moto')).querySelectorAll('button')].find((b) => b.innerText.includes('Pagar')).click()); await dormir(1500)
  // o valor que falta já vem preenchido e, com o caixa aberto, a origem é o dinheiro do caixa
  assert.equal(Number((await pc.evaluate(() => [...document.querySelectorAll('[role=dialog] label')].find((l) => l.innerText.startsWith('Valor pago')).querySelector('input').value)).replace(',', '.')), Number(antes.falta))
  await clicar(pc, 'Confirmar pagamento', '[role=dialog] button[type=submit]'); await dormir(1500)
  const pg = (await api(`despesas?select=*&favorecido_tipo=eq.motoboy&data=eq.${dia}&order=criado_em.desc&limit=1`))[0]
  assert.deepEqual([pg.favorecido, Number(pg.valor), pg.categoria, pg.caixa_movimento_id != null], ['Carlos Moto', Number(antes.falta), 'Motoboys', true])
  const depois = await acerto()
  assert.deepEqual([Number(depois.pago) - Number(antes.pago), Number(depois.falta)], [Number(antes.falta), 0])
  assert.equal(Number((await rpc('relatorio_faturamento', { p_inicio: dia, p_fim: dia, p_agrupar: 'dia' })).resumo.despesas), saidasAntes + Number(antes.falta), 'entrou nas saídas do dia')
  assert.ok(await pc.evaluate(() => document.querySelector('main').innerText.includes('Líquido de hoje')), 'mostra o líquido do dia')
  // funcionário da cozinha, pago por Pix
  await clicar(pc, 'Novo pagamento', 'main button'); await clicar(pc, 'Funcionário da cozinha', '[role=dialog] button')
  await preencher(pc, 'Nome de quem recebeu', 'Dona Lúcia'); await preencher(pc, 'Valor pago', '80'); await preencher(pc, 'De onde saiu o dinheiro?', 'Pix'); await preencher(pc, 'Observação', 'Diária de teste')
  await clicar(pc, 'Confirmar pagamento', '[role=dialog] button[type=submit]'); await dormir(1500)
  const coz = (await api(`despesas?select=*&favorecido_tipo=eq.cozinha&observacao=eq.Di%C3%A1ria%20de%20teste`))[0]
  assert.deepEqual([coz.favorecido, Number(coz.valor), coz.categoria, coz.forma_pagamento, coz.caixa_movimento_id], ['Dona Lúcia', 80, 'Salários', 'pix', null])
  // apagar o pagamento do motoboy devolve o dinheiro ao caixa
  await pc.evaluate(() => [...document.querySelectorAll('main tbody tr')].find((t) => t.innerText.includes('Carlos Moto') && t.innerText.includes('Dinheiro do caixa')).querySelector('[aria-label^="Apagar"]').click()); await dormir(1500)
  assert.equal((await api(`despesas?select=id&id=eq.${pg.id}`)).length, 0)
  assert.equal((await api(`caixa_movimentos?select=id&id=eq.${pg.caixa_movimento_id}`)).length, 0)
  // a tela de Entregas mostra o mesmo acerto
  await ir(pc, '/admin/entregas', 1200); await clicar(pc, 'Acerto de entregas', '[role=tab]'); await dormir(1200)
  assert.ok(await pc.evaluate(() => [...document.querySelectorAll('main tbody tr')].some((t) => t.innerText.includes('Carlos Moto') && t.innerText.includes('Pagar'))))
})

await teste('cliente cria conta com e-mail e senha, pede com Pix e recebe a chave com o envio do comprovante', async () => {
  await api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ cnpj: '41522638000170' }), headers: { prefer: 'return=minimal' } })
  const cel = await nova('celular'); await ir(cel, '/', 1200)
  // no celular: aberto/fechado, Instagram em destaque e CNPJ no rodapé
  assert.ok(await cel.evaluate(() => [...document.querySelectorAll('[role=status]')].some((e) => e.offsetParent !== null && /Aberto agora|Fechado agora/.test(e.innerText))), 'faixa de aberto/fechado visível no celular')
  assert.ok((await cel.evaluate(() => [...document.querySelectorAll('header a[href="https://instagram.com/tiacepizzas"], main a[href="https://instagram.com/tiacepizzas"]')].filter((e) => e.offsetParent !== null).length)) >= 2, 'Instagram no topo e na capa')
  assert.ok(await cel.evaluate(() => document.querySelector('footer').innerText.includes('CNPJ 41.522.638/0001-70')), 'CNPJ no rodapé')
  await ir(cel, '/entrar?criar')
  await preencher(cel, 'Seu nome', 'Bia Nova'); await preencher(cel, 'E-mail', 'bia.nova@teste.local'); await preencher(cel, 'Crie uma senha', 'segredo-da-bia')
  await clicar(cel, 'Criar minha conta', 'button[type=submit]'); await dormir(2500)
  assert.ok(/\/conta#?$/.test(cel.url()), cel.url())
  assert.equal((await api('perfis?select=id&email=eq.bia.nova@teste.local')).length, 0, 'conta de cliente não vira usuário do painel')
  assert.equal((await api('clientes?select=nome&email=eq.bia.nova@teste.local'))[0].nome, 'Bia Nova')
  await ir(cel, '/admin', 1200)
  assert.ok(await cel.evaluate(() => document.body.innerText.includes('Acesso restrito')), 'cliente não entra no painel')
  await ir(cel, '/cardapio'); await clicar(cel, 'Portuguesa', 'main button'); await clicar(cel, 'Adicionar ·', 'button')
  await ir(cel, '/checkout', 1500)
  await preencher(cel, 'WhatsApp', '11972223333'); await preencher(cel, 'Rua / avenida', 'Rua das Palmeiras'); await preencher(cel, 'Número', '12'); await preencher(cel, 'Bairro', 'Centro')
  await clicar(cel, 'Pix', 'button'); await clicar(cel, 'Enviar pedido', 'button'); await dormir(2500)
  assert.ok(cel.url().includes('/pedido?c='), cel.url())
  const ult = (await api(`pedidos?select=numero,cliente_nome,forma_pagamento,total&order=criado_em.desc&limit=1`))[0]
  assert.deepEqual([ult.cliente_nome, ult.forma_pagamento], ['Bia Nova', 'pix'])
  const tela = await cel.evaluate(() => ({
    texto: document.querySelector('main').innerText,
    comprovante: [...document.querySelectorAll('main a')].find((a) => a.innerText.includes('Enviar comprovante'))?.href ?? '',
    falar: [...document.querySelectorAll('main a')].find((a) => a.innerText.includes('Falar sobre este pedido'))?.href ?? '',
  }))
  assert.ok(tela.texto.includes('Pague com Pix') && tela.texto.includes('pix@tiacepizzas.com.br') && tela.texto.includes('comprovante'), 'chave Pix e pedido do comprovante na tela')
  assert.ok(tela.comprovante.includes('wa.me/5511999990000') && decodeURIComponent(tela.comprovante).includes(`pedido #${ult.numero}`), tela.comprovante)
  assert.ok(decodeURIComponent(tela.falar).includes(`pedido #${ult.numero}`), tela.falar)
  // sai e entra de novo com a senha criada
  await ir(cel, '/conta', 1200); await clicar(cel, 'Sair', 'button'); await dormir(1200)
  await ir(cel, '/entrar'); await preencher(cel, 'E-mail', 'bia.nova@teste.local'); await preencher(cel, 'Senha', 'senha-errada')
  await clicar(cel, 'Entrar', 'button[type=submit]'); await dormir(1500)
  assert.ok(await cel.evaluate(() => document.body.innerText.includes('E-mail ou senha incorretos')))
  await preencher(cel, 'Senha', 'segredo-da-bia'); await clicar(cel, 'Entrar', 'button[type=submit]'); await dormir(2500)
  assert.ok(/\/conta#?$/.test(cel.url()), cel.url())
  await cel.close()
})

await teste('cliente com conta: novo endereço, pedido e lista de pedidos', async () => {
  const cel = await nova('celular'); await ir(cel, '/entrar'); await clicar(cel, 'Continuar com Google', 'button'); await dormir(2500)
  assert.ok(/\/conta#?$/.test(cel.url()), cel.url())
  await clicar(cel, 'Adicionar endereço', 'button')
  await preencher(cel, 'Rua / avenida', 'Rua Frei Caneca'); await preencher(cel, 'Número', '77'); await preencher(cel, 'Bairro', 'Centro')
  await clicar(cel, 'Salvar endereço', 'button'); await dormir(4500)
  const conta = (await api('clientes?select=id,enderecos(logradouro)&email=eq.carla.google@teste.local'))[0]
  assert.ok(conta.enderecos.some((e) => e.logradouro === 'Rua Frei Caneca'))
  await ir(cel, '/cardapio'); await clicar(cel, 'Portuguesa', 'main button'); await clicar(cel, 'Adicionar ·', 'button')
  await ir(cel, '/checkout', 1500)
  assert.equal(await cel.evaluate(() => document.querySelector('input[autocomplete=name]').value), 'Carla Cliente')
  await clicar(cel, 'Rua Frei Caneca', 'button'); await clicar(cel, 'Enviar pedido', 'button'); await dormir(2200)
  assert.ok(cel.url().includes('/pedido?c='), cel.url())
  const ult = (await api(`pedidos?select=cliente_id,endereco,status&order=criado_em.desc&limit=1`))[0]
  assert.deepEqual([ult.cliente_id, ult.endereco.logradouro, ult.status], [conta.id, 'Rua Frei Caneca', 'novo'])
  await ir(cel, '/conta', 1500)
  assert.equal(await cel.evaluate(() => document.querySelectorAll('section a[href^="/pedido?c="]').length), 4)
  await cel.close()
})

await teste('página inicial em blocos: imagem clicável, texto e botão, arrastar, prévia e site', async () => {
  const blocos = () => pc.evaluate(() => [...document.querySelectorAll('ol > li[data-bloco]')].map((li) => li.querySelector('button[aria-expanded] .font-semibold').innerText.trim()))
  const adicionar = async (tipo) => { await pc.evaluate((tipo) => [...[...document.querySelectorAll('p')].find((p) => p.innerText.includes('Adicionar no fim da página')).parentElement.querySelectorAll('button')].find((b) => b.innerText.trim() === tipo).click(), tipo); await dormir(500) }
  await ir(pc, '/admin/conteudo', 1200)
  await clicar(pc, 'Livre, com blocos', 'button')
  assert.deepEqual(await blocos(), ['Capa', 'Banners cadastrados', 'Produtos em promoção', 'Destaques', 'Como funciona'], 'começa pela página padrão')
  // imagem enviada do computador, que leva para as promoções
  await adicionar('Imagem ou banner')
  await (await pc.$('ol input[type=file]')).uploadFile(join(PROJ, 'public/icone-192.png')); await dormir(1500)
  await preencher(pc, 'Ao tocar na imagem', 'promocoes'); await preencher(pc, 'O que a imagem mostra', 'Promoções do dia')
  await adicionar('Texto'); await preencher(pc, 'Título (opcional)', 'Bloco de teste'); await preencher(pc, 'Texto', 'Linha escrita no teste')
  await adicionar('Botão'); await preencher(pc, 'Texto do botão', 'Pedir agora')
  // arrasta a imagem (6ª) para o topo da página
  assert.equal((await blocos()).length, 8)
  const alca = await pc.evaluate(() => { const h = document.querySelector('[aria-label="Arrastar Imagem ou banner"]'); h.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await pc.mouse.move(alca.x, alca.y); await pc.mouse.down()
  for (let y = alca.y; y > 20; y -= 25) { await pc.mouse.move(alca.x, y); await dormir(40) }
  await pc.mouse.move(alca.x, 5); await dormir(900) // perto do topo a página rola sozinha
  for (let i = 0; i < 12; i++) { await pc.mouse.move(alca.x + (i % 2), 5); await dormir(60) }
  await pc.mouse.up(); await dormir(400)
  assert.equal((await blocos())[0], 'Imagem ou banner', (await blocos()).join(' > '))
  // a prévia mostra o rascunho antes de salvar
  const previa = pc.frames().find((f) => f.url().includes('previa'))
  assert.ok(previa && (await previa.evaluate(() => document.querySelector('main')?.innerText.includes('Bloco de teste'))), 'prévia com o que ainda não foi salvo')
  assert.equal((await api('site_conteudo?select=dados'))[0].dados.modo ?? 'padrao', 'padrao', 'nada muda no site antes de salvar')
  await clicar(pc, 'Salvar página inicial', 'button[type=submit]'); await dormir(1200)
  const dados = (await api('site_conteudo?select=dados'))[0].dados
  assert.deepEqual([dados.modo, dados.blocos.length, dados.blocos[0].tipo, dados.blocos[0].destino.tipo, Boolean(dados.blocos[0].imagem_url)], ['blocos', 8, 'imagem', 'promocoes', true])
  // no site: a imagem vem primeiro, é clicável e abre só as promoções
  const cel = await nova('celular'); await ir(cel, '/', 1200)
  const tela = await cel.evaluate(() => ({
    primeiro: document.querySelector('main a')?.getAttribute('href'), alt: document.querySelector('main a img')?.alt,
    texto: document.querySelector('main').innerText.includes('Bloco de teste') && document.querySelector('main').innerText.includes('Linha escrita no teste'),
    botao: [...document.querySelectorAll('main a')].find((a) => a.innerText.trim() === 'Pedir agora')?.getAttribute('href'),
  }))
  assert.deepEqual(tela, { primeiro: '/cardapio?promocoes=1', alt: 'Promoções do dia', texto: true, botao: '/cardapio' })
  await cel.evaluate(() => document.querySelector('main a img').closest('a').click()); await dormir(1200)
  const promo = await cel.evaluate(() => ({ url: location.pathname + location.search, titulo: document.querySelector('main h1').innerText, itens: document.querySelectorAll('main section button').length, selos: [...document.querySelectorAll('main section button')].filter((b) => /OFF|promo/i.test(b.innerText)).length }))
  assert.ok(promo.url === '/cardapio?promocoes=1' && promo.titulo === 'Promoções de hoje' && promo.itens >= 1 && promo.itens === promo.selos, JSON.stringify(promo))
  await cel.close()
  // volta ao padrão: os blocos ficam guardados e o site volta a mostrar as seções prontas
  await clicar(pc, 'Padrão', 'button'); await clicar(pc, 'Salvar página inicial', 'button[type=submit]'); await dormir(1200)
  const volta = (await api('site_conteudo?select=dados'))[0].dados
  assert.deepEqual([volta.modo, volta.blocos.length], ['padrao', 8])
})

await teste('entrega por distância: taxa pela faixa e bloqueio fora da área', async () => {
  await api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ modo_entrega: 'distancia' }), headers: { prefer: 'return=minimal' } })
  const cli = await nova('desktop'); await ir(cli, '/cardapio'); await clicar(cli, 'Calabresa', 'main button'); await clicar(cli, 'Adicionar ·', 'button'); await ir(cli, '/checkout', 1200)
  await preencher(cli, 'Nome', 'Teste Distância'); await preencher(cli, 'WhatsApp', '11973000000')
  // a taxa aparece sozinha: a pessoa só preenche a rua e o número
  assert.ok(await cli.evaluate(() => !document.querySelector('main select')), 'por distância o cliente não escolhe bairro nem taxa')
  await preencher(cli, 'Rua / avenida', 'Rua Augusta'); await preencher(cli, 'Número', '1500'); await dormir(7000)
  const achou = await cli.evaluate(() => document.body.innerText.includes('Entregamos aí'))
  if (!achou) { await clicar(cli, 'Marcar manualmente', 'button'); await dormir(1500) }
  await clicar(cli, 'Enviar pedido', 'button'); await dormir(2200)
  const ult = (await api(`pedidos?select=cliente_nome,taxa_entrega,distancia_km,lat&order=criado_em.desc&limit=1`))[0]
  assert.equal(ult.cliente_nome, 'Teste Distância'); assert.ok(ult.lat != null && ult.distancia_km != null && Number(ult.taxa_entrega) >= 5, JSON.stringify(ult))
  console.log(`     (endereço ${achou ? 'localizado pelo mapa' : 'marcado manualmente'}: ${ult.distancia_km} km, taxa ${ult.taxa_entrega})`)
  const fora = await rpc('calcular_entrega', { p_lat: -23.9, p_lng: -46.65 })
  assert.equal(fora.dentro, false)
  await api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ modo_entrega: 'bairro' }), headers: { prefer: 'return=minimal' } })
  await cli.close()
})

await teste('entrega pronta sem motoboy fica sinalizada; rastrear entrega mostra o motoboy no mapa e avisa quando some o sinal', async () => {
  const cartao = (n) => pc.evaluate((n) => [...document.querySelectorAll('article')].find((a) => a.innerText.includes(`#${n}`))?.innerText ?? '', n)
  const noCartao = async (n, botao) => { await pc.evaluate((n, botao) => [...[...document.querySelectorAll('article')].find((a) => a.innerText.includes(`#${n}`)).querySelectorAll('button')].find((b) => b.innerText.includes(botao)).click(), n, botao); await dormir(1500) }
  // uma entrega fica pronta sem ninguém escolhido para levar
  const p = (await api('pedidos?select=id,numero&tipo=eq.entrega&status=eq.em_preparo&order=criado_em.desc&limit=1'))[0]
  assert.ok(p, 'há uma entrega em preparo na demonstração')
  await api(`pedidos?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pronto', entregador_id: null }) })
  await ir(pc, '/admin/pedidos', 1200)
  assert.ok((await cartao(p.numero)).includes('Falta escolher o motoboy'), 'cartão sinalizado')
  assert.ok(await pc.evaluate(() => [...document.querySelectorAll('main [role=alert]')].some((a) => a.innerText.includes('pronto sem motoboy'))), 'faixa de alertas')
  // escolhido o motoboy, o aviso some
  await abrirPedido(p.numero)
  assert.ok(await pc.evaluate(() => document.querySelector('[role=dialog]').innerText.includes('Falta escolher o motoboy')))
  await preencher(pc, 'Motoboy responsável', 'Carlos Moto'); await dormir(1200)
  await pc.keyboard.press('Escape'); await dormir(700)
  assert.ok(!(await cartao(p.numero)).includes('Falta escolher o motoboy'), 'com motoboy o aviso some')
  // saiu para entrega: o celular do motoboy manda a posição e o painel mostra no mapa
  await noCartao(p.numero, 'Saiu para entrega')
  const tokMoto = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'carlos@teste.local', password: SENHA }) })).json()).access_token
  await fetch(`${API}/rest/v1/rpc/entrega_posicao`, { method: 'POST', headers: { authorization: `Bearer ${tokMoto}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_lat: -23.5581, p_lng: -46.6602 }) })
  await noCartao(p.numero, 'Rastrear entrega'); await dormir(1500)
  const janela = () => pc.evaluate(() => [...document.querySelectorAll('[role=dialog]')].at(-1).innerText)
  assert.match(await janela(), new RegExp(`Rastrear entrega · Pedido #${p.numero}[\\s\\S]*Carlos Moto[\\s\\S]*Posição recebida`))
  assert.ok(await pc.evaluate(() => [...document.querySelectorAll('[role=dialog] .leaflet-marker-icon')].some((m) => m.innerText.includes('🛵'))), 'motoboy no mapa')
  // celular sem mandar a posição há 10 minutos: a janela se atualiza sozinha e avisa
  await api('entregadores?nome=eq.Carlos%20Moto', { method: 'PATCH', body: JSON.stringify({ posicao_em: new Date(Date.now() - 10 * 60000).toISOString() }) })
  await dormir(11500)
  assert.match(await janela(), /Sem sinal há 10 min/)
  await pc.keyboard.press('Escape'); await dormir(500)
})

await nav.close()
// nenhuma chamada deste roteiro deveria falhar: qualquer erro de console ou da API reprova
if (erros.length) { console.log(`\nErros observados:\n${[...new Set(erros)].join('\n')}`); process.exitCode = 1 } else console.log('\nNenhum erro de console ou de API.')
process.exit()
