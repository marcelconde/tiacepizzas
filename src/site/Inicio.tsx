import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bike, ChefHat, MousePointerClick, Tag } from 'lucide-react'
import { Banners } from '../components/Banners'
import { PizzaIlustrada } from '../components/Logo'
import { MontarItem, Preco } from '../components/MontarItem'
import { cx } from '../components/ui'
import { useCarrinho } from '../lib/carrinho'
import { bannersEm, precoInicial, useLoja } from '../lib/loja'
import type { Produto, SecaoId, SiteConteudo, Tamanho3 } from '../lib/tipos'
import { SeloAberta } from './SiteLayout'

const botao = 'inline-flex h-12 items-center justify-center rounded-lg px-6 font-semibold transition-colors'
const ICONES = [MousePointerClick, ChefHat, Bike]

/** Página inicial montada a partir do que foi configurado no painel (Conteúdo → Página inicial). */
export default function Inicio() {
  const { config, conteudo, catalogo } = useLoja()
  const { adicionar } = useCarrinho()
  const [montando, setMontando] = useState<Produto | null>(null)
  if (!conteudo) return null

  const usaTamanhos = (p: Produto) => Boolean(catalogo.categorias.find((c) => c.id === p.categoria_id)?.usa_tamanhos)
  const cartao = (p: Produto, selo?: string) => {
    const preco = precoInicial(catalogo, p, usaTamanhos(p))
    return (
      <button key={p.id} type="button" onClick={() => setMontando(p)} className="flex flex-col overflow-hidden rounded-2xl border border-massa-200 bg-white text-left transition-shadow hover:shadow-md">
        {p.imagem_url && <img src={p.imagem_url} alt="" loading="lazy" className="aspect-video w-full object-cover" />}
        <span className="flex flex-1 flex-col p-5">
          {selo && <span className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-queijo-400 px-2 py-0.5 text-xs font-bold text-forno-900"><Tag className="size-3" /> {selo}</span>}
          <span className="font-display text-xl font-semibold">{p.nome}</span>
          <span className="mt-1 flex-1 text-sm text-stone-600">{p.descricao}</span>
          {preco && (
            <span className="mt-4 text-sm text-stone-500">
              {usaTamanhos(p) && 'a partir de '}
              <Preco tabela={preco.tabela} promo={preco.promo} className="text-base font-bold text-molho-700" />
            </span>
          )}
        </span>
      </button>
    )
  }

  const secoes: Record<SecaoId, (tamanho: Tamanho3) => ReactNode> = {
    hero: (tamanho) => <Hero conteudo={conteudo} tamanho={tamanho} minutos={(config?.tempo_preparo_min ?? 40) + (config?.tempo_entrega_min ?? 20)} />,
    banners: () => {
      const itens = bannersEm(catalogo, 'inicio_meio')
      return itens.length > 0 && <section className="mx-auto max-w-6xl px-4 py-6"><Banners itens={itens} /></section>
    },
    promocoes: (tamanho) => {
      const promos = catalogo.promocoes.filter((p) => p.destaque)
      const produtos = promos.flatMap((pr) => pr.produtos.map((id) => ({ pr, p: catalogo.produtos.find((x) => x.id === id && x.disponivel) }))).filter((x) => x.p)
      if (!produtos.length) return null
      return (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="font-display text-3xl font-bold">{conteudo.promocoes_titulo}</h2>
          <div className={cx('mt-6 grid gap-4 sm:grid-cols-2', tamanho === 'grande' ? 'lg:grid-cols-2' : tamanho === 'pequeno' ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
            {produtos.slice(0, tamanho === 'pequeno' ? 4 : 6).map(({ pr, p }) => cartao(p!, pr.selo))}
          </div>
        </section>
      )
    },
    destaques: (tamanho) => {
      const destaques = catalogo.produtos.filter((p) => p.destaque && p.disponivel).slice(0, tamanho === 'pequeno' ? 2 : tamanho === 'grande' ? 8 : 4)
      if (!destaques.length) return null
      return (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-3xl font-bold">{conteudo.destaques_titulo}</h2>
            <Link to="/cardapio" className="text-sm font-semibold text-molho-700 hover:underline">
              Cardápio completo →
            </Link>
          </div>
          <div className={cx('mt-6 grid gap-4 sm:grid-cols-2', tamanho !== 'pequeno' && 'lg:grid-cols-4')}>{destaques.map((p) => cartao(p))}</div>
        </section>
      )
    },
    como_funciona: (tamanho) => (
      <section className="border-y border-massa-200 bg-massa-100">
        <div className={cx('mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3', tamanho === 'pequeno' ? 'py-8' : tamanho === 'grande' ? 'py-20' : 'py-14')}>
          {conteudo.passos.map((p, i) => {
            const Icone = ICONES[i % ICONES.length]
            return (
              <div key={i}>
                <Icone className="size-8 text-molho-600" />
                <h3 className="mt-3 font-display text-xl font-semibold">{p.titulo}</h3>
                <p className="mt-1 text-sm text-forno-600">{p.texto}</p>
              </div>
            )
          })}
        </div>
      </section>
    ),
  }

  const topo = bannersEm(catalogo, 'inicio_topo')
  return (
    <>
      {topo.length > 0 && <div className="mx-auto max-w-6xl px-4 pt-4"><Banners itens={topo} /></div>}
      {conteudo.secoes.filter((s) => s.ativo && secoes[s.id]).map((s) => <div key={s.id}>{secoes[s.id](s.tamanho)}</div>)}
      <MontarItem produto={montando} onFechar={() => setMontando(null)} onAdicionar={adicionar} />
    </>
  )
}

function Hero({ conteudo, tamanho, minutos }: { conteudo: SiteConteudo; tamanho: Tamanho3; minutos: number }) {
  const { titulo, destaque, subtitulo, imagem_url } = conteudo.hero
  const i = destaque ? titulo.indexOf(destaque) : -1
  return (
    <section className="overflow-hidden bg-forno-900 text-massa-50">
      <div className={cx('mx-auto grid max-w-6xl items-center gap-8 px-4', tamanho === 'pequeno' ? 'py-8' : 'py-12 md:grid-cols-[1.1fr_1fr]', tamanho === 'grande' && 'md:py-20')}>
        <div>
          <div className="md:hidden">
            <SeloAberta />
          </div>
          <h1 className={cx('mt-4 font-display leading-[1.05] font-bold text-balance', tamanho === 'pequeno' ? 'text-3xl md:text-4xl' : 'text-4xl md:text-6xl')}>
            {i >= 0 ? (
              <>
                {titulo.slice(0, i)}
                <span className="text-queijo-400">{destaque}</span>
                {titulo.slice(i + destaque.length)}
              </>
            ) : (
              titulo
            )}
          </h1>
          <p className="mt-5 max-w-md text-lg text-massa-300">
            {subtitulo} Entrega em cerca de {minutos} minutos.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/cardapio" className={`${botao} bg-molho-600 text-white hover:bg-molho-500`}>
              Ver cardápio e pedir
            </Link>
            <Link to="/pedido" className={`${botao} border border-massa-300/40 text-massa-100 hover:bg-white/10`}>
              Acompanhar pedido
            </Link>
          </div>
        </div>
        {tamanho !== 'pequeno' &&
          (imagem_url ? (
            <img src={imagem_url} alt="" className="mx-auto aspect-square w-64 rounded-full object-cover md:w-full md:max-w-md" />
          ) : (
            <PizzaIlustrada className="mx-auto w-56 md:w-full md:max-w-md" />
          ))}
      </div>
    </section>
  )
}
