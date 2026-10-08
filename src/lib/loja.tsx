import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isoDia } from './formato'
import { configurado, mensagemErro, supabase } from './supabase'
import type { Adicional, Bairro, Banner, Categoria, Configuracoes, FaixaEntrega, PosicaoBanner, Produto, Promocao, SiteConteudo, Tamanho } from './tipos'

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
  'id, nome_loja, slogan, telefone, whatsapp, instagram, cep, logradouro, numero, bairro, cidade, uf, fuso_horario, horarios, loja_aberta_manual, aceita_pedidos_online, pedido_minimo, tempo_preparo_min, tempo_entrega_min, regra_preco_sabores, chave_pix, mensagem_aviso, modo_entrega, loja_lat, loja_lng, rastreio_motoboy, exigir_login, login_google, login_facebook'
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
