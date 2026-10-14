import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isoDia } from './formato'
import { configurado, mensagemErro, supabase } from './supabase'
import type { Adicional, Bairro, Banner, Categoria, Configuracoes, FaixaEntrega, ItemCarrinho, PosicaoBanner, Produto, Promocao, SiteConteudo, Tamanho } from './tipos'

export interface Catalogo {
  categorias: Categoria[]
  tamanhos: Tamanho[]
  produtos: Produto[]
  adicionais: Adicional[]
  bairros: Bairro[]
  faixas: FaixaEntrega[]
  promocoes: Promocao[]
  banners: Banner[]
}

interface Loja {
  config: Configuracoes | null
  conteudo: SiteConteudo | null
  catalogo: Catalogo
  aberta: boolean | null
  carregando: boolean
  erro: string | null
  recarregar: () => Promise<void>
}

const vazio: Catalogo = { categorias: [], tamanhos: [], produtos: [], adicionais: [], bairros: [], faixas: [], promocoes: [], banners: [] }
const Contexto = createContext<Loja>({ config: null, conteudo: null, catalogo: vazio, aberta: null, carregando: true, erro: null, recarregar: async () => {} })

// Preço, disponibilidade e promoções mudam durante o expediente: nada disso fica guardado no aparelho,
// e o cardápio é buscado de novo a cada 2 minutos e sempre que a pessoa volta para a aba.
const INTERVALO = 120_000

// O visitante só pode ler estas colunas. O que é interno (metas, alertas, impressão…) vem de config_interna(),
// que só responde à equipe; para os demais valem estes padrões, que o site não usa.
const CONFIG_PUBLICA =
  'id, nome_loja, slogan, telefone, whatsapp, instagram, cep, logradouro, numero, bairro, cidade, uf, fuso_horario, horarios, loja_aberta_manual, aceita_pedidos_online, pedido_minimo, tempo_preparo_min, tempo_entrega_min, regra_preco_sabores, chave_pix, mensagem_aviso, modo_entrega, loja_lat, loja_lng, rastreio_motoboy, exigir_login, login_google, login_facebook, login_email, cnpj'
const CONFIG_INTERNA_PADRAO: Pick<Configuracoes, 'auto_aceitar' | 'impressao' | 'alertas_pedido' | 'metas' | 'categorias_despesa'> = {
  auto_aceitar: false,
  impressao: { largura: 80, auto: false, via_cozinha: true },
  alertas_pedido: { atencao: 15, atrasado: 25, critico: 40 },
  metas: {},
  categorias_despesa: ['Outros'],
}

export function LojaProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Configuracoes | null>(null)
  const [conteudo, setConteudo] = useState<SiteConteudo | null>(null)
  const [catalogo, setCatalogo] = useState<Catalogo>(vazio)
  const [aberta, setAberta] = useState<boolean | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const ultima = useRef(0)
  const usuario = useRef<string | null>(null)

  const recarregar = useCallback(async () => {
    if (!configurado) {
      setErro('O site ainda não está ligado ao banco de dados.')
      setCarregando(false)
      return
    }
    ultima.current = Date.now()
    const { data: sessao } = await supabase.auth.getSession()
    usuario.current = sessao.session?.user.id ?? null
    const [cfg, interna, site, cat, tam, prod, adi, bai, fai, ban, promo, ab] = await Promise.all([
      supabase.from('configuracoes').select(CONFIG_PUBLICA).single(),
      sessao.session ? supabase.rpc('config_interna') : Promise.resolve({ data: null, error: null }),
      supabase.from('site_conteudo').select('dados').single(),
      supabase.from('categorias').select('*').eq('ativo', true).order('ordem'),
      supabase.from('tamanhos').select('*').eq('ativo', true).order('ordem'),
      supabase.from('produtos').select('*, produto_precos(tamanho_id, preco)').eq('ativo', true).order('ordem').order('nome'),
      supabase.from('adicionais').select('*').eq('ativo', true).order('ordem'),
      supabase.from('bairros').select('*').eq('ativo', true).order('nome'),
      supabase.from('faixas_entrega').select('*').eq('ativo', true).order('ate_km'),
      supabase.from('banners').select('*').eq('ativo', true).order('ordem'),
      supabase.rpc('promocoes_vigentes'),
      supabase.rpc('loja_aberta'),
    ])
    const falha = [cfg, site, cat, tam, prod, adi, bai, fai, ban, promo].find((r) => r.error)?.error
    if (falha) setErro(mensagemErro(falha))
    else {
      const hoje = isoDia()
      setErro(null)
      setConfig({ ...CONFIG_INTERNA_PADRAO, ...(cfg.data as unknown as Configuracoes), ...((interna.data as Partial<Configuracoes> | null) ?? {}) })
      setConteudo((site.data as { dados: SiteConteudo }).dados)
      setCatalogo({
        categorias: cat.data as Categoria[],
        tamanhos: tam.data as Tamanho[],
        produtos: prod.data as Produto[],
        adicionais: adi.data as Adicional[],
        bairros: bai.data as Bairro[],
        faixas: fai.data as FaixaEntrega[],
        banners: (ban.data as Banner[]).filter((b) => (!b.data_inicio || b.data_inicio <= hoje) && (!b.data_fim || b.data_fim >= hoje)),
        promocoes: (promo.data ?? []) as Promocao[],
      })
    }
    if (typeof ab.data === 'boolean') setAberta(ab.data)
    setCarregando(false)
  }, [])

  useEffect(() => {
    recarregar()
    if (!configurado) return
    const seVelho = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima.current > 30_000) recarregar()
    }
    const t = setInterval(() => document.visibilityState === 'visible' && recarregar(), INTERVALO)
    document.addEventListener('visibilitychange', seVelho)
    window.addEventListener('focus', seVelho)
    // entrou ou saiu alguém: as configurações internas mudam de dono (fora do retorno do evento, como o supabase-js pede)
    const { data: escuta } = supabase.auth.onAuthStateChange((_evento, s) => {
      if ((s?.user.id ?? null) !== usuario.current) setTimeout(recarregar, 0)
    })
    return () => {
      escuta.subscription.unsubscribe()
      clearInterval(t)
      document.removeEventListener('visibilitychange', seVelho)
      window.removeEventListener('focus', seVelho)
    }
  }, [recarregar])

  const valor = useMemo(
    () => ({ config, conteudo, catalogo, aberta, carregando, erro, recarregar }),
    [config, conteudo, catalogo, aberta, carregando, erro, recarregar],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export const useLoja = () => useContext(Contexto)

export const bannersEm = (c: Catalogo, posicao: PosicaoBanner, categoriaId?: string) =>
  c.banners.filter((b) => b.posicao === posicao && (categoriaId === undefined || b.categoria_id === categoriaId))

/** Preço de tabela do produto no tamanho. */
export const precoNoTamanho = (p: Produto, tamanhoId: string) => {
  const v = p.produto_precos.find((x) => x.tamanho_id === tamanhoId)?.preco
  return v == null ? null : Number(v)
}

/** Preço da borda ou do adicional no tamanho da pizza: o preço próprio do tamanho ou, sem ele, o padrão. */
export const precoAdicional = (a: Adicional, tamanhoId?: string | null) => {
  const proprio = tamanhoId ? a.precos_tamanho?.[tamanhoId] : null
  return Number(proprio ?? a.preco)
}

/** Promoções vigentes que valem para o produto (e, se informado, para o tamanho). */
export const promocoesDo = (c: Catalogo, produtoId: string, tamanhoId?: string | null) =>
  c.promocoes.filter((pr) => pr.produtos.includes(produtoId) && (tamanhoId === undefined || !pr.tamanho_id || pr.tamanho_id === tamanhoId))

/** Mesmo cálculo do servidor: o menor entre o preço de tabela e as promoções vigentes. */
export function precoComPromocao(c: Catalogo, produtoId: string, tamanhoId: string | null, preco: number) {
  let melhor = preco
  for (const pr of promocoesDo(c, produtoId, tamanhoId)) {
    const v = pr.tipo === 'percentual' ? Math.round(preco * (100 - Number(pr.valor))) / 100 : pr.tipo === 'valor' ? Math.max(preco - Number(pr.valor), 0) : Number(pr.valor)
    if (v < melhor) melhor = v
  }
  return melhor
}

/** Combos que estão valendo agora: vários produtos por um preço só. */
export const combosVigentes = (c: Catalogo) => c.promocoes.filter((pr) => pr.tipo === 'combo' && (pr.itens?.length ?? 0) > 0)

const chaveCombo = (produtoId: string, tamanhoId: string | null) => `${produtoId}|${tamanhoId ?? ''}`

/** Quanto os itens do combo custam comprados soltos (com as promoções comuns); null se algum não está à venda. */
export function precoCheioDoCombo(c: Catalogo, combo: Promocao) {
  let soma = 0
  for (const i of combo.itens ?? []) {
    const p = c.produtos.find((x) => x.id === i.produto_id && x.disponivel)
    const tabela = !p ? null : i.tamanho_id ? precoNoTamanho(p, i.tamanho_id) : p.preco != null ? Number(p.preco) : null
    if (tabela == null) return null
    soma += i.quantidade * precoComPromocao(c, i.produto_id, i.tamanho_id, tabela)
  }
  return soma
}

/** Os itens do combo prontos para entrar na sacola (pizzas inteiras, sem borda nem adicionais). */
export function itensDoCombo(c: Catalogo, combo: Promocao): ItemCarrinho[] {
  return (combo.itens ?? []).flatMap((i) => {
    const p = c.produtos.find((x) => x.id === i.produto_id)
    if (!p) return []
    const tamanho = c.tamanhos.find((t) => t.id === i.tamanho_id) ?? null
    const tabela = i.tamanho_id ? (precoNoTamanho(p, i.tamanho_id) ?? 0) : Number(p.preco ?? 0)
    return [{
      uid: crypto.randomUUID(), produto_id: p.id, nome: nomeItem([p], tamanho), tamanho_id: i.tamanho_id, sabores: [p.id], adicionais: [],
      quantidade: i.quantidade, preco_unitario: precoComPromocao(c, p.id, i.tamanho_id, tabela), observacoes: '',
    }]
  })
}

/** "1 Calabresa (Grande) + 1 Mussarela (Média)" */
export const textoDoCombo = (c: Catalogo, combo: Promocao) => itensDoCombo(c, combo).map((i) => `${i.quantidade} ${i.nome}`).join(' + ')

/**
 * Mesmo cálculo do servidor (combos_do_pedido): os combos que cabem nos itens e o desconto de cada um.
 * Só contam pizzas inteiras (um sabor) e produtos simples; cada unidade entra em um combo só.
 */
export function combosDaSacola(c: Catalogo, itens: { produto_id: string; tamanho_id: string | null; sabores: string[]; quantidade: number }[]) {
  const livres = new Map<string, number>()
  for (const i of itens) {
    if (i.sabores.length > 1) continue
    const k = chaveCombo(i.produto_id, i.tamanho_id)
    livres.set(k, (livres.get(k) ?? 0) + i.quantidade)
  }
  const aplicados: { id: string; nome: string; vezes: number; desconto: number }[] = []
  for (const combo of combosVigentes(c)) {
    const pedidos = new Map<string, number>()
    for (const i of combo.itens!) pedidos.set(chaveCombo(i.produto_id, i.tamanho_id), (pedidos.get(chaveCombo(i.produto_id, i.tamanho_id)) ?? 0) + i.quantidade)
    const cheio = precoCheioDoCombo(c, combo)
    if (cheio == null || cheio <= Number(combo.valor)) continue
    const vezes = Math.min(...[...pedidos].map(([k, q]) => Math.floor((livres.get(k) ?? 0) / q)))
    if (vezes < 1) continue
    for (const [k, q] of pedidos) livres.set(k, (livres.get(k) ?? 0) - vezes * q)
    aplicados.push({ id: combo.id, nome: combo.nome, vezes, desconto: Math.round(vezes * (cheio - Number(combo.valor)) * 100) / 100 })
  }
  return { aplicados, desconto: Math.round(aplicados.reduce((s, a) => s + a.desconto, 0) * 100) / 100 }
}

/** Menor preço do produto ("a partir de"), de tabela e com promoção. */
export function precoInicial(c: Catalogo, p: Produto, usaTamanhos: boolean) {
  const opcoes = usaTamanhos
    ? p.produto_precos.map((x) => ({ tabela: Number(x.preco), promo: precoComPromocao(c, p.id, x.tamanho_id, Number(x.preco)) }))
    : p.preco != null
      ? [{ tabela: Number(p.preco), promo: precoComPromocao(c, p.id, null, Number(p.preco)) }]
      : []
  if (!opcoes.length) return null
  return opcoes.reduce((a, b) => (b.promo < a.promo ? b : a))
}

/** Mesmo cálculo do servidor: maior preço entre os sabores (ou a média), já com as promoções de cada um. */
export function precoPizza(c: Catalogo, sabores: Produto[], tamanhoId: string, regra: 'maior' | 'media') {
  const precos = sabores.map((s) => precoComPromocao(c, s.id, tamanhoId, precoNoTamanho(s, tamanhoId) ?? 0))
  if (!precos.length) return 0
  if (regra === 'media') return Math.round((precos.reduce((a, b) => a + b, 0) / precos.length) * 100) / 100
  return Math.max(...precos)
}

export function nomeItem(sabores: Produto[], tamanho?: Tamanho | null) {
  const base = sabores.length === 1 ? sabores[0].nome : sabores.map((s) => `1/${sabores.length} ${s.nome}`).join(' + ')
  return tamanho ? `${base} (${tamanho.nome})` : base
}
