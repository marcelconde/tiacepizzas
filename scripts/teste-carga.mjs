// Teste de carga: várias pessoas ao mesmo tempo no site, cada uma fazendo uma coisa — olhando o cardápio, fazendo
// pedido ou acompanhando o pedido — pelas mesmas chamadas que o site faz. Mede o tempo de resposta e os erros.
//
//   node scripts/teste-carga.mjs --pessoas 50 --minutos 2           site e banco publicados: PEDIDOS DE VERDADE
//   node scripts/teste-carga.mjs --pessoas 20 --minutos 1 --local   ambiente local (com "npm run dev:demo" rodando)
//   --intenso                                                       cada pessoa age a cada 2 a 5 s (estresse, não uso real)
//   --todos-pedem                                                   todas as pessoas fazem pedido e depois ficam navegando
//                                                                   (acompanham o pedido e voltam ao cardápio) até o fim
//   --navegadores 25                                                além das chamadas, 25 navegadores de verdade em rodízio
//                                                                   abrindo o site, o cardápio, um produto e o acompanhamento:
//                                                                   são as visitas que aparecem no Cloudflare Web Analytics
//
// Divisão: 40% olham o cardápio (uma visita nova a cada 20 a 40 s), 40% fazem um pedido e depois acompanham,
// 20% só acompanham pedidos já feitos. Os pedidos saem como RETIRADA, em nome de "Teste de carga NN", com a
// observação "TESTE DE CARGA": aparecem no quadro de Pedidos, com o som de pedido novo, e devem ser cancelados depois.
// Antes de rodar no site publicado: a loja precisa estar aberta (Configurações → Horários → Forçar aberta agora) e
// o banco recusa mais de 40 pedidos do site em 10 minutos (freio contra abuso) — com 100 pessoas, são 40 pedidos.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`)
  return i < 0 ? padrao : (process.argv[i + 1] ?? padrao)
}
const PESSOAS = Number(arg('pessoas', 50))
const MINUTOS = Number(arg('minutos', 2))
const LOCAL = process.argv.includes('--local')
const INTENSO = process.argv.includes('--intenso')
const TODOS_PEDEM = process.argv.includes('--todos-pedem')
const NAVEGADORES = Number(arg('navegadores', 0))
const env = Object.fromEntries(readFileSync(new URL('../.env.production', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((x) => x.trim())))
const SITE = LOCAL ? 'http://localhost:5173' : 'https://tiacepizzas.com.br'
const API = LOCAL ? 'http://localhost:54321' : env.VITE_SUPABASE_URL
const CHAVE = LOCAL ? 'local' : env.VITE_SUPABASE_ANON_KEY
// as mesmas colunas que o site lê da configuração (o visitante não pode ler as internas)
const CONFIG = readFileSync(new URL('../src/lib/loja.tsx', import.meta.url), 'utf8').match(/const CONFIG_PUBLICA =\s*'([^']+)'/)[1].replace(/\s/g, '')

// ------------------------------------------------------------------ medição
const medidas = new Map() // rótulo → { ms: [], erros: 0, motivos: Map }
async function medir(rotulo, fazer) {
  const m = medidas.get(rotulo) ?? { ms: [], erros: 0, motivos: new Map() }
  medidas.set(rotulo, m)
  const t0 = performance.now()
  try {
    const r = await fazer()
    const corpo = await r.text()
    m.ms.push(performance.now() - t0)
    if (!r.ok) {
      m.erros++
      const motivo = `${r.status} ${(corpo.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? corpo).slice(0, 90)}`
      m.motivos.set(motivo, (m.motivos.get(motivo) ?? 0) + 1)
      return null
    }
    return corpo
  } catch (e) {
    m.ms.push(performance.now() - t0)
    m.erros++
    const motivo = e.name === 'TimeoutError' ? 'sem resposta em 20 s' : e.message.slice(0, 90)
    m.motivos.set(motivo, (m.motivos.get(motivo) ?? 0) + 1)
    return null
  }
}
function registrar(rotulo, tempo, erro) {
  const m = medidas.get(rotulo) ?? { ms: [], erros: 0, motivos: new Map() }
  medidas.set(rotulo, m)
  m.ms.push(tempo)
  if (erro) {
    m.erros++
    m.motivos.set(erro, (m.motivos.get(erro) ?? 0) + 1)
  }
}
const limite = () => AbortSignal.timeout(20_000)
const banco = (caminho) => fetch(`${API}/rest/v1/${caminho}`, { headers: { apikey: CHAVE }, signal: limite() })
const rpc = (nome, corpo = {}) => fetch(`${API}/rest/v1/rpc/${nome}`, { method: 'POST', headers: { apikey: CHAVE, 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: limite() })
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const entre = (a, b) => a + Math.random() * (b - a)

// ------------------------------------------------------------------ o que uma visita ao site carrega
let arquivos = []
const CONSULTAS = [
  ['configuração', () => banco(`configuracoes?select=${CONFIG}`)],
  ['página inicial', () => banco('site_conteudo?select=dados')],
  ['categorias', () => banco('categorias?select=*&ativo=eq.true&order=ordem')],
  ['tamanhos', () => banco('tamanhos?select=*&ativo=eq.true&order=ordem')],
  ['cardápio', () => banco('produtos?select=*,produto_precos(tamanho_id,preco)&ativo=eq.true&order=ordem,nome')],
  ['adicionais', () => banco('adicionais?select=*&ativo=eq.true&order=ordem')],
  ['bairros', () => banco('bairros?select=*&ativo=eq.true&order=nome')],
  ['faixas de entrega', () => banco('faixas_entrega?select=*&ativo=eq.true&order=ate_km')],
  ['banners', () => banco('banners?select=*&ativo=eq.true&order=ordem')],
  ['promoções', () => rpc('promocoes_vigentes')],
  ['loja aberta?', () => rpc('loja_aberta')],
]
async function visita() {
  await medir('site: página', () => fetch(`${SITE}/`, { signal: limite() }))
  await Promise.all(arquivos.map((a) => medir('site: arquivos (js/css)', () => fetch(`${SITE}${a}`, { signal: limite() }))))
  await Promise.all(CONSULTAS.map(([rotulo, fazer]) => medir(`banco: ${rotulo}`, fazer)))
}

// ------------------------------------------------------------------ as três pessoas
const fim = Date.now() + MINUTOS * 60_000
const codigos = [] // pedidos feitos neste teste, para quem só acompanha
const pedidos = { feitos: 0, recusados: new Map() }
const rodada = String(Date.now() % 1000).padStart(3, '0')
let itensValidos = null

async function olhar() {
  while (Date.now() < fim) {
    await visita()
    await dormir(INTENSO ? entre(2_000, 5_000) : entre(20_000, 40_000))
  }
}

async function acompanhar(codigo) {
  while (Date.now() < fim) {
    await medir('banco: acompanhar pedido', () => rpc('acompanhar_pedido', { p_codigo: codigo }))
    await dormir(INTENSO ? 3_000 : 15_000) // 15 s é o intervalo da tela de acompanhamento
  }
}

async function pedir(n) {
  await visita()
  await dormir(INTENSO ? entre(1_000, 3_000) : entre(5_000, 20_000)) // escolhendo
  const p = {
    chave: randomUUID(),
    tipo: 'retirada',
    cliente: { nome: `Teste de carga ${String(n).padStart(2, '0')}`, telefone: `119${rodada}${String(n).padStart(5, '0')}` },
    itens: itensValidos,
    forma_pagamento: 'pix',
    cpf_nota: '',
    observacoes: 'TESTE DE CARGA — pode cancelar',
  }
  const t0 = performance.now()
  const r = await fetch(`${API}/rest/v1/rpc/criar_pedido`, { method: 'POST', headers: { apikey: CHAVE, 'content-type': 'application/json' }, body: JSON.stringify({ p }), signal: limite() }).catch((e) => e)
  const m = medidas.get('banco: criar pedido') ?? { ms: [], erros: 0, motivos: new Map() }
  medidas.set('banco: criar pedido', m)
  m.ms.push(performance.now() - t0)
  const corpo = r instanceof Response ? await r.json().catch(() => ({})) : { message: r.message }
  if (r instanceof Response && r.ok && corpo.codigo) {
    pedidos.feitos++
    codigos.push(corpo.codigo)
    await (TODOS_PEDEM ? navegarDepois(corpo.codigo) : acompanhar(corpo.codigo))
  } else {
    m.erros++
    const motivo = corpo.message ?? `HTTP ${r.status}`
    pedidos.recusados.set(motivo, (pedidos.recusados.get(motivo) ?? 0) + 1)
  }
}

/** Depois do pedido: confere o andamento como a tela faz e, de vez em quando, volta ao cardápio (uma visita nova). */
async function navegarDepois(codigo) {
  for (let i = 0; Date.now() < fim; i++) {
    await medir('banco: acompanhar pedido', () => rpc('acompanhar_pedido', { p_codigo: codigo }))
    if (i % 2 === 1) await visita()
    await dormir(INTENSO ? 3_000 : entre(10_000, 20_000))
  }
}

/**
 * Navegadores de verdade (Chrome sem janela) em rodízio: cada visitante abre o site, vai ao cardápio, abre um
 * produto e, se já houver pedido de teste, a tela de acompanhamento; depois fecha e outro chega. Só eles executam
 * o site como um celular faz — e só eles aparecem no Cloudflare Web Analytics. Fotos e fontes não são baixadas,
 * para não gastar a cota de tráfego do banco de fotos.
 */
async function visitantesReais() {
  if (!NAVEGADORES) return 0
  const { default: puppeteer } = await import('puppeteer-core')
  const { CHROME } = await import('./plataforma.mjs')
  const nav = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--disable-gpu', '--mute-audio'] })
  const versao = (await nav.version()).replace(/^HeadlessChrome\//, '').replace(/^Chrome\//, '')
  // agente de navegador comum (o "HeadlessChrome" faria o Cloudflare tratar a visita como robô)
  const AGENTES = [
    `Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versao} Mobile Safari/537.36`,
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versao} Safari/537.36`,
  ]
  let visitas = 0
  const visitante = async (n) => {
    while (Date.now() < fim) {
      const ctx = await nav.createBrowserContext()
      const celular = (n + visitas) % 3 !== 0
      try {
        const p = await ctx.newPage()
        await p.setUserAgent(AGENTES[celular ? 0 : 1])
        await p.setViewport(celular ? { width: 390, height: 800, isMobile: true, hasTouch: true } : { width: 1366, height: 800 })
        await p.setRequestInterception(true)
        p.on('request', (r) => (['image', 'font', 'media'].includes(r.resourceType()) || /tile\.openstreetmap/.test(r.url()) ? r.abort() : r.continue()))
        const t0 = performance.now()
        await p.goto(`${SITE}/`, { waitUntil: 'networkidle2', timeout: 30_000 })
        registrar('navegador: abrir o site', performance.now() - t0)
        await dormir(entre(2_000, 4_000))
        await p.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/cardapio')?.click())
        await dormir(entre(2_000, 4_000))
        await p.evaluate(() => document.querySelector('main button')?.click()) // abre um produto
        await dormir(entre(1_500, 3_000))
        await p.keyboard.press('Escape')
        if (codigos.length) {
          const t1 = performance.now()
          await p.goto(`${SITE}/pedido?c=${codigos[Math.floor(Math.random() * codigos.length)]}`, { waitUntil: 'networkidle2', timeout: 30_000 })
          registrar('navegador: acompanhar pedido', performance.now() - t1)
          await dormir(entre(4_000, 8_000))
        }
        visitas++
      } catch (e) {
        registrar('navegador: abrir o site', 0, e.name === 'TimeoutError' ? 'página não carregou em 30 s' : e.message.slice(0, 90))
      } finally {
        await ctx.close().catch(() => {})
      }
    }
  }
  await Promise.all(Array.from({ length: NAVEGADORES }, (_, i) => dormir(i * 1_200).then(() => visitante(i))))
  await nav.close()
  return visitas
}

async function soAcompanhar() {
  await visita()
  while (!codigos.length && Date.now() < fim) await dormir(2_000)
  if (codigos.length) await acompanhar(codigos[Math.floor(Math.random() * codigos.length)])
}

// ------------------------------------------------------------------ preparo e disparo
const pct = (lista, p) => (lista.length ? lista.slice().sort((a, b) => a - b)[Math.min(lista.length - 1, Math.floor((p / 100) * lista.length))] : 0)
const ms = (v) => `${Math.round(v)} ms`

async function principal() {
  console.log(`Teste de carga — ${PESSOAS} pessoas por ${MINUTOS} min em ${LOCAL ? 'ambiente local' : SITE}${INTENSO ? ' (ritmo intenso)' : ''}${TODOS_PEDEM ? ', todas fazendo pedido' : ''}${NAVEGADORES ? `, + ${NAVEGADORES} navegadores de verdade` : ''}`)
  const html = await (await fetch(`${SITE}/`)).text()
  arquivos = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))]
  const aberta = await (await rpc('loja_aberta')).json()
  if (aberta !== true) console.log('ATENÇÃO: a loja está FECHADA agora; os pedidos serão recusados. Abra em Configurações → Horários → Forçar aberta agora.')
  // um pedido pequeno e válido com o cardápio de agora: uma pizza no primeiro tamanho com preço e uma bebida
  const [cats, prods] = await Promise.all([(await banco('categorias?select=id,usa_tamanhos&ativo=eq.true')).json(), (await banco('produtos?select=id,preco,categoria_id,disponivel,produto_precos(tamanho_id,preco)&ativo=eq.true')).json()])
  const pizzas = new Set(cats.filter((c) => c.usa_tamanhos).map((c) => c.id))
  const pizza = prods.find((p) => p.disponivel && pizzas.has(p.categoria_id) && p.produto_precos.length)
  const bebida = prods.find((p) => p.disponivel && !pizzas.has(p.categoria_id) && Number(p.preco) > 0)
  itensValidos = [
    ...(pizza ? [{ produto_id: pizza.id, tamanho_id: pizza.produto_precos[0].tamanho_id, sabores: [pizza.id], adicionais: [], quantidade: 1, observacoes: '' }] : []),
    ...(bebida ? [{ produto_id: bebida.id, tamanho_id: null, adicionais: [], quantidade: 1, observacoes: '' }] : []),
  ]
  if (!itensValidos.length) throw new Error('O cardápio não tem produto disponível para montar o pedido de teste.')

  const tarefas = []
  const t0 = Date.now()
  for (let i = 0; i < PESSOAS; i++) {
    const tipo = TODOS_PEDEM ? () => pedir(i + 1) : i % 5 < 2 ? olhar : i % 5 < 4 ? () => pedir(i + 1) : soAcompanhar
    // todos entram nos primeiros 5 segundos
    tarefas.push(dormir(Math.random() * 5_000).then(tipo))
  }
  const progresso = setInterval(() => {
    const total = [...medidas.values()].reduce((s, m) => s + m.ms.length, 0)
    console.log(`  ${Math.round((Date.now() - t0) / 1000)} s · ${total} chamadas · ${pedidos.feitos} pedidos feitos`)
  }, 15_000)
  const reais = visitantesReais()
  await Promise.all(tarefas)
  const visitasReais = await reais
  clearInterval(progresso)

  const duracao = (Date.now() - t0) / 1000
  const todas = [...medidas.values()].flatMap((m) => m.ms)
  const erros = [...medidas.values()].reduce((s, m) => s + m.erros, 0)
  console.log(`\nResultado (${Math.round(duracao)} s): ${todas.length} chamadas (${(todas.length / duracao).toFixed(1)} por segundo), ${erros} com erro (${((erros / Math.max(1, todas.length)) * 100).toFixed(1)}%)`)
  if (NAVEGADORES) console.log(`Visitas de navegadores de verdade (as que o Cloudflare conta): ${visitasReais}`)
  console.log(`Pedidos: ${pedidos.feitos} feitos${pedidos.recusados.size ? `, recusados: ${[...pedidos.recusados].map(([m, n]) => `${n}× "${m}"`).join('; ')}` : ''}`)
  console.log('\n' + ['o quê'.padEnd(28), 'chamadas', 'erros', 'mediana', '95% até', 'mais lenta'].join(' | '))
  for (const [rotulo, m] of [...medidas].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log([rotulo.padEnd(28), String(m.ms.length).padStart(8), String(m.erros).padStart(5), ms(pct(m.ms, 50)).padStart(7), ms(pct(m.ms, 95)).padStart(7), ms(Math.max(...m.ms)).padStart(10)].join(' | '))
    for (const [motivo, n] of m.motivos) console.log(`${''.padEnd(28)}   ${n}× ${motivo}`)
  }
  console.log(`\nGeral: mediana ${ms(pct(todas, 50))}, 95% até ${ms(pct(todas, 95))}, mais lenta ${ms(Math.max(...todas))}.`)
  if (pedidos.feitos) console.log(`Os ${pedidos.feitos} pedidos de teste estão no quadro com o nome "Teste de carga NN" e a observação "TESTE DE CARGA": cancele-os depois.`)
}

principal().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
