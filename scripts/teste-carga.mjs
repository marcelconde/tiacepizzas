// Teste de carga: várias pessoas ao mesmo tempo no site, cada uma fazendo uma coisa — olhando o cardápio, fazendo
// pedido ou acompanhando o pedido — pelas mesmas chamadas que o site faz. Mede o tempo de resposta e os erros.
//
//   node scripts/teste-carga.mjs --pessoas 50 --minutos 2           site e banco publicados: PEDIDOS DE VERDADE
//   node scripts/teste-carga.mjs --pessoas 20 --minutos 1 --local   ambiente local (com "npm run dev:demo" rodando)
//   --intenso                                                       cada pessoa age a cada 2 a 5 s (estresse, não uso real)
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
    await acompanhar(corpo.codigo)
  } else {
    m.erros++
    const motivo = corpo.message ?? `HTTP ${r.status}`
    pedidos.recusados.set(motivo, (pedidos.recusados.get(motivo) ?? 0) + 1)
  }
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
  console.log(`Teste de carga — ${PESSOAS} pessoas por ${MINUTOS} min em ${LOCAL ? 'ambiente local' : SITE}${INTENSO ? ' (ritmo intenso)' : ''}`)
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
    const tipo = i % 5 < 2 ? olhar : i % 5 < 4 ? () => pedir(i + 1) : soAcompanhar
    // todos entram nos primeiros 5 segundos
    tarefas.push(dormir(Math.random() * 5_000).then(tipo))
  }
  const progresso = setInterval(() => {
    const total = [...medidas.values()].reduce((s, m) => s + m.ms.length, 0)
    console.log(`  ${Math.round((Date.now() - t0) / 1000)} s · ${total} chamadas · ${pedidos.feitos} pedidos feitos`)
  }, 15_000)
  await Promise.all(tarefas)
  clearInterval(progresso)

  const duracao = (Date.now() - t0) / 1000
  const todas = [...medidas.values()].flatMap((m) => m.ms)
  const erros = [...medidas.values()].reduce((s, m) => s + m.erros, 0)
  console.log(`\nResultado (${Math.round(duracao)} s): ${todas.length} chamadas (${(todas.length / duracao).toFixed(1)} por segundo), ${erros} com erro (${((erros / Math.max(1, todas.length)) * 100).toFixed(1)}%)`)
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
