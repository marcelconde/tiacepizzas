// Testes de ponta a ponta: sobe o ambiente de demonstração e usa o sistema pelas telas, como uma pessoa faria,
// conferindo o resultado direto no banco. Cobre as ações principais do painel, do site e do app do motoboy.
// Uso: npm run test:e2e   (usa o Google Chrome instalado; CHROME=/caminho/do/chrome para outro local)
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJ = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTA_API = 54351, PORTA_SITE = 5203
const BASE = `http://localhost:${PORTA_SITE}`, API = `http://localhost:${PORTA_API}`
const SENHA = 'teste1234' // senha dos usuários fictícios do ambiente local (scripts/dev-local.mjs)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DL = mkdtempSync(join(tmpdir(), 'tiace-e2e-'))

const servidor = spawn(process.execPath, [join(PROJ, 'scripts/dev-local.mjs')], { cwd: PROJ, stdio: 'ignore', env: { ...process.env, DEMO: '1', PORTA_API: String(PORTA_API), PORTA_SITE: String(PORTA_SITE) } })
const encerrar = () => { servidor.kill('SIGTERM'); rmSync(DL, { recursive: true, force: true }) }
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
  p.on('response', async (r) => r.url().startsWith(API) && r.status() >= 400 && !/realtime/.test(r.url()) && erros.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '').slice(0, 110)} ${(await r.text().catch(() => '')).slice(0, 160)}`))
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
  const lista = execFileSync('unzip', ['-l', `${DL}/${xlsx}`]).toString()
  assert.ok(lista.includes('xl/worksheets/sheet1.xml') && lista.includes('xl/workbook.xml'))
  const planilha = execFileSync('unzip', ['-p', `${DL}/${xlsx}`, 'xl/worksheets/sheet1.xml']).toString()
  assert.ok(planilha.includes('Cliente') && /<v>\d+/.test(planilha))
  assert.ok(readFileSync(`${DL}/${csv}`).toString().includes('Nº;Data;Cliente'))
})

await teste('exportar relatório financeiro (Excel com uma aba por parte)', async () => {
  await ir(pc, '/admin/financeiro', 1500)
  await clicar(pc, 'Excel', 'button'); await clicar(pc, 'PDF', 'button')
  const arq = await baixados(5)
  const xlsx = arq.find((f) => f.startsWith('financeiro') && f.endsWith('.xlsx'))
  assert.ok(xlsx && arq.some((f) => f.startsWith('financeiro') && f.endsWith('.pdf')), arq.join(', '))
  const wb = execFileSync('unzip', ['-p', `${DL}/${xlsx}`, 'xl/workbook.xml']).toString()
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
  assert.equal((await api(`entregadores?select=nome&usuario_id=eq.${perfil.id}`))[0].nome, 'João Entregas')
  await clicar(pc, 'Metas e indicadores', '[role=tab]')
  await preencher(pc, 'Faturamento por dia: ruim', '1200'); await clicar(pc, 'Salvar', 'button[type=submit]'); await dormir(900)
  assert.equal((await rpc('config_interna', {})).metas.faturamento_dia.ruim, 1200)
})

await teste('motoboy conclui a entrega pelo aplicativo', async () => {
  const moto = await nova('celular'); await entrar(moto, '/entregador', 'carlos@teste.local'); await dormir(1200)
  const rua = await numero('saiu_entrega')
  await clicar(moto, 'Entreguei', 'button'); await dormir(1500)
  assert.deepEqual([(await situacao(rua.id)).status, (await situacao(rua.id)).pago], ['entregue', true])
  assert.ok(await moto.evaluate(() => document.body.innerText.includes('entrega(s) hoje')))
  await moto.close()
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

await teste('entrega por distância: taxa pela faixa e bloqueio fora da área', async () => {
  await api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ modo_entrega: 'distancia' }), headers: { prefer: 'return=minimal' } })
  const cli = await nova('desktop'); await ir(cli, '/cardapio'); await clicar(cli, 'Calabresa', 'main button'); await clicar(cli, 'Adicionar ·', 'button'); await ir(cli, '/checkout', 1200)
  await preencher(cli, 'Nome', 'Teste Distância'); await preencher(cli, 'WhatsApp', '11973000000')
  await preencher(cli, 'Rua / avenida', 'Rua Augusta'); await preencher(cli, 'Número', '1500'); await cli.keyboard.press('Tab'); await dormir(6000)
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

await nav.close()
// nenhuma chamada deste roteiro deveria falhar: qualquer erro de console ou da API reprova
if (erros.length) { console.log(`\nErros observados:\n${[...new Set(erros)].join('\n')}`); process.exitCode = 1 } else console.log('\nNenhum erro de console ou de API.')
process.exit()
