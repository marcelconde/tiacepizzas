import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Clock, MapPin, MessageCircle, Phone, ShoppingBag, Trash2, UserRound } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Botao, Contador, Erro, Modal, cx } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useCarrinho } from '../lib/carrinho'
import { DIAS_SEMANA, brl, cnpj, soDigitos, telefone } from '../lib/formato'
import { combosDaSacola, useLoja } from '../lib/loja'
import type { Configuracoes } from '../lib/tipos'

export const linkWhatsApp = (numero: string | null | undefined, texto = '') =>
  numero ? `https://wa.me/55${soDigitos(numero)}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : null

/** Mensagem que já identifica o pedido para a equipe. */
export const mensagemPedido = (numero: number, nome?: string | null) => `Olá! Quero falar sobre o pedido #${numero}${nome ? `, em nome de ${nome}` : ''}.`

export const linkInstagram = (usuario: string | null | undefined) => {
  const u = (usuario ?? '').trim().replace(/^@/, '')
  return u ? `https://instagram.com/${u}` : null
}

/** Cores da marca do Instagram: o botão é reconhecido de longe. */
export const CORES_INSTAGRAM = 'bg-linear-to-tr from-[#f9a23f] via-[#dd2a7b] to-[#8134af] text-white'

export function IconeInstagram({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="0.7" fill="currentColor" />
    </svg>
  )
}

/** "até 23:00" quando aberta, "abre hoje às 18:00" quando fechada. Vazio se a situação foi forçada no painel. */
function detalheHorario(config: Configuracoes | null, aberta: boolean) {
  if (!config || config.loja_aberta_manual != null) return ''
  try {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: config.fuso_horario, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
    const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
    const hoje = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parte('weekday'))
    const agora = `${parte('hour')}:${parte('minute')}`
    if (hoje < 0) return ''
    const dia = (n: number) => config.horarios[String((hoje + n + 7) % 7)]
    if (aberta) {
      // o turno em vigor é o de hoje ou, de madrugada, o que começou ontem
      const h = [dia(0), dia(-1)].find((x, i) => x?.aberto && (i === 0 ? x.abre <= agora && (x.fecha > agora || x.fecha < x.abre) : x.fecha < x.abre && agora < x.fecha))
      return h ? `até ${h.fecha.slice(0, 5)}` : ''
    }
    for (let n = 0; n <= 7; n++) {
      const h = dia(n)
      if (!h?.aberto || (n === 0 && h.abre <= agora)) continue
      const quando = n === 0 ? 'hoje' : n === 1 ? 'amanhã' : DIAS_SEMANA[(hoje + n) % 7].toLowerCase()
      return `abre ${quando} às ${h.abre.slice(0, 5)}`
    }
  } catch {
    /* navegador sem suporte a fuso horário: mostra só aberto ou fechado */
  }
  return ''
}

export function SeloAberta() {
  const { aberta } = useLoja()
  if (aberta == null) return null
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', aberta ? 'bg-manjericao-100 text-manjericao-700' : 'bg-stone-200 text-stone-700')}>
      <span className={cx('size-2 rounded-full', aberta ? 'bg-manjericao-500' : 'bg-stone-500')} />
      {aberta ? 'Aberto agora' : 'Fechado agora'}
    </span>
  )
}

/** Faixa de aberto/fechado no celular e no tablet: fica logo abaixo do cabeçalho, em todas as páginas. */
function FaixaAberta() {
  const { config, aberta } = useLoja()
  if (aberta == null) return null
  const detalhe = detalheHorario(config, aberta)
  return (
    <p role="status" className={cx('flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-semibold lg:hidden', aberta ? 'bg-manjericao-100 text-manjericao-700' : 'bg-stone-200 text-stone-700')}>
      <span className={cx('size-2.5 shrink-0 rounded-full', aberta ? 'bg-manjericao-500' : 'bg-stone-500')} />
      {aberta ? 'Aberto agora' : 'Fechado agora'}
      {detalhe && <span className="font-normal">· {detalhe}</span>}
    </p>
  )
}

function Sacola({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const { itens, subtotal, alterarQuantidade, limpar } = useCarrinho()
  const { config, aberta: lojaAberta, catalogo } = useLoja()
  const navegar = useNavigate()
  const falta = Math.max(0, Number(config?.pedido_minimo ?? 0) - subtotal)
  const combos = combosDaSacola(catalogo, itens)
  const whats = linkWhatsApp(config?.whatsapp, 'Olá! Preciso de ajuda com o meu pedido.')

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
            {combos.aplicados.map((c) => (
              <div key={c.id} className="-mt-2 mb-3 flex items-baseline justify-between text-sm font-semibold text-manjericao-700">
                <span>{c.vezes > 1 ? `${c.vezes}x ` : ''}{c.nome}</span>
                <span className="tabular-nums">− {brl(c.desconto)}</span>
              </div>
            ))}
            {combos.desconto > 0 && (
              <div className="mb-3 flex items-baseline justify-between border-t border-stone-200 pt-2">
                <span className="text-sm text-stone-600">Com o combo</span>
                <span className="text-lg font-bold tabular-nums">{brl(subtotal - combos.desconto)}</span>
              </div>
            )}
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
          <li className="flex items-center justify-between pt-3">
            <button type="button" onClick={limpar} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-red-700">
              <Trash2 className="size-4" /> Esvaziar sacola
            </button>
            {whats && (
              <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-manjericao-700 hover:underline">
                <MessageCircle className="size-4" /> Pedir ajuda
              </a>
            )}
          </li>
        </ul>
      )}
    </Modal>
  )
}

export default function SiteLayout() {
  const { config, conteudo, erro } = useLoja()
  const { sessao } = useAuth()
  const { quantidade, subtotal } = useCarrinho()
  const [sacola, setSacola] = useState(false)
  const { pathname } = useLocation()
  const noCheckout = pathname.startsWith('/checkout')
  // o botão flutuante do WhatsApp fica onde a pessoa está escolhendo; nas outras telas há um link próprio
  const comBotaoWhats = pathname === '/' || pathname.startsWith('/cardapio')
  const whats = linkWhatsApp(config?.whatsapp, 'Olá! Vim pelo site.')
  const insta = linkInstagram(config?.instagram)
  const temLogin = config?.login_google || config?.login_facebook || config?.login_email

  useEffect(() => {
    window.scrollTo(0, 0) // em navegadores novos scrollTo devolve uma Promise: não pode ser o retorno do efeito
  }, [pathname])

  const link = ({ isActive }: { isActive: boolean }) =>
    cx('rounded-lg px-2.5 py-2 text-sm font-semibold whitespace-nowrap md:px-3', isActive ? 'text-molho-700' : 'text-forno-700 hover:text-molho-700')
  const conta = (sessao || temLogin) && (
    <NavLink to={sessao ? '/conta' : '/entrar'} className={link}>
      <span className="inline-flex items-center gap-1.5">
        <UserRound className="size-4" /> {sessao ? 'Minha conta' : 'Entrar'}
      </span>
    </NavLink>
  )

  return (
    <div className="flex min-h-dvh flex-col">
      {config?.mensagem_aviso && <div className="bg-forno-900 px-4 py-2 text-center text-sm text-massa-100">{config.mensagem_aviso}</div>}
      <header className="sticky top-0 z-40 border-b border-massa-200 bg-massa-50/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link to="/" aria-label="Tia Cê Pizzas — início" className="mr-auto">
            <Logo url={conteudo?.logo_url} />
          </Link>
          <nav className="hidden items-center md:flex">
            <NavLink to="/cardapio" className={link}>
              Cardápio
            </NavLink>
            <NavLink to="/pedido" className={link}>
              Acompanhar pedido
            </NavLink>
            {conta}
          </nav>
          <div className="hidden lg:block">
            <SeloAberta />
          </div>
          {insta && (
            <a
              href={insta}
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram da pizzaria"
              title="Siga a gente no Instagram"
              className={cx('inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-opacity hover:opacity-90', CORES_INSTAGRAM)}
            >
              <IconeInstagram /> <span className="hidden sm:inline">Instagram</span>
            </a>
          )}
          {!noCheckout && (
            <Botao onClick={() => setSacola(true)} aria-label={`Abrir sacola, ${quantidade} itens`}>
              <ShoppingBag className="size-4" />
              <span className="hidden sm:inline">Sacola</span>
              {quantidade > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{quantidade}</span>}
            </Botao>
          )}
        </div>
        <nav className="sem-barra flex items-center gap-1 overflow-x-auto border-t border-massa-200 px-1 md:hidden">
          <NavLink to="/cardapio" className={link}>
            Cardápio
          </NavLink>
          <NavLink to="/pedido" className={link}>
            Acompanhar
          </NavLink>
          {conta}
        </nav>
      </header>
      <FaixaAberta />

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
        <div className="sticky bottom-0 z-30 border-t border-massa-200 bg-massa-50/95 p-3 backdrop-blur md:hidden">
          <Botao tamanho="g" className="w-full" onClick={() => setSacola(true)}>
            <span className="flex w-full justify-between">
              <span>Ver sacola ({quantidade})</span>
              <span className="tabular-nums">{brl(subtotal)}</span>
            </span>
          </Botao>
        </div>
      )}

      {whats && comBotaoWhats && (
        <a
          href={whats}
          target="_blank"
          rel="noreferrer"
          aria-label="Falar com a pizzaria no WhatsApp"
          title="Falar no WhatsApp"
          className={cx('fixed right-4 z-30 grid size-14 place-items-center rounded-full bg-manjericao-600 text-white shadow-lg transition-transform hover:scale-105', quantidade > 0 ? 'bottom-24 md:bottom-5' : 'bottom-5')}
        >
          <MessageCircle className="size-7" />
        </a>
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
            {insta && (
              <a className="flex gap-2 hover:text-white" href={insta} target="_blank" rel="noreferrer">
                <IconeInstagram className="mt-0.5 size-4 shrink-0" /> @{insta.split('/').pop()} no Instagram
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
          © {new Date().getFullYear()} Tia Cê Pizzas{config?.cnpj ? ` · CNPJ ${cnpj(config.cnpj)}` : ''} ·{' '}
          <Link to="/admin" className="hover:text-white">
            Área da equipe
          </Link>{' '}
          ·{' '}
          <Link to="/entregador" className="hover:text-white">
            Entregadores
          </Link>
        </div>
      </footer>

      <Sacola aberta={sacola} onFechar={() => setSacola(false)} />
    </div>
  )
}
