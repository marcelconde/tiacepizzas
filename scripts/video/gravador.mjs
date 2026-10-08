// Gravador do vídeo-tutorial: dirige o Chrome como uma pessoa usaria (cursor visível, digitação aos poucos),
// guarda os quadros da tela com o instante de cada um, gera a narração com a voz do macOS e escreve o
// manifesto que o montar.swift transforma em MP4. Não depende de ffmpeg.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// O vídeo sai em 1920×1080: a tela gravada em cima e uma faixa de legenda embaixo.
export const LARGURA = 1920, ALTURA = 1080, FAIXA = 96
const ESCALA = 1.5
export const TELA_PC = { width: LARGURA / ESCALA, height: (ALTURA - FAIXA) / ESCALA }
export const TELA_CELULAR = { width: 390, height: (ALTURA - FAIXA) / ESCALA }
const telas = new WeakMap() // página → { cdp, width, height }
const TAXA = 22050 // Hz da narração
const VOZ = process.env.VOZ ?? 'Luciana'
const RITMO = process.env.RITMO ?? '182' // palavras por minuto

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const g = { pasta: '', vozes: '', t0: 0, pausado: 0, pausaDesde: null, quadros: [], legendas: [], falas: [], n: 0, alvo: null, ultimo: null, laco: null, emCurso: null, fim: false, sessoes: new Map(), problemas: [] }
export const problemas = g.problemas
const agora = () => (g.t0 ? ((g.pausaDesde ?? performance.now()) - g.t0 - g.pausado) / 1000 : 0)

export function iniciar(pasta) {
  g.pasta = pasta
  g.vozes = join(pasta, '..', 'vozes') // a narração já gerada fica guardada entre uma gravação e outra
  rmSync(pasta, { recursive: true, force: true })
  mkdirSync(pasta, { recursive: true })
  mkdirSync(g.vozes, { recursive: true })
}

// A tela é fotografada várias vezes por segundo; fotos iguais à anterior são descartadas.
// Para as fotos saírem na resolução cheia, o Chrome é aberto com a escala 1,5 de verdade
// (--force-device-scale-factor): com a escala só emulada, a foto vem reduzida ou exige um recorte
// que falha quando a página rola. E page.screenshot() do puppeteer atrapalha os cliques em andamento.
function guardar(dados, t) {
  if (g.pausaDesde != null || dados === g.ultimo) return
  g.ultimo = dados
  const arquivo = `q${String(++g.n).padStart(6, '0')}.jpg`
  writeFileSync(join(g.pasta, arquivo), Buffer.from(dados, 'base64'))
  g.quadros.push({ t: Number(t.toFixed(3)), arquivo })
}
// Uma foto pedida bem na hora em que a página troca pode nunca voltar: por isso o limite de tempo
// (sem ele, a gravação ficava parada até a próxima troca de página).
const fotografar = (alvo) =>
  (g.emCurso = Promise.race([
    alvo.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 84 }).then((r) => r.data, () => null),
    new Promise((r) => setTimeout(r, 2500, null)),
  ]))
async function quadroAgora() {
  const alvo = g.alvo
  if (!alvo) return
  const t = agora()
  const dados = await fotografar(alvo)
  if (dados && g.alvo === alvo) guardar(dados, t)
}
async function laco() {
  while (!g.fim) {
    const alvo = g.alvo
    if (!alvo || g.pausaDesde != null) {
      await dormir(30)
      continue
    }
    const inicio = performance.now()
    const t = agora()
    const dados = await fotografar(alvo)
    if (dados && g.alvo === alvo) guardar(dados, t)
    await dormir(Math.max(8, 84 - (performance.now() - inicio))) // ~12 quadros por segundo
  }
}

/** Passa a gravar esta página (uma por vez). */
export async function gravar(pagina) {
  let alvo = g.sessoes.get(pagina)
  if (!alvo) {
    alvo = { cdp: telas.get(pagina).cdp }
    g.sessoes.set(pagina, alvo)
  }
  await pagina.bringToFront()
  if (!g.t0) g.t0 = performance.now() // o vídeo começa na primeira tela gravada
  g.ultimo = null
  g.alvo = alvo
  if (!g.laco) g.laco = laco()
  await quadroAgora()
}
/** O relógio do vídeo para (carregamentos demorados, geração de voz) e volta sem deixar buraco. */
export async function pausar() {
  if (g.pausaDesde == null) g.pausaDesde = performance.now()
  await g.emCurso // deixa a foto em andamento terminar antes de mexer na página
}
export async function retomar() {
  if (g.pausaDesde == null) return
  g.pausado += performance.now() - g.pausaDesde
  g.pausaDesde = null
  await quadroAgora()
}
/** Faz algo fora do vídeo (preparar dados, carregar uma página): o espectador só vê o resultado. */
export async function foraDoVideo(acao) {
  await pausar()
  try {
    return await acao()
  } finally {
    await retomar()
  }
}

// ------------------------------------------------------------------ narração e legendas
function voz(texto) {
  const arquivo = join(g.vozes, createHash('sha1').update(`${VOZ}|${RITMO}|${texto}`).digest('hex').slice(0, 16) + '.wav')
  if (!existsSync(arquivo)) execFileSync('say', ['-v', VOZ, '-r', RITMO, `--data-format=LEI16@${TAXA}`, '-o', arquivo, texto])
  const b = readFileSync(arquivo)
  let i = 12 // pula "RIFF....WAVE" e procura o bloco de dados
  while (i < b.length - 8 && b.toString('latin1', i, i + 4) !== 'data') i += 8 + b.readUInt32LE(i + 4)
  const pcm = b.subarray(i + 8, i + 8 + b.readUInt32LE(i + 4))
  return { pcm, dur: pcm.length / 2 / TAXA }
}
function legendar(texto, inicio, dur) {
  // pedaços de até ~150 letras (cabem em duas linhas), cada um na tela pelo tempo proporcional ao tamanho
  const pedacos = []
  let atual = ''
  for (const palavra of texto.split(/\s+/)) {
    if (atual && (atual + ' ' + palavra).length > 150) {
      pedacos.push(atual)
      atual = palavra
    } else atual = atual ? atual + ' ' + palavra : palavra
    if (/[.!?:]$/.test(palavra) && atual.length > 90) {
      pedacos.push(atual)
      atual = ''
    }
  }
  if (atual) pedacos.push(atual)
  const total = pedacos.reduce((s, p) => s + p.length, 0)
  let t = inicio
  for (const p of pedacos) {
    const d = (dur * p.length) / total
    g.legendas.push({ inicio: Number(t.toFixed(3)), fim: Number((t + d).toFixed(3)), texto: p })
    t += d
  }
  g.legendas.at(-1).fim = Number((inicio + dur + 0.25).toFixed(3))
}

/**
 * Uma fala do vídeo: narra o texto (que também vira legenda) enquanto a ação acontece na tela.
 * `fala` troca só o que é dito, para siglas que a voz leria mal.
 */
export async function cena(texto, acao, { fala, depois = 0.45 } = {}) {
  await pausar()
  const v = voz(fala ?? texto)
  await retomar()
  const inicio = agora()
  g.falas.push({ inicio, pcm: v.pcm })
  legendar(texto, inicio, v.dur)
  if (acao) {
    try {
      await acao()
    } catch (e) {
      g.problemas.push(`"${texto.slice(0, 50)}…": ${e.message.split('\n')[0]}`)
    }
  }
  const resta = inicio + v.dur + depois - agora()
  if (resta > 0) await dormir(resta * 1000)
}

export async function encerrar() {
  await dormir(600)
  await quadroAgora()
  const duracao = Number((agora() + 0.4).toFixed(3))
  g.fim = true
  await g.laco
  // a narração inteira numa trilha só, cada fala no seu instante
  const trilha = Buffer.alloc(Math.ceil(duracao * TAXA) * 2)
  for (const f of g.falas) f.pcm.copy(trilha, Math.round(f.inicio * TAXA) * 2, 0, Math.min(f.pcm.length, trilha.length - Math.round(f.inicio * TAXA) * 2))
  const cab = Buffer.alloc(44)
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + trilha.length, 4); cab.write('WAVEfmt ', 8); cab.writeUInt32LE(16, 16)
  cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22); cab.writeUInt32LE(TAXA, 24); cab.writeUInt32LE(TAXA * 2, 28)
  cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34); cab.write('data', 36); cab.writeUInt32LE(trilha.length, 40)
  writeFileSync(join(g.pasta, 'narracao.wav'), Buffer.concat([cab, trilha]))
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac@44100', '-b', '64000', join(g.pasta, 'narracao.wav'), join(g.pasta, 'narracao.m4a')])
  rmSync(join(g.pasta, 'narracao.wav'))
  writeFileSync(join(g.pasta, 'manifesto.json'), JSON.stringify({ largura: LARGURA, altura: ALTURA, faixa: FAIXA, duracao, quadros: g.quadros, legendas: g.legendas, audio: 'narracao.m4a' }))
  return { duracao, quadros: g.quadros.length, falas: g.falas.length }
}

// ------------------------------------------------------------------ navegador
// Dentro de cada página: um cursor desenhado (o Chrome sem janela não mostra o ponteiro), a marca do clique
// e os cartões de abertura de capítulo.
const NA_PAGINA = `(() => {
  if (window.__video) return
  let cursor
  const lido = () => { try { return JSON.parse(sessionStorage.getItem('__cursor') || 'null') } catch { return null } }
  const mover = (x, y) => { if (cursor) cursor.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)' }
  const instalar = () => {
    if (document.getElementById('__cursor')) return
    cursor = document.createElement('div')
    cursor.id = '__cursor'
    cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:28px;height:28px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))'
    cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.2 1.6L9.6 19z" fill="#1c1917" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(cursor)
    const p = lido()
    mover(p ? p.x : -80, p ? p.y : -80)
  }
  addEventListener('mousemove', (e) => { mover(e.clientX, e.clientY); try { sessionStorage.setItem('__cursor', JSON.stringify({ x: e.clientX, y: e.clientY })) } catch {} }, true)
  addEventListener('mousedown', (e) => {
    const o = document.createElement('div')
    o.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;left:' + (e.clientX - 20) + 'px;top:' + (e.clientY - 20) + 'px;width:40px;height:40px;border-radius:50%;background:rgba(192,53,29,.30);border:2.5px solid rgba(192,53,29,.95);transition:transform .5s ease-out,opacity .5s ease-out'
    document.documentElement.appendChild(o)
    requestAnimationFrame(() => requestAnimationFrame(() => { o.style.transform = 'scale(2)'; o.style.opacity = '0' }))
    setTimeout(() => o.remove(), 560)
  }, true)
  window.__video = {
    cartao(rotulo, titulo, sub) {
      document.getElementById('__cartao')?.remove()
      const c = document.createElement('div')
      c.id = '__cartao'
      c.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:#261912;color:#fdfaf5;display:flex;flex-direction:column;justify-content:center;padding:0 9vw;font-family:"DM Sans",system-ui,sans-serif'
      const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))
      c.innerHTML = '<div style="font-size:15px;letter-spacing:.18em;text-transform:uppercase;color:#f2b632;font-weight:700">' + esc(rotulo) + '</div>'
        + '<div style="font-family:Fraunces,Georgia,serif;font-size:58px;line-height:1.08;font-weight:600;margin-top:14px">' + esc(titulo) + '</div>'
        + (sub ? '<div style="font-size:20px;line-height:1.45;color:#e7dccb;margin-top:20px;max-width:46em">' + esc(sub) + '</div>' : '')
        + '<div style="position:absolute;left:9vw;bottom:38px;font-size:14px;color:#b9a892">Tia Cê Pizzas · tutorial em vídeo</div>'
      document.documentElement.appendChild(c)
      if (cursor) cursor.style.display = 'none'
    },
    semCartao() { document.getElementById('__cartao')?.remove(); if (cursor) cursor.style.display = '' },
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar)
  else instalar()
})()`

let navegador
export async function abrirNavegador() {
  navegador = await puppeteer.launch({
    executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    defaultViewport: null,
    args: ['--no-first-run', '--lang=pt-BR', '--hide-scrollbars', `--force-device-scale-factor=${ESCALA}`],
  })
  return navegador
}
export const fecharNavegador = () => navegador?.close()

export async function novaPagina(tipo, { base, api, fuso } = {}) {
  const contexto = await navegador.createBrowserContext()
  if (base) await contexto.overridePermissions(base, ['geolocation', 'clipboard-read', 'clipboard-write'])
  const p = await contexto.newPage()
  const tela = tipo === 'celular' ? TELA_CELULAR : TELA_PC
  const cdp = await p.createCDPSession()
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...tela, deviceScaleFactor: 0, mobile: false })
  telas.set(p, { cdp, ...tela })
  await p.setGeolocation({ latitude: -23.5612, longitude: -46.6561 })
  if (fuso) await p.emulateTimezone(fuso)
  await p.evaluateOnNewDocument(NA_PAGINA)
  p.on('pageerror', (e) => g.problemas.push(`exceção em ${p.url()}: ${e.message.slice(0, 160)}`))
  p.on('response', (r) => api && r.url().startsWith(api) && r.status() >= 400 && !/realtime/.test(r.url()) && g.problemas.push(`${r.status()} ${r.request().method()} ${r.url().replace(api, '').slice(0, 100)}`))
  p.on('dialog', (d) => d.accept())
  return p
}

// ------------------------------------------------------------------ gestos visíveis
/** Acha o primeiro elemento visível cujo texto (ou aria-label) contém o trecho. */
export async function achar(p, trecho, seletor = 'button, a, [role=tab], summary, label') {
  const h = await p.evaluateHandle(
    (trecho, seletor) => {
      const visivel = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'
      return [...document.querySelectorAll(seletor)].filter(visivel).find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().includes(trecho)) ?? null
    },
    trecho, seletor,
  )
  const el = h.asElement()
  if (!el) throw new Error(`não achei "${trecho}" em ${p.url()}`)
  return el
}
const ponteiro = new WeakMap()
/** Move o cursor em pequenos passos (acelera e freia), para o caminho aparecer no vídeo. */
async function deslizar(p, x, y) {
  const de = ponteiro.get(p) ?? { x: telas.get(p).width / 2, y: telas.get(p).height / 2 }
  const distancia = Math.hypot(x - de.x, y - de.y)
  const passos = Math.max(6, Math.min(16, Math.round(distancia / 55)))
  for (let i = 1; i <= passos; i++) {
    const k = i / passos
    const suave = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
    await p.mouse.move(de.x + (x - de.x) * suave, de.y + (y - de.y) * suave)
    await dormir(26)
  }
  ponteiro.set(p, { x, y })
}
/** Leva o cursor até o elemento, à vista de quem assiste. */
export async function apontar(p, el, { pausa = 260 } = {}) {
  // só rola a página se o elemento não estiver à vista (fora da tela ou atrás do cabeçalho fixo)
  const rolou = await el.evaluate((e) => {
    const r = e.getBoundingClientRect()
    const noPonto = document.elementFromPoint(r.left + Math.min(r.width / 2, 220), r.top + r.height / 2)
    const aVista = r.top >= 0 && r.bottom <= innerHeight && noPonto && (e === noPonto || e.contains(noPonto) || noPonto.contains(e))
    return aVista ? 0 : Math.round(r.top + r.height / 2 - innerHeight / 2)
  })
  if (rolou) await rolar(p, rolou, 250)
  else await dormir(120)
  let b = await el.boundingBox()
  if (!b) throw new Error('elemento sem área na tela')
  let x = b.x + Math.min(b.width / 2, 220), y = b.y + b.height / 2
  for (let i = 0; i < 30; i++) {
    const livre = await el.evaluate((e, x, y) => { const t = document.elementFromPoint(x, y); return Boolean(t && (e === t || e.contains(t) || t.contains(e))) }, x, y)
    if (livre) break
    await dormir(180)
    b = (await el.boundingBox()) ?? b
    x = b.x + Math.min(b.width / 2, 220); y = b.y + b.height / 2
  }
  await deslizar(p, x, y)
  await dormir(pausa)
  return { x, y }
}
export async function clicarEm(p, el, { espera = 800 } = {}) {
  await apontar(p, el)
  await p.mouse.down()
  await dormir(70)
  await p.mouse.up()
  await dormir(espera)
}
export async function clicar(p, trecho, seletor, opcoes) {
  await clicarEm(p, await achar(p, trecho, seletor), opcoes)
}
/** Só mostra onde fica, sem clicar. */
export async function mostrar(p, trecho, seletor = 'button, a, [role=tab], summary, label, h1, h2, h3, th, td, p, span, div', opcoes) {
  await apontar(p, await achar(p, trecho, seletor), opcoes)
}
async function campo(p, rotulo) {
  const h = await p.evaluateHandle((rotulo) => {
    const visivel = (e) => e.offsetParent !== null
    const porRotulo = [...document.querySelectorAll('label')].filter(visivel).find((l) => l.innerText.trim().startsWith(rotulo))?.querySelector('input, select, textarea')
    return porRotulo ?? [...document.querySelectorAll('input, select, textarea')].filter(visivel).find((e) => (e.getAttribute('aria-label') ?? e.placeholder ?? '').startsWith(rotulo)) ?? null
  }, rotulo)
  const el = h.asElement()
  if (!el) throw new Error(`campo "${rotulo}" não encontrado em ${p.url()}`)
  return el
}
/** Preenche um campo pelo rótulo, digitando aos poucos (ou escolhendo a opção, se for uma lista). */
export async function preencher(p, rotulo, valor, { ritmo = 38 } = {}) {
  const el = await campo(p, rotulo)
  await apontar(p, el, { pausa: 160 })
  if ((await el.evaluate((e) => e.tagName)) === 'SELECT') {
    const v = await el.evaluate((e, valor) => [...e.options].find((o) => o.text.includes(valor) || o.value === valor)?.value, valor)
    await el.select(v ?? valor)
  } else {
    await p.mouse.down(); await p.mouse.up()
    await el.evaluate((e) => e.select?.())
    await p.keyboard.press('Backspace')
    await el.type(String(valor), { delay: ritmo })
  }
  await dormir(280)
}
/** Rola a página em passos curtos (acelera e freia). */
export async function rolar(p, dy, espera = 500) {
  const passos = Math.max(4, Math.min(16, Math.round(Math.abs(dy) / 45)))
  let feito = 0
  for (let i = 1; i <= passos; i++) {
    const k = i / passos
    const alvo = Math.round(dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2))
    await p.evaluate((d) => window.scrollBy(0, d), alvo - feito)
    feito = alvo
    await dormir(62)
  }
  await dormir(espera)
}
export async function rolarAte(p, trecho, seletor = 'h1, h2, h3, th, summary, label, button', margem = 90) {
  const dy = await p.evaluate((trecho, seletor, margem) => {
    const e = [...document.querySelectorAll(seletor)].find((x) => x.offsetParent !== null && x.innerText.includes(trecho))
    return e ? Math.round(e.getBoundingClientRect().top - margem) : 0
  }, trecho, seletor, margem)
  if (dy) await rolar(p, dy)
}
export const topo = async (p) => { const y = await p.evaluate(() => scrollY); if (y) await rolar(p, -y, 300) }
/** Rola o conteúdo da janela (modal) aberta. */
export async function rolarJanela(p, y, espera = 800) {
  await p.evaluate((y) => document.querySelector('[role=dialog] .overflow-y-auto')?.scrollTo({ top: y, behavior: 'smooth' }), y)
  await dormir(espera)
}
export const fecharJanela = async (p) => { await p.keyboard.press('Escape'); await dormir(500) }

export const cartao = (p, rotulo, titulo, sub) => p.evaluate((r, t, s) => window.__video.cartao(r, t, s), rotulo, titulo, sub ?? '')
export const semCartao = async (p) => { await p.evaluate(() => window.__video.semCartao()); await dormir(350) }

// ------------------------------------------------------------------ mais gestos
/** Acha o menor elemento visível que contém o texto (para apontar rótulos, títulos e avisos). */
export async function acharTexto(p, trecho, dentroDe = 'body') {
  const h = await p.evaluateHandle((trecho, dentroDe) => {
    const raiz = document.querySelector(dentroDe)
    if (!raiz) return null
    const passeio = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
    for (let n = passeio.nextNode(); n; n = passeio.nextNode()) {
      const e = n.parentElement
      if (!e || !n.nodeValue.includes(trecho) || e.closest('#__cartao, script, style, option')) continue
      const r = e.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden') return e
    }
    return null
  }, trecho, dentroDe)
  const el = h.asElement()
  if (!el) throw new Error(`texto "${trecho}" não encontrado em ${p.url()}`)
  return el
}
export const mostrarTexto = async (p, trecho, dentroDe, opcoes) => apontar(p, await acharTexto(p, trecho, dentroDe), opcoes)
export const clicarTexto = async (p, trecho, dentroDe, opcoes) => clicarEm(p, await acharTexto(p, trecho, dentroDe), opcoes)

async function porSeletor(p, seletor) {
  const h = await p.evaluateHandle((seletor) => [...document.querySelectorAll(seletor)].find((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed') ?? null, seletor)
  const el = h.asElement()
  if (!el) throw new Error(`nada visível com "${seletor}" em ${p.url()}`)
  return el
}
export const apontarSel = async (p, seletor, opcoes) => apontar(p, await porSeletor(p, seletor), opcoes)
export const clicarSel = async (p, seletor, opcoes) => clicarEm(p, await porSeletor(p, seletor), opcoes)
/** Digita num campo achado por seletor (telas de login, que não têm rótulo único). */
export async function digitar(p, seletor, texto, { ritmo = 38 } = {}) {
  const el = await porSeletor(p, seletor)
  await apontar(p, el, { pausa: 160 })
  await p.mouse.down(); await p.mouse.up()
  await el.type(texto, { delay: ritmo })
  await dormir(250)
}
export const apontarCampo = async (p, rotulo, opcoes) => apontar(p, await campo(p, rotulo), opcoes)
export async function limpar(p, rotulo) {
  const el = await campo(p, rotulo)
  await el.evaluate((e) => { e.focus(); e.select?.() })
  await p.keyboard.press('Backspace')
  await dormir(500)
}
/** Dentro da linha (li, tr, article…) que contém um texto, acha o primeiro elemento do seletor (opcionalmente com um texto). */
export async function dentro(p, seletorLinha, textoLinha, seletorAlvo, textoAlvo = '') {
  const h = await p.evaluateHandle((sl, tl, sa, ta) => {
    const linha = [...document.querySelectorAll(sl)].find((e) => e.offsetParent !== null && e.innerText.includes(tl))
    return linha ? [...linha.querySelectorAll(sa)].find((e) => (e.innerText || e.getAttribute('aria-label') || '').includes(ta)) ?? null : null
  }, seletorLinha, textoLinha, seletorAlvo, textoAlvo)
  const el = h.asElement()
  if (!el) throw new Error(`não achei "${seletorAlvo} ${textoAlvo}" na linha "${textoLinha}" em ${p.url()}`)
  return el
}
