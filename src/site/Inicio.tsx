import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, ChefHat, MousePointerClick } from 'lucide-react'
import { PizzaIlustrada } from '../components/Logo'
import { MontarItem } from '../components/MontarItem'
import { useCarrinho } from '../lib/carrinho'
import { brl } from '../lib/formato'
import { precoInicial, useLoja } from '../lib/loja'
import type { Produto } from '../lib/tipos'
import { SeloAberta } from './SiteLayout'

const botao = 'inline-flex h-12 items-center justify-center rounded-lg px-6 font-semibold transition-colors'

export default function Inicio() {
  const { config, catalogo } = useLoja()
  const { adicionar } = useCarrinho()
  const [montando, setMontando] = useState<Produto | null>(null)
  const destaques = catalogo.produtos.filter((p) => p.destaque && p.disponivel).slice(0, 4)
  const minutos = (config?.tempo_preparo_min ?? 40) + (config?.tempo_entrega_min ?? 20)

  const passos = [
    { icone: MousePointerClick, titulo: 'Monte do seu jeito', texto: 'Escolha o tamanho, divida em até três sabores e capriche na borda.' },
    { icone: ChefHat, titulo: 'A gente prepara na hora', texto: 'Massa aberta à mão e forno bem quente. Nada de pizza pronta esperando.' },
    { icone: Bike, titulo: 'Acompanhe até a porta', texto: 'Veja cada etapa do pedido em tempo real, do forno à entrega.' },
  ]

  return (
    <>
      <section className="overflow-hidden bg-forno-900 text-massa-50">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 md:grid-cols-[1.1fr_1fr] md:py-20">
          <div>
            <div className="md:hidden">
              <SeloAberta />
            </div>
            <h1 className="mt-4 font-display text-5xl leading-[1.05] font-bold text-balance md:text-6xl">
              Pizza de verdade, feita pela <span className="text-queijo-400">Tia Cê</span>.
            </h1>
            <p className="mt-5 max-w-md text-lg text-massa-300">
              Receita de família, ingredientes escolhidos a dedo e entrega em cerca de {minutos} minutos.
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
          <PizzaIlustrada className="mx-auto w-64 md:w-full md:max-w-md" />
        </div>
      </section>

      {destaques.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-3xl font-bold">As mais pedidas</h2>
            <Link to="/cardapio" className="text-sm font-semibold text-molho-700 hover:underline">
              Cardápio completo →
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {destaques.map((p) => {
              const categoria = catalogo.categorias.find((c) => c.id === p.categoria_id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setMontando(p)}
                  className="flex flex-col rounded-2xl border border-massa-200 bg-white p-5 text-left transition-shadow hover:shadow-md"
                >
                  <span className="font-display text-xl font-semibold">{p.nome}</span>
                  <span className="mt-1 flex-1 text-sm text-stone-600">{p.descricao}</span>
                  <span className="mt-4 text-sm text-stone-500">
                    a partir de <b className="text-base text-molho-700">{brl(precoInicial(p, Boolean(categoria?.usa_tamanhos)))}</b>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="border-y border-massa-200 bg-massa-100">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-3">
          {passos.map((p) => (
            <div key={p.titulo}>
              <p.icone className="size-8 text-molho-600" />
              <h3 className="mt-3 font-display text-xl font-semibold">{p.titulo}</h3>
              <p className="mt-1 text-sm text-forno-600">{p.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <MontarItem produto={montando} onFechar={() => setMontando(null)} onAdicionar={adicionar} />
    </>
  )
}
