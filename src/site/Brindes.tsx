import { Gift, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Botao, cx } from '../components/ui'
import { useCarrinho } from '../lib/carrinho'
import { brl } from '../lib/formato'
import { brindesNaSacola, brindesVigentes, opcoesDoBrinde, useLoja } from '../lib/loja'

/**
 * Na sacola e no checkout: avisa o brinde que o cliente já ganhou e põe na sacola com um clique (o desconto vem
 * sozinho, pelo mesmo cálculo do servidor). Se falta pouco para ganhar, avisa também.
 */
export function AvisoBrindes() {
  const { itens, adicionar } = useCarrinho()
  const { catalogo } = useLoja()
  const brindes = brindesNaSacola(catalogo, itens)
  if (!itens.length || !brindes.length) return null
  return (
    <>
      {brindes.map(({ promocao, faltam, direito, faltamComprar }) => {
        const opcoes = opcoesDoBrinde(catalogo, promocao)
        if (!opcoes.length) return null
        if (faltam > 0)
          return (
            <div key={promocao.id} className="mb-3 rounded-xl border border-manjericao-500/30 bg-manjericao-100 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-manjericao-700">
                <Gift className="size-4" /> Você ganhou {faltam > 1 ? `${faltam} brindes` : 'um brinde'}! {promocao.nome}
              </p>
              <p className="mt-0.5 text-stone-600">{opcoes.length > 1 ? 'Escolha e ponha na sacola:' : 'Ponha na sacola, sai de graça:'}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {opcoes.map((o) => (
                  <Botao key={o.produto_id + (o.tamanho_id ?? '')} variante="secundario" tamanho="p" onClick={() => adicionar({ ...o, uid: crypto.randomUUID() })}>
                    <Plus className="size-4" /> {o.nome} <s className="text-stone-400">{brl(o.preco_unitario)}</s> grátis
                  </Botao>
                ))}
              </div>
            </div>
          )
        if (direito === 0 && faltamComprar > 0 && faltamComprar < Math.max(promocao.compra_quantidade ?? 1, 1))
          return (
            <p key={promocao.id} className="mb-3 flex items-center gap-1.5 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">
              <Gift className="size-4 shrink-0" /> Peça mais {faltamComprar}{' '}
              {[nomesDasCategorias(catalogo, promocao.compra_categorias), catalogo.tamanhos.find((x) => x.id === promocao.tamanho_id)?.nome].filter(Boolean).join(' · ') || 'item'} e
              ganhe o brinde: {promocao.nome}
            </p>
          )
        return null
      })}
    </>
  )
}

/** "Pizzas Salgadas ou Pizzas Doces"; vazio quando vale qualquer categoria. */
const nomesDasCategorias = (c: ReturnType<typeof useLoja>['catalogo'], ids?: string[] | null) =>
  (ids ?? []).map((id) => c.categorias.find((x) => x.id === id)?.nome).filter(Boolean).join(' ou ')

/** Texto da condição: "Na compra de 2 Pizzas (Grande), ganhe: Guaraná 1L ou Calabresa (Broto)". */
export function textoDoBrinde(c: ReturnType<typeof useLoja>['catalogo'], b: Parameters<typeof opcoesDoBrinde>[1]) {
  const categoria = nomesDasCategorias(c, b.compra_categorias) || 'itens'
  const tamanho = c.tamanhos.find((x) => x.id === b.tamanho_id)?.nome
  const opcoes = opcoesDoBrinde(c, b).map((o) => o.nome)
  return `Na compra de ${b.compra_quantidade ?? 1} ${categoria}${tamanho ? ` (${tamanho})` : ''}, ganhe: ${opcoes.join(' ou ')}`
}

/** Cartões dos brindes valendo, na faixa de promoções da página inicial. */
export function CartoesBrindes({ className }: { className?: string }) {
  const { catalogo } = useLoja()
  const brindes = brindesVigentes(catalogo).filter((b) => b.destaque && opcoesDoBrinde(catalogo, b).length)
  if (!brindes.length) return null
  return (
    <div className={cx('grid gap-4 sm:grid-cols-2', className)}>
      {brindes.map((b) => (
        <Link key={b.id} to="/cardapio" className="flex items-start gap-3 rounded-2xl border border-manjericao-500/30 bg-manjericao-100 p-4 hover:shadow-md">
          <Gift className="mt-0.5 size-6 shrink-0 text-manjericao-700" />
          <span>
            <b className="block font-display text-lg text-forno-900">{b.nome}</b>
            {b.descricao && <span className="block text-sm text-stone-700">{b.descricao}</span>}
            <span className="mt-1 block text-sm text-manjericao-700">{textoDoBrinde(catalogo, b)}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
