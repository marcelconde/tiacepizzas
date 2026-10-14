import { ShoppingBag, Tag } from 'lucide-react'
import { cx, useAviso } from '../components/ui'
import { useCarrinho } from '../lib/carrinho'
import { brl } from '../lib/formato'
import { combosVigentes, itensDoCombo, precoCheioDoCombo, textoDoCombo, useLoja } from '../lib/loja'

/**
 * Combos que estão valendo agora (vários produtos por um preço só). O botão leva todos os itens para a sacola
 * de uma vez; o desconto aparece na sacola e é conferido pelo servidor ao fechar o pedido.
 * Quem preferir pode pôr os itens na sacola um a um: o desconto entra do mesmo jeito.
 */
export function Combos({ soDestaque, className }: { soDestaque?: boolean; className?: string }) {
  const { catalogo } = useLoja()
  const { adicionar } = useCarrinho()
  const aviso = useAviso()
  const combos = combosVigentes(catalogo)
    .filter((c) => !soDestaque || c.destaque)
    .map((c) => ({ c, cheio: precoCheioDoCombo(catalogo, c) }))
    .filter((x): x is { c: (typeof x)['c']; cheio: number } => x.cheio != null && x.cheio > Number(x.c.valor))
  if (!combos.length) return null

  return (
    <div className={cx('grid gap-4 sm:grid-cols-2', className)}>
      {combos.map(({ c, cheio }) => (
        <article key={c.id} className="flex flex-col overflow-hidden rounded-2xl border border-queijo-400 bg-white">
          {c.imagem_url && <img src={c.imagem_url} alt="" loading="lazy" className="aspect-video w-full object-cover" />}
          <div className="flex flex-1 flex-col p-5">
            <span className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-queijo-400 px-2 py-0.5 text-xs font-bold text-forno-900">
              <Tag className="size-3" /> {c.selo}
            </span>
            <h3 className="font-display text-xl font-semibold">{c.nome}</h3>
            <p className="mt-1 text-sm font-semibold text-forno-800">{textoDoCombo(catalogo, c)}</p>
            {c.descricao && <p className="mt-1 text-sm text-stone-600">{c.descricao}</p>}
            <p className="mt-3 flex-1 text-sm text-stone-500">
              <s className="mr-1.5 text-stone-400">{brl(cheio)}</s>
              <span className="text-lg font-bold text-molho-700">{brl(c.valor)}</span>
            </p>
            <button
              type="button"
              className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-molho-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-molho-700"
              onClick={() => {
                itensDoCombo(catalogo, c).forEach(adicionar)
                aviso.sucesso(`${c.nome} foi para a sacola`)
              }}
            >
              <ShoppingBag className="size-4" /> Quero o combo
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
