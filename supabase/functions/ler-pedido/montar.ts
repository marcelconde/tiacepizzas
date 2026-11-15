// Partes da leitura de pedido do WhatsApp que não dependem da IA: o cardápio escrito para ela ler e a conferência
// do que ela devolveu. Usadas pela função de servidor (Deno) e pelo ambiente local de teste (Node), por isso aqui
// só entra TypeScript que o Node também entende.

export interface Cardapio {
  tamanhos: { id: string; nome: string; max_sabores: number; aceita_borda: boolean }[]
  categorias: { id: string; nome: string; usa_tamanhos: boolean }[]
  produtos: { id: string; categoria_id: string; nome: string; preco: number | null; produto_precos: { tamanho_id: string; preco: number }[] }[]
  adicionais: { id: string; nome: string; tipo: 'borda' | 'extra' }[]
}

/** O que a IA devolve: códigos curtos do cardápio (P1, T1, A1) no lugar dos identificadores do banco. */
export interface Lido {
  cliente: { nome: string | null; telefone: string | null }
  tipo: 'entrega' | 'retirada' | null
  endereco: { cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; referencia: string | null }
  itens: { produto: string; tamanho: string | null; sabores: string[]; adicionais: string[]; quantidade: number; observacoes: string | null; como_o_cliente_pediu: string }[]
  forma_pagamento: 'pix' | 'dinheiro' | 'credito' | 'debito' | 'vale_refeicao' | null
  troco_para: number | null
  observacoes: string | null
  duvidas: string[]
}

/** O que a tela recebe: identificadores do banco, só o que existe no cardápio, e as dúvidas para a atendente. */
export interface PedidoLido {
  cliente: Lido['cliente']
  tipo: Lido['tipo']
  endereco: Lido['endereco']
  itens: { produto_id: string; tamanho_id: string | null; sabores: string[]; adicionais: string[]; quantidade: number; observacoes: string }[]
  forma_pagamento: Lido['forma_pagamento']
  troco_para: number | null
  observacoes: string | null
  duvidas: string[]
}

export const INSTRUCOES = `Você ajuda a atendente de uma pizzaria de delivery no Brasil. Ela recebe pedidos pelo WhatsApp e cola aqui a conversa com o cliente: texto copiado, prints da tela, ou os dois. Sua tarefa é montar o pedido FINAL que o cliente confirmou, usando só o cardápio abaixo.

Regras:
- Considere a conversa inteira. Se o cliente mudou de ideia, vale a última versão. Mensagens da pizzaria (preços, perguntas, confirmações) servem só de contexto.
- Use os códigos do cardápio (P…, T…, A…). Nunca invente código.
- Pizza: indique o tamanho (T…). O cliente fala o tamanho do jeito dele: use a lista "o cliente também diz" de cada tamanho (ex.: "pequena" é o Broto/Brotinho, "média" é a Média, "G" é a Grande). Só é dúvida se ele não disser tamanho nenhum. Pizza de vários sabores ("meia calabresa meia mussarela", "metade…") é UM item, com todos os sabores em "sabores" (o primeiro sabor também vai em "produto"). Respeite o máximo de sabores do tamanho. Pizza de um sabor só: "sabores" com o próprio produto.
- Borda recheada e extras vão em "adicionais" (códigos A…). Borda só em tamanho que aceita borda.
- Produto sem tamanho (bebidas, sobremesas…): "tamanho" null e "sabores" vazio.
- "Sem cebola", "bem passada" e observações de um item vão em "observacoes" do item. Observações do pedido inteiro (ex.: "tocar o interfone") vão em "observacoes" do pedido.
- Em "como_o_cliente_pediu", copie o trecho em que o cliente pediu o item.
- Se algo do pedido não estiver no cardápio, estiver ambíguo (ex.: tamanho não informado, "cartão" sem dizer se é crédito ou débito) ou ilegível, NÃO adivinhe: deixe o campo vazio ou fora dos itens e explique em "duvidas", em português simples, para a atendente resolver.
- Cliente: nome e telefone com DDD, só números. Nos prints do WhatsApp, o nome ou o número do cliente costuma aparecer no topo da conversa. A pizzaria salva os contatos como "Primeiro nome cliente" (ex.: "Anderson cliente"): o nome é só "Anderson", sem a palavra "cliente". Não use dados da própria pizzaria.
- Entrega quando houver endereço ou o cliente pedir para entregar; retirada quando ele disser que vai buscar. Na dúvida, null.
- Endereço: separe rua (com o tipo: Rua, Avenida, Travessa…), número, complemento (apto, bloco, casa), bairro, CEP (só números) e ponto de referência.
- Pagamento: pix, dinheiro, credito, debito ou vale_refeicao (VR, vale-refeição). "Troco para 100" vira troco_para 100.
- Datas e horas das mensagens não fazem parte do pedido.
- Monte o pedido mesmo que a conversa termine sem o cliente confirmar prazo ou valor: a atendente confere. Em "duvidas", só o que falta ou está ambíguo para lançar o pedido (itens, tamanho, endereço, pagamento); nada sobre prazo de entrega ou cortesias da conversa.
- Os códigos vão exatamente como no cardápio ("P12", "T1", "A3"), sem o nome junto.`

/** Escreve o cardápio para a IA com códigos curtos e guarda a tradução de volta para os identificadores. */
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Como o cliente costuma chamar cada tamanho ("pequena" é o broto, "G" é a grande…). */
function apelidosDoTamanho(nome: string) {
  const n = norm(nome)
  if (/brot|pequen|mini/.test(n)) return ['pequena', 'pequeno', 'broto', 'brotinho', 'p']
  if (/medi/.test(n)) return ['media', 'medio', 'm']
  if (/gigante|famil|extra|gg/.test(n)) return ['familia', 'gigante', 'gg', 'extra grande']
  if (/grande/.test(n)) return ['grande', 'g']
  return []
}

export function cardapioParaIA(c: Cardapio) {
  const produto = new Map<string, string>()
  const tamanho = new Map<string, string>()
  const adicional = new Map<string, string>()
  const linhas: string[] = ['CARDÁPIO', '', 'Tamanhos de pizza (código | nome | até quantos sabores | aceita borda recheada | o cliente também diz):']
  c.tamanhos.forEach((t, i) => {
    tamanho.set(`T${i + 1}`, t.id)
    linhas.push(`T${i + 1} | ${t.nome} | ${t.max_sabores} | ${t.aceita_borda ? 'sim' : 'não'} | ${apelidosDoTamanho(t.nome).join(', ') || '—'}`)
  })
  const nomeTamanho = new Map(c.tamanhos.map((t) => [t.id, t.nome]))
  let n = 0
  for (const cat of c.categorias) {
    const dela = c.produtos.filter((p) => p.categoria_id === cat.id)
    if (!dela.length) continue
    linhas.push('', `${cat.nome} (${cat.usa_tamanhos ? 'pizza: escolher tamanho; pode dividir em sabores' : 'produto sem tamanho'}):`)
    for (const p of dela) {
      n++
      produto.set(`P${n}`, p.id)
      const precos = cat.usa_tamanhos
        ? p.produto_precos.filter((x) => nomeTamanho.has(x.tamanho_id)).map((x) => `${nomeTamanho.get(x.tamanho_id)} R$ ${Number(x.preco).toFixed(2)}`).join(', ')
        : `R$ ${Number(p.preco ?? 0).toFixed(2)}`
      linhas.push(`P${n} | ${p.nome} | ${precos}`)
    }
  }
  linhas.push('', 'Bordas e adicionais (código | tipo | nome):')
  c.adicionais.forEach((a, i) => {
    adicional.set(`A${i + 1}`, a.id)
    linhas.push(`A${i + 1} | ${a.tipo === 'borda' ? 'borda' : 'extra'} | ${a.nome}`)
  })
  return { texto: linhas.join('\n'), produto, tamanho, adicional }
}

const soNumeros = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/**
 * Acha o identificador a partir do que a IA escreveu: o código ("P12", "p12", "P12 - Calabresa"), o nome
 * ("Calabresa") ou, para tamanho, o apelido ("pequena"). Modelos mais simples às vezes trocam o código pelo nome.
 */
function resolver(valor: string | null | undefined, letra: 'P' | 'T' | 'A', codigos: Map<string, string>, nomes: { id: string; nome: string }[], apelidos?: (nome: string) => string[]) {
  const v = (valor ?? '').trim()
  if (!v) return undefined
  const m = v.toUpperCase().match(new RegExp(`(?:^|[^A-Z])${letra}\\s*-?\\s*(\\d+)\\b`))
  if (m && codigos.has(`${letra}${m[1]}`)) return codigos.get(`${letra}${m[1]}`)
  const texto = norm(v.replace(new RegExp(`^${letra}\\d+\\s*[-|:]?\\s*`, 'i'), ''))
  if (!texto) return undefined
  const igual = nomes.find((x) => norm(x.nome) === texto)
  if (igual) return igual.id
  if (apelidos) {
    const porApelido = nomes.filter((x) => apelidos(x.nome).includes(texto))
    if (porApelido.length === 1) return porApelido[0].id
  }
  // "pizza de calabresa" ou "calabresa grande": um único nome do cardápio dentro do texto
  const contidos = nomes.filter((x) => norm(x.nome).length >= 3 && texto.includes(norm(x.nome)))
  const maisLongo = contidos.sort((a, b) => b.nome.length - a.nome.length)[0]
  return contidos.length && contidos.filter((x) => x.nome.length === maisLongo.nome.length).length === 1 ? maisLongo.id : undefined
}

/** "Anderson cliente" → "Anderson": é assim que a pizzaria salva os contatos no WhatsApp. */
const semSufixoCliente = (nome: string | null) => {
  const n = (nome ?? '').replace(/[\s,(-]*\(?\s*cliente\s*\)?\s*$/i, '').trim()
  return n ? n : null
}
const limpo = (s: string | null | undefined) => {
  const t = (s ?? '').trim()
  return t ? t : null
}

/**
 * Confere o que a IA devolveu contra o cardápio de verdade: troca os códigos pelos identificadores e tira o que não
 * existe ou não combina (tamanho que a pizza não tem, borda em tamanho sem borda, sabores demais), explicando cada
 * corte em "duvidas". O preço não sai daqui: a tela calcula pelo cardápio e o banco refaz a conta ao lançar.
 */
export function montarPedido(lido: Lido, c: Cardapio, mapa: ReturnType<typeof cardapioParaIA>): PedidoLido {
  const duvidas = [...(lido.duvidas ?? [])].map((d) => d.trim()).filter(Boolean)
  const resolvidas = new Set<string>() // trechos que a conferência acertou: a dúvida da IA sobre eles sai
  const produtos = new Map(c.produtos.map((p) => [p.id, p]))
  const pizza = (id: string) => c.categorias.find((cat) => cat.id === produtos.get(id)?.categoria_id)?.usa_tamanhos === true
  const itens: PedidoLido['itens'] = []

  for (const item of lido.itens ?? []) {
    const pedido = limpo(item.como_o_cliente_pediu) ?? 'um item'
    const produtoId = resolver(item.produto, 'P', mapa.produto, c.produtos) ?? resolver(item.como_o_cliente_pediu, 'P', new Map(), c.produtos)
    if (!produtoId || !produtos.has(produtoId)) {
      duvidas.push(`Não achei no cardápio: "${pedido}".`)
      continue
    }
    const quantidade = Math.max(1, Math.min(50, Math.round(Number(item.quantidade) || 1)))
    const observacoes = (item.observacoes ?? '').trim().slice(0, 200)
    if (!pizza(produtoId)) {
      const extras = (item.adicionais ?? []).map((a) => resolver(a, 'A', mapa.adicional, c.adicionais)).filter((id): id is string => Boolean(id))
      itens.push({ produto_id: produtoId, tamanho_id: null, sabores: [], adicionais: extras, quantidade, observacoes })
      continue
    }
    // sem tamanho na resposta, ainda dá para achar no que o cliente escreveu ("uma pizza média de calabresa")
    const tamanhoId = resolver(item.tamanho, 'T', mapa.tamanho, c.tamanhos, apelidosDoTamanho) ?? tamanhoNoTexto(item.como_o_cliente_pediu, c.tamanhos)
    const tamanho = c.tamanhos.find((t) => t.id === tamanhoId)
    if (!tamanho) {
      duvidas.push(`Falta o tamanho da pizza: "${pedido}". Escolha no cardápio ao lado.`)
      continue
    }
    const temPreco = (id: string) => produtos.get(id)?.produto_precos.some((x) => x.tamanho_id === tamanho.id) === true
    let sabores = [produtoId, ...(item.sabores ?? []).map((s) => resolver(s, 'P', mapa.produto, c.produtos))]
      .filter((id): id is string => Boolean(id) && pizza(id!))
      .filter((id, i, todos) => todos.indexOf(id) === i)
    const semPreco = sabores.filter((id) => !temPreco(id))
    if (semPreco.length) duvidas.push(`${semPreco.map((id) => produtos.get(id)!.nome).join(', ')} não tem o tamanho ${tamanho.nome}: confira "${pedido}".`)
    sabores = sabores.filter(temPreco)
    if (!sabores.length) continue
    if (sabores.length > tamanho.max_sabores) {
      duvidas.push(`A pizza ${tamanho.nome} aceita até ${tamanho.max_sabores} sabor(es); ficaram os primeiros de "${pedido}".`)
      sabores = sabores.slice(0, tamanho.max_sabores)
    }
    let adicionais = (item.adicionais ?? []).map((a) => resolver(a, 'A', mapa.adicional, c.adicionais)).filter((id): id is string => Boolean(id))
    const bordas = adicionais.filter((id) => c.adicionais.find((a) => a.id === id)?.tipo === 'borda')
    if (bordas.length && !tamanho.aceita_borda) {
      duvidas.push(`O tamanho ${tamanho.nome} não tem borda recheada: tirei a borda de "${pedido}".`)
      adicionais = adicionais.filter((id) => !bordas.includes(id))
    } else if (bordas.length > 1) {
      duvidas.push(`Mais de uma borda em "${pedido}": ficou só a primeira.`)
      adicionais = adicionais.filter((id) => !bordas.slice(1).includes(id))
    }
    if (!item.tamanho) resolvidas.add(norm(pedido))
    itens.push({ produto_id: sabores[0], tamanho_id: tamanho.id, sabores, adicionais: [...new Set(adicionais)], quantidade, observacoes })
  }

  const e = lido.endereco ?? ({} as Lido['endereco'])
  const telefone = soNumeros(lido.cliente?.telefone).replace(/^55(?=\d{10,11}$)/, '')
  return {
    cliente: { nome: semSufixoCliente(limpo(lido.cliente?.nome)), telefone: telefone.length >= 10 ? telefone : null },
    tipo: lido.tipo === 'entrega' || lido.tipo === 'retirada' ? lido.tipo : null,
    endereco: {
      cep: soNumeros(e.cep).length === 8 ? soNumeros(e.cep) : null,
      logradouro: limpo(e.logradouro), numero: limpo(e.numero), complemento: limpo(e.complemento), bairro: limpo(e.bairro), referencia: limpo(e.referencia),
    },
    itens,
    forma_pagamento: ['pix', 'dinheiro', 'credito', 'debito', 'vale_refeicao'].includes(lido.forma_pagamento ?? '') ? lido.forma_pagamento : null,
    troco_para: Number(lido.troco_para) > 0 ? Number(lido.troco_para) : null,
    observacoes: limpo(lido.observacoes),
    duvidas: duvidas.filter((d) => ![...resolvidas].some((r) => r && norm(d).includes(r))),
  }
}

/** Tamanho dito no texto do cliente ("pizza média", "uma G de calabresa"). */
function tamanhoNoTexto(texto: string | null | undefined, tamanhos: Cardapio['tamanhos']) {
  const palavras = norm(texto).split(/[^a-z0-9]+/)
  const achados = tamanhos.filter((t) => palavras.includes(norm(t.nome)) || apelidosDoTamanho(t.nome).some((a) => (a.includes(' ') ? norm(texto).includes(a) : palavras.includes(a))))
  return achados.length === 1 ? achados[0].id : undefined
}
