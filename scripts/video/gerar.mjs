// Gera o vídeo-tutorial narrado (docs/video-tia-ce-pizzas.mp4), do zero:
//   1. sobe o ambiente de demonstração (portas próprias);
//   2. grava o sistema em uso, seguindo o roteiro (scripts/video/roteiro.mjs), com a narração na voz do macOS;
//   3. monta o MP4 com legendas (scripts/video/montar.swift).
// Uso: npm run video                 (leva o tempo do vídeo: cerca de meia hora)
//      npm run video -- --so=3,4     grava só alguns capítulos, para conferir um ajuste
//      npm run video -- --so-montar  refaz o MP4 com a última gravação
// Precisa de macOS (voz "Luciana", afconvert e swift) e do Google Chrome.
import { spawn, execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrirNavegador, dormir, encerrar, fecharNavegador, foraDoVideo, gravar, iniciar, novaPagina, problemas } from './gravador.mjs'
import { capitulos } from './roteiro.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pasta = join(raiz, 'docs', 'video', 'gravacao')
const saida = join(raiz, 'docs', process.env.SAIDA ?? 'video-tia-ce-pizzas.mp4')
const SENHA = 'teste1234' // senha dos usuários fictícios do ambiente local (scripts/dev-local.mjs)
const so = process.argv.find((a) => a.startsWith('--so='))?.slice(5).split(',').map(Number)

const montar = () => execFileSync('swift', ['-swift-version', '5', '-suppress-warnings', join(raiz, 'scripts/video/montar.swift'), pasta, saida], { stdio: 'inherit' })
if (process.argv.includes('--so-montar')) {
  montar()
  process.exit(0)
}

// usa um ambiente já no ar (BASE e API) ou sobe o seu
let BASE = process.env.BASE, API = process.env.API, FUSO = process.env.FUSO, servidor
if (!BASE) {
  // para o quadro de pedidos ter cara de expediente: um fuso em que agora são cerca de 20h
  const h = (new Date().getUTCHours() - 20 + 24) % 24
  FUSO = h === 0 ? 'Etc/GMT' : h <= 12 ? `Etc/GMT+${h}` : `Etc/GMT-${24 - h}`
  BASE = 'http://localhost:5213'
  API = 'http://localhost:54361'
  servidor = spawn(process.execPath, [join(raiz, 'scripts/dev-local.mjs')], { cwd: raiz, stdio: 'ignore', env: { ...process.env, DEMO: '1', FUSO, TZ: FUSO, PORTA_API: '54361', PORTA_SITE: '5213' } })
  process.on('exit', () => servidor.kill('SIGTERM'))
  for (let i = 0; ; i++) {
    if (i > 90) throw new Error('o ambiente de demonstração não respondeu')
    await dormir(1000)
    if (await fetch(BASE + '/').then((r) => r.ok, () => false)) break
  }
}

const token = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dona@teste.local', password: SENHA }) })).json()).access_token
const api = async (caminho, opcoes = {}) =>
  (await fetch(`${API}/rest/v1/${caminho}`, { ...opcoes, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...opcoes.headers } })).text().then((t) => (t ? JSON.parse(t) : null))
await api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ modo_entrega: 'bairro' }), headers: { prefer: 'return=minimal' } })

iniciar(pasta)
await abrirNavegador()
const opcoes = { base: BASE, api: API, fuso: FUSO }
const ir = async (p, rota, espera = 900) => {
  await p.goto(BASE + rota, { waitUntil: 'networkidle2', timeout: 40000 })
  await p.evaluate(() => document.fonts.ready)
  await dormir(espera)
}
const entrar = async (p, rota, email) => {
  await ir(p, rota)
  if (!(await p.$('input[type=password]'))) return
  await p.type('input[type=email]', email)
  await p.type('input[type=password]', SENHA)
  await p.click('button[type=submit]')
  await dormir(2500)
}
const site = await novaPagina('pc', opcoes), cel = await novaPagina('celular', opcoes), pc = await novaPagina('pc', opcoes)
const atend = await novaPagina('pc', opcoes), moto = await novaPagina('celular', opcoes)
await Promise.all([ir(site, '/'), ir(cel, '/'), ir(pc, '/admin'), ir(moto, '/entregador')])
await entrar(atend, '/admin', 'ana@teste.local')

const lista = capitulos({ site, cel, pc, atend, moto, ir, api, SENHA })
// gravando só alguns capítulos, o painel precisa já estar aberto (a entrada é mostrada no capítulo 2)
if (so && !so.includes(2)) await entrar(pc, '/admin', 'dona@teste.local')
await gravar(so ? (so.some((n) => n <= 1) ? site : so.includes(12) && so.length === 1 ? moto : pc) : site)
for (const cap of lista) {
  if (so && !so.includes(cap.n)) continue
  const antes = problemas.length
  console.log(`▶ ${cap.n}. ${cap.titulo}`)
  try {
    await cap.gravar()
  } catch (e) {
    problemas.push(`capítulo ${cap.n} interrompido: ${e.message.split('\n')[0]}`)
    await foraDoVideo(async () => {}) // garante o relógio andando para o próximo capítulo
  }
  for (const p of problemas.slice(antes)) console.log('   ⚠', p)
}
const resumo = await encerrar()
await fecharNavegador()
servidor?.kill('SIGTERM')
console.log(`\ngravação: ${(resumo.duracao / 60).toFixed(1)} min, ${resumo.quadros} quadros, ${resumo.falas} falas`)
console.log(problemas.length ? `${problemas.length} ponto(s) de atenção:\n  ` + [...new Set(problemas)].join('\n  ') : 'sem pontos de atenção')
montar()
process.exit(0)
