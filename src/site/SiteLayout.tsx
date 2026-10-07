import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AtSign, Clock, MapPin, MessageCircle, Phone, ShoppingBag, Trash2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Botao, Contador, Erro, Modal, cx } from '../components/ui'
import { useCarrinho } from '../lib/carrinho'
import { DIAS_SEMANA, brl, soDigitos, telefone } from '../lib/formato'
import { useLoja } from '../lib/loja'

export const linkWhatsApp = (numero: string | null | undefined, texto = '') =>
  numero ? `https://wa.me/55${soDigitos(numero)}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : null

export function SeloAberta() {
  const { aberta } = useLoja()
  if (aberta == null) return null
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', aberta ? 'bg-manjericao-100 text-manjericao-700' : 'bg-stone-200 text-stone-700')}>
      <span className={cx('size-2 rounded-full', aberta ? 'bg-manjericao-500' : 'bg-stone-500')} />
      {aberta ? 'Aberto agora' : 'Fechado agora'}
    </span>
  )
}

function Sacola({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const { itens, subtotal, alterarQuantidade, limpar } = useCarrinho()
  const { config, aberta: lojaAberta } = useLoja()
  const navegar = useNavigate()
  const falta = Math.max(0, Number(config?.pedido_minimo ?? 0) - subtotal)

  return (
    <Modal
      aberto={aberta}
      titulo="Sua sacola"
      onFechar={onFechar}
      rodape={
        itens.length > 0 && (
          <div className="w-full">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm text-stone-600">Subtotal</span>
              <span className="text-lg font-bold tabular-nums">{brl(subtotal)}</span>
            </div>
            {falta > 0 && <p className="mb-2 text-sm text-molho-700">Faltam {brl(falta)} para o pedido mínimo.</p>}
            {lojaAberta === false && <p className="mb-2 text-sm text-stone-600">Estamos fechados agora — você pode montar a sacola e pedir quando abrirmos.</p>}
            <Botao
              tamanho="g"
              className="w-full"
              disabled={falta > 0}
              onClick={() => {
                onFechar()
                navegar('/checkout')
              }}
            >
              Finalizar pedido
            </Botao>
          </div>
        )
      }
    >
      {itens.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">Sua sacola está vazia. Que tal começar por uma pizza?</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {itens.map((i) => (
            <li key={i.uid} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-forno-900">{i.nome}</p>
                {i.adicionais.length > 0 && <p className="text-sm text-stone-600">+ {i.adicionais.map((a) => a.nome).join(', ')}</p>}
                {i.observacoes && <p className="text-sm text-stone-500 italic">“{i.observacoes}”</p>}
                <p className="mt-1 text-sm font-semibold tabular-nums">{brl(i.preco_unitario * i.quantidade)}</p>
              </div>
              <Contador valor={i.quantidade} onChange={(q) => alterarQuantidade(i.uid, q)} />
            </li>
          ))}
          <li className="pt-3">
            <button type="button" onClick={limpar} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-red-700">
              <Trash2 className="size-4" /> Esvaziar sacola
            </button>
          </li>
        </ul>
      )}
    </Modal>
  )
}

export default function SiteLayout() {
  const { config, erro } = useLoja()
  const { quantidade, subtotal } = useCarrinho()
  const [sacola, setSacola] = useState(false)
  const { pathname } = useLocation()
  const noCheckout = pathname.startsWith('/checkout')
  const whats = linkWhatsApp(config?.whatsapp, 'Olá! Vim pelo site.')

  useEffect(() => {
    window.scrollTo(0, 0) // em navegadores novos scrollTo devolve uma Promise: não pode ser o retorno do efeito
  }, [pathname])

  const link = ({ isActive }: { isActive: boolean }) =>
    cx('rounded-lg px-3 py-2 text-sm font-semibold', isActive ? 'text-molho-700' : 'text-forno-700 hover:text-molho-700')

  return (
    <div className="flex min-h-dvh flex-col">
      {config?.mensagem_aviso && <div className="bg-forno-900 px-4 py-2 text-center text-sm text-massa-100">{config.mensagem_aviso}</div>}
      <header className="sticky top-0 z-40 border-b border-massa-200 bg-massa-50/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link to="/" aria-label="Tia Cê Pizzas — início" className="mr-auto">
            <Logo />
          </Link>
          <nav className="hidden items-center sm:flex">
            <NavLink to="/cardapio" className={link}>
              Cardápio
            </NavLink>
            <NavLink to="/pedido" className={link}>
              Acompanhar pedido
            </NavLink>
          </nav>
          <div className="hidden md:block">
            <SeloAberta />
          </div>
          {!noCheckout && (
            <Botao onClick={() => setSacola(true)} aria-label={`Abrir sacola, ${quantidade} itens`}>
              <ShoppingBag className="size-4" />
              <span className="hidden sm:inline">Sacola</span>
              {quantidade > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{quantidade}</span>}
            </Botao>
          )}
        </div>
        <nav className="flex items-center justify-between gap-1 border-t border-massa-200 px-1 sm:hidden">
          <NavLink to="/cardapio" className={link}>
            Cardápio
          </NavLink>
          <NavLink to="/pedido" className={link}>
            Acompanhar pedido
          </NavLink>
          <span className="pr-3">
            <SeloAberta />
          </span>
        </nav>
      </header>

      <main className="flex-1">
        {erro && (
          <div className="mx-auto max-w-6xl px-4 pt-6">
            <Erro>
              Não conseguimos carregar o cardápio agora. {erro}
              {whats && (
                <>
                  {' '}
                  <a className="font-semibold underline" href={whats}>
                    Peça pelo WhatsApp
                  </a>
                  .
                </>
              )}
            </Erro>
          </div>
        )}
        <Outlet />
      </main>

      {quantidade > 0 && !noCheckout && (
        <div className="sticky bottom-0 z-30 border-t border-massa-200 bg-massa-50/95 p-3 backdrop-blur sm:hidden">
          <Botao tamanho="g" className="w-full" onClick={() => setSacola(true)}>
            <span className="flex w-full justify-between">
              <span>Ver sacola ({quantidade})</span>
              <span className="tabular-nums">{brl(subtotal)}</span>
            </span>
          </Botao>
        </div>
      )}

      <footer className="bg-forno-900 text-massa-200">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          <div>
            <Logo claro />
            <p className="mt-3 max-w-xs text-sm text-massa-300">{config?.slogan}</p>
          </div>
          <div className="space-y-2 text-sm">
            <h2 className="font-display text-lg font-semibold text-massa-50">Fale com a gente</h2>
            {config?.logradouro && (
              <p className="flex gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                {config.logradouro}, {config.numero} — {config.bairro}, {config.cidade}/{config.uf}
              </p>
            )}
            {config?.telefone && (
              <a className="flex gap-2 hover:text-white" href={`tel:${soDigitos(config.telefone)}`}>
                <Phone className="mt-0.5 size-4 shrink-0" /> {telefone(config.telefone)}
              </a>
            )}
            {whats && (
              <a className="flex gap-2 hover:text-white" href={whats} target="_blank" rel="noreferrer">
                <MessageCircle className="mt-0.5 size-4 shrink-0" /> WhatsApp {telefone(config?.whatsapp)}
              </a>
            )}
            {config?.instagram && (
              <a className="flex gap-2 hover:text-white" href={`https://instagram.com/${config.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">
                <AtSign className="mt-0.5 size-4 shrink-0" /> {config.instagram.replace('@', '')} no Instagram
              </a>
            )}
          </div>
          <div className="text-sm">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-massa-50">
              <Clock className="size-4" /> Horários
            </h2>
            <dl className="mt-2 space-y-1">
              {config &&
                DIAS_SEMANA.map((dia, i) => {
                  const h = config.horarios[String(i)]
                  return (
                    <div key={dia} className={cx('flex justify-between gap-4', i === new Date().getDay() && 'font-semibold text-white')}>
                      <dt>{dia}</dt>
                      <dd className="tabular-nums">{h?.aberto ? `${h.abre.slice(0, 5)} – ${h.fecha.slice(0, 5)}` : 'Fechado'}</dd>
                    </div>
                  )
                })}
            </dl>
          </div>
        </div>
        <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-massa-400">
          © {new Date().getFullYear()} Tia Cê Pizzas ·{' '}
          <Link to="/admin" className="hover:text-white">
            Área da equipe
          </Link>
        </div>
      </footer>

      <Sacola aberta={sacola} onFechar={() => setSacola(false)} />
    </div>
  )
}
