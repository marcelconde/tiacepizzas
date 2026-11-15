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
- Pizza: indique o tamanho (T…). Pizza de vários sabores ("meia calabresa meia mussarela", "metade…") é UM item, com todos os sabores em "sabores" (o primeiro sabor também vai em "produto"). Respeite o máximo de sabores do tamanho. Pizza de um sabor só: "sabores" com o próprio produto.
- Borda recheada e extras vão em "adicionais" (códigos A…). Borda só em tamanho que aceita borda.
- Produto sem tamanho (bebidas, sobremesas…): "tamanho" null e "sabores" vazio.
- "Sem cebola", "bem passada" e observações de um item vão em "observacoes" do item. Observações do pedido inteiro (ex.: "tocar o interfone") vão em "observacoes" do pedido.
- Em "como_o_cliente_pediu", copie o trecho em que o cliente pediu o item.
- Se algo do pedido não estiver no cardápio, estiver ambíguo (ex.: tamanho não informado, "cartão" sem dizer se é crédito ou débito) ou ilegível, NÃO adivinhe: deixe o campo vazio ou fora dos itens e explique em "duvidas", em português simples, para a atendente resolver.
- Cliente: nome e telefone com DDD, só números. Nos prints do WhatsApp, o nome ou o número do cliente costuma aparecer no topo da conversa. Não use dados da própria pizzaria.
- Entrega quando houver endereço ou o cliente pedir para entregar; retirada quando ele disser que vai buscar. Na dúvida, null.
- Endereço: separe rua (com o tipo: Rua, Avenida, Travessa…), número, complemento (apto, bloco, casa), bairro, CEP (só números) e ponto de referência.
- Pagamento: pix, dinheiro, credito, debito ou vale_refeicao (VR, vale-refeição). "Troco para 100" vira troco_para 100.
- Datas e horas das mensagens não fazem parte do pedido.`

/** Escreve o cardápio para a IA com códigos curtos e guarda a tradução de volta para os identificadores. */
export function cardapioParaIA(c: Cardapio) {
  const produto = new Map<string, string>()
  const tamanho = new Map<string, string>()
  const adicional = new Map<string, string>()
  const linhas: string[] = ['CARDÁPIO', '', 'Tamanhos de pizza (código | nome | até quantos sabores | aceita borda recheada):']
  c.tamanhos.forEach((t, i) => {
    tamanho.set(`T${i + 1}`, t.id)
    linhas.push(`T${i + 1} | ${t.nome} | ${t.max_sabores} | ${t.aceita_borda ? 'sim' : 'não'}`)
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
  const produtos = new Map(c.produtos.map((p) => [p.id, p]))
  const pizza = (id: string) => c.categorias.find((cat) => cat.id === produtos.get(id)?.categoria_id)?.usa_tamanhos === true
  const itens: PedidoLido['itens'] = []

  for (const item of lido.itens ?? []) {
    const pedido = limpo(item.como_o_cliente_pediu) ?? 'um item'
    const produtoId = mapa.produto.get(item.produto?.trim().toUpperCase())
    if (!produtoId || !produtos.has(produtoId)) {
      duvidas.push(`Não achei no cardápio: "${pedido}".`)
      continue
    }
    const quantidade = Math.max(1, Math.min(50, Math.round(Number(item.quantidade) || 1)))
    const observacoes = (item.observacoes ?? '').trim().slice(0, 200)
    if (!pizza(produtoId)) {
      const extras = (item.adicionais ?? []).map((a) => mapa.adicional.get(a.trim().toUpperCase())).filter((id): id is string => Boolean(id))
      itens.push({ produto_id: produtoId, tamanho_id: null, sabores: [], adicionais: extras, quantidade, observacoes })
      continue
    }
    const tamanhoId = item.tamanho ? mapa.tamanho.get(item.tamanho.trim().toUpperCase()) : undefined
    const tamanho = c.tamanhos.find((t) => t.id === tamanhoId)
    if (!tamanho) {
      duvidas.push(`Falta o tamanho da pizza: "${pedido}". Escolha no cardápio ao lado.`)
      continue
    }
    const temPreco = (id: string) => produtos.get(id)?.produto_precos.some((x) => x.tamanho_id === tamanho.id) === true
    let sabores = [produtoId, ...(item.sabores ?? []).map((s) => mapa.produto.get(s.trim().toUpperCase()))]
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
    let adicionais = (item.adicionais ?? []).map((a) => mapa.adicional.get(a.trim().toUpperCase())).filter((id): id is string => Boolean(id))
    const bordas = adicionais.filter((id) => c.adicionais.find((a) => a.id === id)?.tipo === 'borda')
    if (bordas.length && !tamanho.aceita_borda) {
      duvidas.push(`O tamanho ${tamanho.nome} não tem borda recheada: tirei a borda de "${pedido}".`)
      adicionais = adicionais.filter((id) => !bordas.includes(id))
    } else if (bordas.length > 1) {
      duvidas.push(`Mais de uma borda em "${pedido}": ficou só a primeira.`)
      adicionais = adicionais.filter((id) => !bordas.slice(1).includes(id))
    }
    itens.push({ produto_id: sabores[0], tamanho_id: tamanho.id, sabores, adicionais: [...new Set(adicionais)], quantidade, observacoes })
  }

  const e = lido.endereco ?? ({} as Lido['endereco'])
  const telefone = soNumeros(lido.cliente?.telefone).replace(/^55(?=\d{10,11}$)/, '')
  return {
    cliente: { nome: limpo(lido.cliente?.nome), telefone: telefone.length >= 10 ? telefone : null },
    tipo: lido.tipo === 'entrega' || lido.tipo === 'retirada' ? lido.tipo : null,
    endereco: {
      cep: soNumeros(e.cep).length === 8 ? soNumeros(e.cep) : null,
      logradouro: limpo(e.logradouro), numero: limpo(e.numero), complemento: limpo(e.complemento), bairro: limpo(e.bairro), referencia: limpo(e.referencia),
    },
    itens,
    forma_pagamento: ['pix', 'dinheiro', 'credito', 'debito', 'vale_refeicao'].includes(lido.forma_pagamento ?? '') ? lido.forma_pagamento : null,
    troco_para: Number(lido.troco_para) > 0 ? Number(lido.troco_para) : null,
    observacoes: limpo(lido.observacoes),
    duvidas,
  }
}
