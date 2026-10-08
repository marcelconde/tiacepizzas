// Tira as capturas de tela usadas no manual (docs/manual/capturas/), navegando pelo sistema como
// cliente, equipe e motoboy. Precisa do ambiente de demonstração no ar:
//
//   npm run dev:demo            (em um terminal)
//   npm run manual              (em outro: capturas + PDF)
//
// Usa o Google Chrome instalado no computador (CHROME=/caminho/do/chrome para outro local).
import puppeteer from 'puppeteer-core'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const destino = join(raiz, 'docs', 'manual', 'capturas')
const BASE = process.env.BASE ?? 'http://localhost:5173'
const API = process.env.API ?? 'http://localhost:54321'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SENHA = 'teste1234'
rmSync(destino, { recursive: true, force: true }) // capturas antigas não podem sobrar no manual
mkdirSync(destino, { recursive: true })

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--lang=pt-BR'] })
const problemas = []
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function novaPagina(tipo) {
  const contexto = await navegador.createBrowserContext()
  await contexto.overridePermissions(BASE, ['geolocation', 'clipboard-read', 'clipboard-write'])
  const p = await contexto.newPage()
  await p.setViewport(tipo === 'celular' ? { width: 390, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1360, height: 860, deviceScaleFactor: 1.5 })
  await p.setGeolocation({ latitude: -23.5612, longitude: -46.6561 })
  await p.emulateTimezone(process.env.FUSO ?? 'America/Sao_Paulo')
  p.on('pageerror', (e) => problemas.push(`exceção em ${p.url()}: ${e.message.slice(0, 200)}`))
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|realtime|favicon|tile\.openstreetmap/.test(m.text()) && problemas.push(`console em ${p.url()}: ${m.text().slice(0, 200)}`))
  p.on('response', (r) => r.url().startsWith(API) && r.status() >= 400 && !/realtime/.test(r.url()) && problemas.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '').slice(0, 120)}`))
  p.on('dialog', (d) => d.accept())
  return p
}

const ir = async (p, rota, espera = 900) => {
  await p.goto(BASE + rota, { waitUntil: 'networkidle2', timeout: 40000 })
  await dormir(espera)
}
async function foto(p, nome, { inteira = false } = {}) {
  await p.evaluate(() => document.fonts.ready)
  await dormir(250)
  await p.screenshot({ path: join(destino, `${nome}.jpg`), type: 'jpeg', quality: 86, fullPage: inteira })
  console.log('  ✓', nome)
}
/** Clica no primeiro elemento visível cujo texto contém o trecho. */
async function clicar(p, trecho, seletor = 'button, a, [role=tab], summary, label') {
  const ok = await p.evaluate((trecho, seletor) => {
    const visivel = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'
    const alvo = [...document.querySelectorAll(seletor)].filter(visivel).find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().includes(trecho))
    alvo?.scrollIntoView({ block: 'center' })
    alvo?.click()
    return Boolean(alvo)
  }, trecho, seletor)
  if (!ok) problemas.push(`não achei "${trecho}" em ${p.url()}`)
  await dormir(700)
  return ok
}
/** Preenche o campo cujo rótulo (ou aria-label/placeholder) começa com o texto. */
async function preencher(p, rotulo, valor) {
  const campo = await p.evaluateHandle((rotulo) => {
    const visivel = (e) => e.offsetParent !== null
    const porRotulo = [...document.querySelectorAll('label')].filter(visivel).find((l) => l.innerText.trim().startsWith(rotulo))?.querySelector('input, select, textarea')
    return porRotulo ?? [...document.querySelectorAll('input, select, textarea')].filter(visivel).find((e) => (e.getAttribute('aria-label') ?? e.placeholder ?? '').startsWith(rotulo)) ?? null
  }, rotulo)
  const el = campo.asElement()
  if (!el) return void problemas.push(`campo "${rotulo}" não encontrado em ${p.url()}`)
  if ((await el.evaluate((e) => e.tagName)) === 'SELECT') {
    const v = await el.evaluate((e, valor) => [...e.options].find((o) => o.text.includes(valor) || o.value === valor)?.value, valor)
    await el.select(v ?? valor)
  } else {
    await el.click({ clickCount: 3 })
    await p.keyboard.press('Backspace')
    await el.type(String(valor), { delay: 8 })
  }
  await dormir(150)
}
/** Campos de data: define o valor direto (digitar dia/mês/ano depende do idioma do navegador). */
async function definirData(p, rotulo, diasAtras) {
  await p.evaluate((rotulo, diasAtras) => {
    const d = new Date(); d.setDate(d.getDate() - diasAtras)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const campo = [...document.querySelectorAll('input[type=date]')].find((e) => e.offsetParent !== null && e.getAttribute('aria-label') === rotulo)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, iso)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  }, rotulo, diasAtras)
  await dormir(1500)
}
const entrar = async (p, rota, email) => {
  await ir(p, rota)
  await p.type('input[type=email]', email)
  await p.type('input[type=password]', SENHA)
  await Promise.all([p.click('button[type=submit]'), dormir(2500)])
}
const fecharModal = async (p) => { await p.keyboard.press('Escape'); await dormir(400) }
const topo = (p) => p.evaluate(() => window.scrollTo(0, 0))

// acesso direto à API do ambiente de teste, para preparar situações (ex.: achar o pedido que está na rua)
const tokenAdmin = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dona@teste.local', password: SENHA }) })).json()).access_token
const api = async (caminho, opcoes = {}) => (await fetch(`${API}/rest/v1/${caminho}`, { ...opcoes, headers: { authorization: `Bearer ${tokenAdmin}`, 'content-type': 'application/json', prefer: 'return=representation', ...opcoes.headers } })).text().then((t) => (t ? JSON.parse(t) : null))
const modoEntrega = (modo) => api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ modo_entrega: modo }), headers: { prefer: 'return=minimal' } })
await modoEntrega('bairro')

// =====================================================================================
console.log('Site do cliente')
const celular = await novaPagina('celular')
const pc = await novaPagina('desktop')

await ir(pc, '/')
await foto(pc, 'site-inicio')
await ir(celular, '/')
await foto(celular, 'site-inicio-celular')
await ir(pc, '/cardapio')
await foto(pc, 'site-cardapio')
await ir(celular, '/cardapio')
await foto(celular, 'site-cardapio-celular')

await clicar(celular, 'Calabresa', 'button')
await foto(celular, 'site-produto')
await clicar(celular, '2 sabores', 'button')
await preencher(celular, 'Sabor 2', 'Frango com Catupiry')
await clicar(celular, 'Catupiry', '[role=dialog] button')
await celular.evaluate(() => document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo(0, 330))
await foto(celular, 'site-produto-sabores')
await celular.evaluate(() => { const d = document.querySelector('[role=dialog] details'); if (d) { d.open = true; d.scrollIntoView() } })
await foto(celular, 'site-produto-nutricional')
await clicar(celular, 'Adicionar ·', 'button')
await clicar(celular, 'Coca-Cola 2L', 'button')
await clicar(celular, 'Adicionar ·', 'button')
await topo(celular)
await clicar(celular, 'Ver sacola', 'button')
await foto(celular, 'site-sacola')
await clicar(celular, 'Finalizar pedido', 'button')
await dormir(800)

// finalização (entrega por bairro)
await preencher(celular, 'Nome', 'Mariana Alves')
await preencher(celular, 'WhatsApp', '11970000000')
await preencher(celular, 'Rua / avenida', 'Rua Augusta')
await preencher(celular, 'Número', '100')
await preencher(celular, 'Bairro', 'Centro')
await preencher(celular, 'Cupom de desconto', 'BEMVINDO10')
await clicar(celular, 'Aplicar', 'button')
await topo(celular)
await foto(celular, 'site-checkout-celular')
await clicar(celular, 'Enviar pedido', 'button')
await dormir(2000)
const codigoNovo = new URL(celular.url()).searchParams.get('c')
await foto(celular, 'site-acompanhar')
await celular.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.innerText.includes('Pix'))?.scrollIntoView({ block: 'start' }))
await celular.evaluate(() => window.scrollBy(0, -130))
await foto(celular, 'site-acompanhar-pix')

// a mesma tela no computador, para mostrar o resumo ao lado
await ir(pc, '/cardapio')
await clicar(pc, 'Tia Cê', 'main button')
await clicar(pc, 'Adicionar ·', 'button')
await ir(pc, '/checkout')
await preencher(pc, 'Nome', 'Lucas Martins')
await preencher(pc, 'WhatsApp', '11971000000')
await preencher(pc, 'Rua / avenida', 'Alameda Santos')
await preencher(pc, 'Número', '455')
await preencher(pc, 'Bairro', 'Centro')
await clicar(pc, 'Dinheiro', 'button')
await preencher(pc, 'Troco para quanto?', '100')
await topo(pc)
await foto(pc, 'site-checkout', { inteira: true })

// pedido que está na rua: acompanhamento com o mapa do motoboy
const naRua = (await api('pedidos?select=codigo,numero&status=eq.saiu_entrega&limit=1'))[0]
await ir(celular, `/pedido?c=${naRua.codigo}`, 3500)
await foto(celular, 'site-acompanhar-mapa')
const comProblema = (await api('pedidos?select=codigo&status=eq.problema_entrega&limit=1'))[0]
await ir(celular, `/pedido?c=${comProblema.codigo}`, 1200)
await foto(celular, 'site-acompanhar-problema')

// conta do cliente
await ir(celular, '/entrar')
await foto(celular, 'site-entrar')
await clicar(celular, 'Continuar com Google', 'button')
await dormir(2500)
await foto(celular, 'site-conta-celular')

// =====================================================================================
console.log('Painel da equipe')
await ir(pc, '/admin')
await foto(pc, 'painel-login')
await entrar(pc, '/admin', 'dona@teste.local')

await ir(pc, '/admin/pedidos', 1500)
await foto(pc, 'painel-pedidos')
// aceita o pedido que acabou de chegar pelo site e abre os detalhes
const novo = (await api(`pedidos?select=id,numero&codigo=eq.${codigoNovo}`))[0]
await pc.evaluate((numero) => {
  const cartao = [...document.querySelectorAll('article')].find((a) => a.innerText.includes(`#${numero}`))
  ;[...cartao.querySelectorAll('button')].find((b) => b.innerText.includes('Aceitar')).click()
}, novo.numero)
await dormir(1800)
await pc.evaluate((numero) => [...document.querySelectorAll('article')].find((a) => a.innerText.includes(`#${numero}`)).querySelector('button').click(), novo.numero)
await dormir(1200)
await clicar(pc, 'Confirmar pagamento', '[role=dialog] button')
await dormir(900)
await pc.evaluate(() => document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo(0, 0))
await foto(pc, 'painel-pedido-detalhe')
await clicar(pc, 'Cancelar', '[role=dialog] footer button')
await foto(pc, 'painel-pedido-cancelar')
await fecharModal(pc)
await fecharModal(pc)
await clicar(pc, 'Histórico', '[role=tab]')
await definirData(pc, 'De', 2)
await foto(pc, 'painel-pedidos-historico')

await ir(pc, '/admin/pdv', 1200)
await clicar(pc, 'Entrega', 'form button')
await preencher(pc, 'Telefone', '11970000000')
await pc.keyboard.press('Tab')
await dormir(1200)
await clicar(pc, 'Quatro Queijos', 'form button')
await clicar(pc, '2 sabores', 'button')
await preencher(pc, 'Sabor 2', 'Portuguesa')
await clicar(pc, 'Adicionar ·', 'button')
await clicar(pc, 'Guaraná Antarctica 2L', 'form button')
await clicar(pc, 'Adicionar ·', 'button')
await preencher(pc, 'Bairro', 'Centro')
await topo(pc)
await foto(pc, 'painel-pdv')

await ir(pc, '/admin/cozinha', 1200)
await foto(pc, 'painel-cozinha')

await ir(pc, '/admin/clientes', 1200)
await foto(pc, 'painel-clientes')
await pc.evaluate(() => document.querySelector('tbody tr').click())
await dormir(1500)
await pc.evaluate(() => document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo(0, 330))
await foto(pc, 'painel-cliente-ficha')
await fecharModal(pc)

await ir(pc, '/admin/cardapio', 1200)
await foto(pc, 'painel-cardapio')
await pc.evaluate(() => [...document.querySelectorAll('li')].find((l) => l.innerText.startsWith('Calabresa')).querySelector('[aria-label=Editar]').click())
await dormir(900)
await foto(pc, 'painel-produto')
await pc.evaluate(() => { document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo(0, 9999) })
await foto(pc, 'painel-produto-nutricional')
await fecharModal(pc)
await pc.evaluate(() => [...document.querySelectorAll('li')].find((l) => l.innerText.startsWith('Calabresa')).querySelector('[aria-label="Ficha técnica"]').click())
await dormir(1200)
await foto(pc, 'painel-ficha-tecnica')
await fecharModal(pc)
await clicar(pc, 'Tamanhos de pizza', '[role=tab]')
await foto(pc, 'painel-cardapio-tamanhos')
await clicar(pc, 'Bordas e adicionais', '[role=tab]')
await foto(pc, 'painel-cardapio-adicionais')

await ir(pc, '/admin/conteudo', 1200)
await foto(pc, 'painel-site-inicio', { inteira: true })
await clicar(pc, 'Banners', '[role=tab]')
await clicar(pc, 'Pré-visualizar', 'summary')
await foto(pc, 'painel-site-banners')
await pc.evaluate(() => document.querySelector('tbody [aria-label=Editar]').click())
await dormir(800)
await foto(pc, 'painel-site-banner-form')
await fecharModal(pc)
await clicar(pc, 'Promoções', '[role=tab]')
await foto(pc, 'painel-site-promocoes')
await pc.evaluate(() => document.querySelector('tbody [aria-label=Editar]').click())
await dormir(800)
await foto(pc, 'painel-site-promocao-form')
await fecharModal(pc)
await clicar(pc, 'Cupons', '[role=tab]')
await foto(pc, 'painel-site-cupons')
await clicar(pc, 'Tela do produto', '[role=tab]')
await foto(pc, 'painel-site-produto')

await ir(pc, '/admin/estoque', 1200)
await foto(pc, 'painel-estoque')
await clicar(pc, 'Entrada', 'tbody button')
await preencher(pc, 'Quantidade', '10')
await preencher(pc, 'Custo por', '42,50')
await foto(pc, 'painel-estoque-entrada')
await fecharModal(pc)
await clicar(pc, 'Movimentações', '[role=tab]')
await dormir(600)
await foto(pc, 'painel-estoque-movimentos')

await ir(pc, '/admin/caixa', 1500)
await foto(pc, 'painel-caixa')
await clicar(pc, 'Sangria', 'button')
await preencher(pc, 'Valor', '80')
await preencher(pc, 'Motivo', 'Pagamento do gás')
await foto(pc, 'painel-caixa-sangria')
await fecharModal(pc)
await clicar(pc, 'Fechar caixa', 'button')
await preencher(pc, 'Dinheiro contado', '85')
await foto(pc, 'painel-caixa-fechar')
await fecharModal(pc)

await ir(pc, '/admin/entregas', 1200)
await foto(pc, 'painel-entregas-bairro')
await clicar(pc, 'Por distância', 'button')
await dormir(4500)
await foto(pc, 'painel-entregas-distancia')
await clicar(pc, 'Entregadores', '[role=tab]')
await foto(pc, 'painel-entregadores')
await clicar(pc, 'Acerto de entregas', '[role=tab]')
await clicar(pc, 'Mês', 'button')
await dormir(1200)
await foto(pc, 'painel-entregas-acerto')

// com a entrega por distância ligada: a finalização do cliente mostra o mapa
const cliente2 = await novaPagina('desktop')
await ir(cliente2, '/cardapio')
await clicar(cliente2, 'Mussarela', 'main button')
await clicar(cliente2, 'Adicionar ·', 'button')
await ir(cliente2, '/checkout')
await preencher(cliente2, 'Nome', 'Fernanda Costa')
await preencher(cliente2, 'WhatsApp', '11972000000')
await preencher(cliente2, 'Rua / avenida', 'Rua Augusta')
await preencher(cliente2, 'Número', '1500')
await cliente2.keyboard.press('Tab')
await dormir(6000)
if (!(await cliente2.evaluate(() => document.body.innerText.includes('Entregamos aí')))) {
  await clicar(cliente2, 'Marcar manualmente', 'button')
  await dormir(3000)
}
await cliente2.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.innerText.includes('Endereço'))?.scrollIntoView())
await dormir(1500)
await foto(cliente2, 'site-checkout-distancia')
await modoEntrega('bairro')

await ir(pc, '/admin/financeiro', 1500)
await clicar(pc, '30 dias', 'button')
await dormir(1500)
await foto(pc, 'painel-financeiro-resumo', { inteira: true })
await clicar(pc, 'Faturamento por período', '[role=tab]')
await foto(pc, 'painel-financeiro-periodo')
await clicar(pc, 'Entradas', '[role=tab]')
await foto(pc, 'painel-financeiro-entradas')
await clicar(pc, 'Saídas (despesas)', '[role=tab]')
await foto(pc, 'painel-financeiro-saidas')
await clicar(pc, 'Nova despesa', 'button')
await preencher(pc, 'Descrição', 'Conta de luz')
await preencher(pc, 'Valor', '684.30')
await preencher(pc, 'Categoria', 'Energia')
await foto(pc, 'painel-financeiro-despesa')
await fecharModal(pc)

await ir(pc, '/admin/painel', 1800)
await clicar(pc, '30 dias', 'button')
await dormir(1500)
await foto(pc, 'painel-indicadores')
await pc.evaluate(() => window.scrollTo(0, [...document.querySelectorAll('h2')].find((h) => h.innerText.includes('Pedidos por horário')).getBoundingClientRect().top + window.scrollY - 40))
await dormir(500)
await foto(pc, 'painel-indicadores-graficos')

await ir(pc, '/admin/analises', 1500)
await clicar(pc, '30 dias', 'button')
await dormir(1200)
await foto(pc, 'painel-analises-produtos')
await clicar(pc, 'Clientes', '[role=tab]')
await dormir(900)
await foto(pc, 'painel-analises-clientes')
await pc.evaluate(() => document.querySelector('tbody tr').click())
await dormir(1300)
await foto(pc, 'painel-analises-cliente')
await fecharModal(pc)

await ir(pc, '/admin/fiscal', 1200)
await clicar(pc, 'Configuração', '[role=tab]')
await foto(pc, 'painel-fiscal')

await ir(pc, '/admin/auditoria', 1500)
await foto(pc, 'painel-auditoria')

await ir(pc, '/admin/configuracoes', 1200)
await foto(pc, 'painel-config-loja')
for (const [aba, nome] of [['Horários', 'horarios'], ['Pedidos', 'pedidos'], ['Metas e indicadores', 'metas'], ['Impressão', 'impressao'], ['Financeiro', 'financeiro'], ['Usuários', 'usuarios'], ['Permissões', 'permissoes'], ['Sistema', 'sistema']]) {
  await clicar(pc, aba, '[role=tab]')
  await dormir(500)
  await foto(pc, `painel-config-${nome}`, { inteira: nome === 'pedidos' || nome === 'permissoes' })
}
await clicar(pc, 'Usuários', '[role=tab]')
await clicar(pc, 'Novo usuário', 'button')
await preencher(pc, 'Nome', 'João Motoboy')
await preencher(pc, 'E-mail', 'joao@teste.local')
await preencher(pc, 'Função', 'Motoboy')
await foto(pc, 'painel-config-usuario-novo')
await fecharModal(pc)

// o que cada função enxerga: a atendente tem menos itens no menu
const atendente = await novaPagina('desktop')
await entrar(atendente, '/admin', 'ana@teste.local')
await foto(atendente, 'painel-menu-atendente')

// =====================================================================================
console.log('Aplicativo do motoboy')
const moto = await novaPagina('celular')
await entrar(moto, '/entregador', 'carlos@teste.local')
await dormir(1500)
await foto(moto, 'motoboy-entregas')
await moto.evaluate(() => [...document.querySelectorAll('article')].find((a) => a.innerText.includes('Saiu para entrega'))?.scrollIntoView({ block: 'start' }))
await moto.evaluate(() => window.scrollBy(0, -110))
await foto(moto, 'motoboy-entrega-na-rua')
await clicar(moto, 'Tive um problema', 'button')
await clicar(moto, 'Cliente não atende', '[role=dialog] button')
await foto(moto, 'motoboy-problema')
await fecharModal(moto)

await navegador.close()
console.log(problemas.length ? `\n${problemas.length} ponto(s) de atenção:\n` + [...new Set(problemas)].join('\n') : '\nCapturas concluídas sem erros.')
