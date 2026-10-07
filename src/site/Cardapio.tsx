import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { MontarItem } from '../components/MontarItem'
import { Carregando, Entrada, Vazio, cx, useAviso } from '../components/ui'
import { useCarrinho } from '../lib/carrinho'
import { brl } from '../lib/formato'
import { precoInicial, useLoja } from '../lib/loja'
import type { Produto } from '../lib/tipos'

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Cardapio() {
  const { catalogo, carregando, erro } = useLoja()
  const { adicionar } = useCarrinho()
  const aviso = useAviso()
  const [busca, setBusca] = useState('')
  const [montando, setMontando] = useState<Produto | null>(null)

  const secoes = useMemo(() => {
    const termo = semAcento(busca.trim())
    return catalogo.categorias
      .map((c) => ({
        categoria: c,
        produtos: catalogo.produtos.filter(
          (p) => p.categoria_id === c.id && (!termo || semAcento(`${p.nome} ${p.descricao ?? ''}`).includes(termo)),
        ),
      }))
      .filter((s) => s.produtos.length > 0)
  }, [catalogo, busca])

  if (carregando) return <Carregando texto="Abrindo o cardápio…" />
  if (erro) return null

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold">Cardápio</h1>
          <p className="mt-1 text-stone-600">Toque em um item para montar do seu jeito.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone-400" />
          <Entrada type="search" aria-label="Buscar no cardápio" placeholder="Buscar sabor ou ingrediente" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      <nav aria-label="Categorias" className="sem-barra sticky top-16 z-20 -mx-4 mt-6 flex gap-2 overflow-x-auto border-b border-massa-200 bg-massa-50/95 px-4 py-3 backdrop-blur max-sm:top-[6.6rem]">
        {secoes.map((s) => (
          <a key={s.categoria.id} href={`#cat-${s.categoria.id}`} className="rounded-full border border-massa-300 bg-white px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-forno-800 hover:border-molho-400 hover:text-molho-700">
            {s.categoria.nome}
          </a>
        ))}
      </nav>

      {secoes.length === 0 && (
        <div className="mt-8">
          <Vazio titulo="Nada por aqui" texto={busca ? `Não encontramos “${busca}” no cardápio.` : 'O cardápio ainda não foi cadastrado.'} />
        </div>
      )}

      {secoes.map(({ categoria, produtos }) => (
        <section key={categoria.id} id={`cat-${categoria.id}`} className="mt-10">
          <h2 className="font-display text-2xl font-bold">{categoria.nome}</h2>
          {categoria.descricao && <p className="text-sm text-stone-600">{categoria.descricao}</p>}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {produtos.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.disponivel}
                onClick={() => setMontando(p)}
                className={cx(
                  'group flex items-stretch gap-4 rounded-2xl border border-massa-200 bg-white p-4 text-left transition-shadow',
                  p.disponivel ? 'hover:shadow-md' : 'opacity-60',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-display text-lg font-semibold text-forno-900">{p.nome}</span>
                  {p.descricao && <span className="mt-0.5 line-clamp-2 text-sm text-stone-600">{p.descricao}</span>}
                  <span className="mt-auto pt-3 text-sm text-stone-500">
                    {!p.disponivel ? (
                      <b className="text-stone-600">Indisponível hoje</b>
                    ) : (
                      <>
                        {categoria.usa_tamanhos && 'a partir de '}
                        <b className="text-base text-molho-700 tabular-nums">{brl(precoInicial(p, categoria.usa_tamanhos))}</b>
                      </>
                    )}
                  </span>
                </div>
                {p.imagem_url ? (
                  <img src={p.imagem_url} alt="" loading="lazy" className="size-24 shrink-0 rounded-xl object-cover" />
                ) : (
                  p.disponivel && (
                    <span className="grid size-9 shrink-0 place-items-center self-end rounded-full bg-molho-50 text-molho-700 transition-colors group-hover:bg-molho-600 group-hover:text-white">
                      <Plus className="size-5" />
                    </span>
                  )
                )}
              </button>
            ))}
          </div>
        </section>
      ))}

      <MontarItem
        produto={montando}
        onFechar={() => setMontando(null)}
        onAdicionar={(item) => {
          adicionar(item)
          aviso.sucesso(`${item.nome} foi para a sacola`)
        }}
      />
    </div>
  )
}
