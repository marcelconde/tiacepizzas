// Pedidos variados para o teste de carga (`--variar`): percorre o cardápio inteiro — cada sabor em cada tamanho,
// meio a meio, bordas, adicionais, bebidas e outros produtos — e confere o que o banco cobrou com o preço que o
// cardápio do site mostra (mesmas regras de src/lib/loja.tsx: promoções, "maior sabor" ou média, adicional por
// tamanho, combos). Qualquer diferença ou recusa vai para o resumo.

const dinheiro = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`
const centavos = (v) => Math.round(v * 100) / 100
const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)]
const embaralhar = (lista) => {
  const l = [...lista]
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[l[i], l[j]] = [l[j], l[i]]
  }
  return l
}

export async function prepararPedidosVariados(banco, rpc) {
  const json = async (r) => {
    const res = await r
    if (!res.ok) throw new Error(`cardápio: ${res.status} ${await res.text()}`)
    return res.json()
  }
  const [[cfg], cats, tamanhos, produtos, adicionais, promocoes] = await Promise.all([
    json(banco('configuracoes?select=regra_preco_sabores,pedido_minimo')),
    json(banco('categorias?select=id,nome,usa_tamanhos&ativo=eq.true')),
    json(banco('tamanhos?select=*&ativo=eq.true&order=ordem')),
    json(banco('produtos?select=id,nome,preco,categoria_id,disponivel,produto_precos(tamanho_id,preco)&ativo=eq.true')),
    json(banco('adicionais?select=*&ativo=eq.true&order=ordem')),
    json(rpc('promocoes_vigentes')),
  ])
  const regra = cfg.regra_preco_sabores === 'media' ? 'media' : 'maior'
  const minimo = Number(cfg.pedido_minimo ?? 0)
  const comTamanho = new Set(cats.filter((c) => c.usa_tamanhos).map((c) => c.id))
  const tamanho = new Map(tamanhos.map((t) => [t.id, t]))
  const produto = new Map(produtos.map((p) => [p.id, p]))
  const bordas = adicionais.filter((a) => a.tipo === 'borda')
  const extras = adicionais.filter((a) => a.tipo !== 'borda')

  // ---- as regras de preço do site (src/lib/loja.tsx), reescritas aqui para conferir o banco ----
  const precoNoTamanho = (p, t) => {
    const v = p.produto_precos.find((x) => x.tamanho_id === t)?.preco
    return v == null ? null : Number(v)
  }
  const precoAdicional = (a, t) => Number((t ? a.precos_tamanho?.[t] : null) ?? a.preco)
  const precoComPromocao = (pid, t, preco) => {
    let melhor = preco
    for (const pr of promocoes.filter((x) => x.produtos.includes(pid) && (t === undefined || !x.tamanho_id || x.tamanho_id === t))) {
      const v = pr.tipo === 'percentual' ? Math.round(preco * (100 - Number(pr.valor))) / 100 : pr.tipo === 'valor' ? Math.max(preco - Number(pr.valor), 0) : Number(pr.valor)
      if (v < melhor) melhor = v
    }
    return melhor
  }
  const precoPizza = (sabores, t) => {
    const precos = sabores.map((s) => precoComPromocao(s.id, t, precoNoTamanho(s, t) ?? 0))
    return regra === 'media' ? centavos(precos.reduce((a, b) => a + b, 0) / precos.length) : Math.max(...precos)
  }
  const chave = (pid, t) => `${pid}|${t ?? ''}`
  const precoCheioDoCombo = (combo) => {
    let soma = 0
    for (const i of combo.itens ?? []) {
      const p = produtos.find((x) => x.id === i.produto_id && x.disponivel)
      const tabela = !p ? null : i.tamanho_id ? precoNoTamanho(p, i.tamanho_id) : p.preco != null ? Number(p.preco) : null
      if (tabela == null) return null
      soma += i.quantidade * precoComPromocao(i.produto_id, i.tamanho_id, tabela)
    }
    return soma
  }
  const descontoDeCombos = (itens) => {
    const livres = new Map()
    for (const i of itens) {
      if ((i.sabores?.length ?? 0) > 1) continue
      const k = chave(i.produto_id, i.tamanho_id)
      livres.set(k, (livres.get(k) ?? 0) + i.quantidade)
    }
    let desconto = 0
    for (const combo of promocoes.filter((pr) => pr.tipo === 'combo' && (pr.itens?.length ?? 0) > 0)) {
      const pede = new Map()
      for (const i of combo.itens) pede.set(chave(i.produto_id, i.tamanho_id), (pede.get(chave(i.produto_id, i.tamanho_id)) ?? 0) + i.quantidade)
      const cheio = precoCheioDoCombo(combo)
      if (cheio == null || cheio <= Number(combo.valor)) continue
      const vezes = Math.min(...[...pede].map(([k, q]) => Math.floor((livres.get(k) ?? 0) / q)))
      if (vezes < 1) continue
      for (const [k, q] of pede) livres.set(k, (livres.get(k) ?? 0) - vezes * q)
      desconto += centavos(vezes * (cheio - Number(combo.valor)))
    }
    return centavos(desconto)
  }

  // ---- o que dá para pedir ----
  const pizzas = produtos.filter((p) => p.disponivel && comTamanho.has(p.categoria_id))
  const combinacoes = pizzas.flatMap((p) => p.produto_precos.filter((x) => tamanho.has(x.tamanho_id)).map((x) => ({ p, t: tamanho.get(x.tamanho_id) })))
  const simples = produtos.filter((p) => p.disponivel && !comTamanho.has(p.categoria_id) && p.preco != null)
  if (!combinacoes.length && !simples.length) throw new Error('O cardápio não tem produto disponível para montar os pedidos de teste.')
  let filaPizzas = embaralhar(combinacoes)
  let filaSimples = embaralhar(simples)
  const proximaPizza = () => (filaPizzas.length ? filaPizzas.pop() : sortear(combinacoes))
  const proximoSimples = () => (filaSimples.length ? filaSimples.pop() : sortear(simples))

  const cobertura = { sabores: new Set(), simples: new Set() }
  const diferencas = []
  const recusas = []
  let conferidos = 0
  let itensConferidos = 0

  function itemPizza() {
    const { p, t } = proximaPizza()
    const sabores = [p]
    const outros = pizzas.filter((s) => s.id !== p.id && s.categoria_id === p.categoria_id && precoNoTamanho(s, t.id) != null)
    const quantos = t.max_sabores >= 3 && Math.random() < 0.15 ? 3 : t.max_sabores >= 2 && Math.random() < 0.4 ? 2 : 1
    for (const s of embaralhar(outros).slice(0, quantos - 1)) sabores.push(s)
    const adics = []
    if (t.aceita_borda !== false && bordas.length && Math.random() < 0.35) adics.push(sortear(bordas))
    if (extras.length && Math.random() < 0.25) adics.push(sortear(extras))
    const quantidade = Math.random() < 0.2 ? 2 : 1
    const unitario = centavos(precoPizza(sabores, t.id) + adics.reduce((s, a) => s + precoAdicional(a, t.id), 0))
    const nomeBase = sabores.length === 1 ? sabores[0].nome : sabores.map((s) => `1/${sabores.length} ${s.nome}`).join(' + ')
    return {
      envio: { produto_id: p.id, tamanho_id: t.id, sabores: sabores.map((s) => s.id), adicionais: adics.map((a) => a.id), quantidade, observacoes: '' },
      nome: `${nomeBase} (${t.nome})`,
      total: centavos(unitario * quantidade),
      cobre: sabores.map((s) => chave(s.id, t.id)),
    }
  }
  function itemSimples() {
    const p = proximoSimples()
    const quantidade = Math.random() < 0.3 ? 2 : 1
    return {
      envio: { produto_id: p.id, tamanho_id: null, adicionais: [], quantidade, observacoes: '' },
      nome: p.nome,
      total: centavos(precoComPromocao(p.id, null, Number(p.preco)) * quantidade),
      simples: p.id,
    }
  }

  /** Itens variados para um pedido e o que o site cobraria por eles. */
  function montar() {
    const itens = []
    const nPizzas = combinacoes.length ? 1 + Math.floor(Math.random() * 3) : 0
    for (let i = 0; i < nPizzas; i++) itens.push(itemPizza())
    if (simples.length && (filaSimples.length || Math.random() < 0.6 || !itens.length)) itens.push(itemSimples())
    while (itens.reduce((s, i) => s + i.total, 0) < minimo) itens.push(combinacoes.length ? itemPizza() : itemSimples())
    const subtotal = centavos(itens.reduce((s, i) => s + i.total, 0))
    const desconto = Math.min(descontoDeCombos(itens.map((i) => i.envio)), subtotal)
    const forma = sortear(['pix', 'dinheiro', 'credito', 'debito'])
    return {
      itens,
      envio: itens.map((i) => i.envio),
      forma,
      troco: forma === 'dinheiro' && Math.random() < 0.5 ? Math.ceil((subtotal - desconto + 1) / 50) * 50 : null,
      totalEsperado: centavos(subtotal - desconto),
    }
  }

  const resumoDoPedido = (m) => m.itens.map((i) => `${i.envio.quantidade}× ${i.nome}`).join(', ')

  /** Pedido recusado pelo banco (sem contar falta de resposta): é diferença entre o cardápio e o banco. */
  function recusado(m, motivo) {
    recusas.push({ motivo, pedido: resumoDoPedido(m) })
  }

  /** Compara o pedido gravado (tela de acompanhamento) com o que o site cobraria. */
  function conferir(m, totalBanco, acompanhamento) {
    conferidos++
    for (const i of m.itens) {
      if (i.cobre) i.cobre.forEach((k) => cobertura.sabores.add(k))
      if (i.simples) cobertura.simples.add(i.simples)
    }
    if (Math.abs(Number(totalBanco) - m.totalEsperado) > 0.009)
      diferencas.push(`total do pedido: site ${dinheiro(m.totalEsperado)}, banco ${dinheiro(totalBanco)} — ${resumoDoPedido(m)}`)
    const gravados = acompanhamento?.itens ?? []
    if (gravados.length !== m.itens.length) {
      diferencas.push(`pedido com ${m.itens.length} itens gravado com ${gravados.length} — ${resumoDoPedido(m)}`)
      return
    }
    m.itens.forEach((i, n) => {
      itensConferidos++
      const g = gravados[n]
      if (g.nome !== i.nome) diferencas.push(`nome: site "${i.nome}", banco "${g.nome}"`)
      if (Math.abs(Number(g.total) - i.total) > 0.009) diferencas.push(`preço de ${i.envio.quantidade}× ${i.nome}: site ${dinheiro(i.total)}, banco ${dinheiro(g.total)}`)
    })
  }

  function relatorio() {
    const linhas = []
    const faltam = combinacoes.filter(({ p, t }) => !cobertura.sabores.has(chave(p.id, t.id)))
    const faltamSimples = simples.filter((p) => !cobertura.simples.has(p.id))
    linhas.push(`Conferência dos pedidos variados: ${conferidos} pedidos e ${itensConferidos} itens comparados com o preço do cardápio.`)
    linhas.push(`  Sabores × tamanhos pedidos: ${combinacoes.length - faltam.length} de ${combinacoes.length}; outros produtos: ${simples.length - faltamSimples.length} de ${simples.length}.`)
    if (faltam.length) linhas.push(`  Não chegaram a ser pedidos: ${faltam.slice(0, 15).map(({ p, t }) => `${p.nome} (${t.nome})`).join(', ')}${faltam.length > 15 ? ` e mais ${faltam.length - 15}` : ''}`)
    if (faltamSimples.length) linhas.push(`  Produtos não pedidos: ${faltamSimples.slice(0, 15).map((p) => p.nome).join(', ')}${faltamSimples.length > 15 ? ` e mais ${faltamSimples.length - 15}` : ''}`)
    if (!diferencas.length && !recusas.length) linhas.push('  Nenhuma diferença: o banco cobrou exatamente o que o cardápio mostra e aceitou todas as combinações.')
    const unicas = [...new Set(diferencas)]
    if (unicas.length) {
      linhas.push(`  DIFERENÇAS (${unicas.length}):`)
      for (const d of unicas.slice(0, 30)) linhas.push(`    - ${d}`)
    }
    if (recusas.length) {
      linhas.push(`  RECUSADOS PELO BANCO (${recusas.length}):`)
      for (const r of recusas.slice(0, 15)) linhas.push(`    - "${r.motivo}" — ${r.pedido}`)
    }
    return linhas.join('\n')
  }

  return { montar, conferir, recusado, relatorio, regra, produto }
}
