import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { configurado, mensagemErro, supabase } from './supabase'
import type { Adicional, Bairro, Categoria, Configuracoes, Produto, Tamanho } from './tipos'

export interface Catalogo {
  categorias: Categoria[]
  tamanhos: Tamanho[]
  produtos: Produto[]
  adicionais: Adicional[]
  bairros: Bairro[]
}

interface Loja {
  config: Configuracoes | null
  catalogo: Catalogo
  aberta: boolean | null
  carregando: boolean
  erro: string | null
  recarregar: () => Promise<void>
}

const vazio: Catalogo = { categorias: [], tamanhos: [], produtos: [], adicionais: [], bairros: [] }
const Contexto = createContext<Loja>({ config: null, catalogo: vazio, aberta: null, carregando: true, erro: null, recarregar: async () => {} })

export function LojaProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Configuracoes | null>(null)
  const [catalogo, setCatalogo] = useState<Catalogo>(vazio)
  const [aberta, setAberta] = useState<boolean | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const verAberta = useCallback(async () => {
    const { data } = await supabase.rpc('loja_aberta')
    if (typeof data === 'boolean') setAberta(data)
  }, [])

  const recarregar = useCallback(async () => {
    if (!configurado) {
      setErro('O site ainda não está ligado ao banco de dados.')
      setCarregando(false)
      return
    }
    const [cfg, cat, tam, prod, adi, bai] = await Promise.all([
      supabase.from('configuracoes').select('*').single(),
      supabase.from('categorias').select('*').eq('ativo', true).order('ordem'),
      supabase.from('tamanhos').select('*').eq('ativo', true).order('ordem'),
      supabase.from('produtos').select('*, produto_precos(tamanho_id, preco)').eq('ativo', true).order('ordem').order('nome'),
      supabase.from('adicionais').select('*').eq('ativo', true).order('ordem'),
      supabase.from('bairros').select('*').eq('ativo', true).order('nome'),
    ])
    const falha = [cfg, cat, tam, prod, adi, bai].find((r) => r.error)?.error
    if (falha) setErro(mensagemErro(falha))
    else {
      setErro(null)
      setConfig(cfg.data as Configuracoes)
      setCatalogo({
        categorias: cat.data as Categoria[],
        tamanhos: tam.data as Tamanho[],
        produtos: prod.data as Produto[],
        adicionais: adi.data as Adicional[],
        bairros: bai.data as Bairro[],
      })
    }
    await verAberta()
    setCarregando(false)
  }, [verAberta])

  useEffect(() => {
    recarregar()
    if (!configurado) return
    const t = setInterval(verAberta, 60_000)
    return () => clearInterval(t)
  }, [recarregar, verAberta])

  const valor = useMemo(
    () => ({ config, catalogo, aberta, carregando, erro, recarregar }),
    [config, catalogo, aberta, carregando, erro, recarregar],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export const useLoja = () => useContext(Contexto)

export const precoNoTamanho = (p: Produto, tamanhoId: string) =>
  p.produto_precos.find((x) => x.tamanho_id === tamanhoId)?.preco ?? null

/** Menor preço do produto, para o "a partir de" do cardápio. */
export function precoInicial(p: Produto, usaTamanhos: boolean) {
  if (!usaTamanhos) return p.preco
  const precos = p.produto_precos.map((x) => Number(x.preco))
  return precos.length ? Math.min(...precos) : null
}

/** Mesmo cálculo do servidor: maior preço entre os sabores (ou a média, conforme a configuração). */
export function precoPizza(sabores: Produto[], tamanhoId: string, regra: 'maior' | 'media') {
  const precos = sabores.map((s) => Number(precoNoTamanho(s, tamanhoId) ?? 0))
  if (!precos.length) return 0
  if (regra === 'media') return Math.round((precos.reduce((a, b) => a + b, 0) / precos.length) * 100) / 100
  return Math.max(...precos)
}

export function nomeItem(sabores: Produto[], tamanho?: Tamanho | null) {
  const base = sabores.length === 1 ? sabores[0].nome : sabores.map((s) => `1/${sabores.length} ${s.nome}`).join(' + ')
  return tamanho ? `${base} (${tamanho.nome})` : base
}
