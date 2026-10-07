import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ItemCarrinho } from './tipos'

interface Carrinho {
  itens: ItemCarrinho[]
  quantidade: number
  subtotal: number
  adicionar: (item: ItemCarrinho) => void
  alterarQuantidade: (uid: string, quantidade: number) => void
  limpar: () => void
}

const CHAVE = 'tiace.carrinho'
const Contexto = createContext<Carrinho>({ itens: [], quantidade: 0, subtotal: 0, adicionar: () => {}, alterarQuantidade: () => {}, limpar: () => {} })

function ler(): ItemCarrinho[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export const subtotalDe = (itens: ItemCarrinho[]) => itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0)

/** Formato que a função criar_pedido espera para cada item. */
export const itensParaPedido = (itens: ItemCarrinho[]) =>
  itens.map((i) => ({
    produto_id: i.produto_id,
    tamanho_id: i.tamanho_id,
    sabores: i.tamanho_id ? i.sabores : undefined,
    adicionais: i.adicionais.map((a) => a.id),
    quantidade: i.quantidade,
    observacoes: i.observacoes,
  }))

export function CarrinhoProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemCarrinho[]>(ler)

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(itens))
    } catch {
      /* navegação privada: o carrinho vive só na memória */
    }
  }, [itens])

  const adicionar = useCallback((item: ItemCarrinho) => setItens((l) => [...l, item]), [])
  const alterarQuantidade = useCallback(
    (uid: string, quantidade: number) =>
      setItens((l) => (quantidade <= 0 ? l.filter((i) => i.uid !== uid) : l.map((i) => (i.uid === uid ? { ...i, quantidade } : i)))),
    [],
  )
  const limpar = useCallback(() => setItens([]), [])

  const valor = useMemo(
    () => ({
      itens,
      quantidade: itens.reduce((s, i) => s + i.quantidade, 0),
      subtotal: subtotalDe(itens),
      adicionar,
      alterarQuantidade,
      limpar,
    }),
    [itens, adicionar, alterarQuantidade, limpar],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export const useCarrinho = () => useContext(Contexto)
