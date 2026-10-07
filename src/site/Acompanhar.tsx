import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { Botao, Carregando, Entrada, Erro, cx } from '../components/ui'
import { PAGAMENTO, brl, dataHora, hora } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { FormaPagamento, StatusPedido, TipoPedido } from '../lib/tipos'
import { pedidosSalvos } from './Checkout'
import { linkWhatsApp } from './SiteLayout'

interface Acompanhamento {
  numero: number
  codigo: string
  status: StatusPedido
  tipo: TipoPedido
  nome: string
  bairro: string | null
  subtotal: number
  taxa_entrega: number
  desconto: number
  total: number
  forma_pagamento: FormaPagamento
  troco_para: number | null
  pago: boolean
  previsao_em: string | null
  criado_em: string
  confirmado_em: string | null
  preparo_em: string | null
  pronto_em: string | null
  saiu_em: string | null
  entregue_em: string | null
  motivo_cancelamento: string | null
  entregador: string | null
  itens: { nome: string; quantidade: number; total: number; adicionais: { nome: string }[]; observacoes: string | null }[]
}

function etapas(p: Acompanhamento) {
  const lista: { status: StatusPedido; titulo: string; texto: string; quando: string | null }[] = [
    { status: 'novo', titulo: 'Pedido enviado', texto: 'Aguardando a pizzaria confirmar.', quando: p.criado_em },
    { status: 'confirmado', titulo: 'Pedido confirmado', texto: 'Já está na fila da cozinha.', quando: p.confirmado_em },
    { status: 'em_preparo', titulo: 'Em preparo', texto: 'Sua pizza está sendo montada e vai para o forno.', quando: p.preparo_em },
    {
      status: 'pronto',
      titulo: p.tipo === 'entrega' ? 'Pronto, aguardando entregador' : 'Pronto para retirada',
      texto: p.tipo === 'entrega' ? 'Saiu do forno e já vai ser despachado.' : 'Pode vir buscar, está quentinho!',
      quando: p.pronto_em,
    },
  ]
  if (p.tipo === 'entrega') {
    lista.push({ status: 'saiu_entrega', titulo: 'Saiu para entrega', texto: p.entregador ? `${p.entregador} está a caminho.` : 'O entregador está a caminho.', quando: p.saiu_em })
  }
  lista.push({ status: 'entregue', titulo: p.tipo === 'entrega' ? 'Entregue' : 'Retirado', texto: 'Bom apetite!', quando: p.entregue_em })
  return lista
}

function Buscar() {
  const [codigo, setCodigo] = useState('')
  const navegar = useNavigate()
  const recentes = pedidosSalvos()
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (codigo.trim()) navegar(`/pedido?c=${codigo.trim().toUpperCase()}`)
  }
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-4xl font-bold">Acompanhar pedido</h1>
      <p className="mt-2 text-stone-600">Digite o código que apareceu quando você finalizou o pedido.</p>
      <form onSubmit={enviar} className="mt-6 flex gap-2">
        <Entrada aria-label="Código do pedido" placeholder="Ex.: K7M2QX4P" className="tracking-widest uppercase" maxLength={8} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <Botao type="submit">Acompanhar</Botao>
      </form>
      {recentes.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-xl font-semibold">Seus últimos pedidos</h2>
          <ul className="mt-3 divide-y divide-massa-200 rounded-xl border border-massa-200 bg-white">
            {recentes.map((r) => (
              <li key={r.codigo}>
                <Link to={`/pedido?c=${r.codigo}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-massa-50">
                  <span className="font-semibold">Pedido #{r.numero}</span>
                  <span className="text-stone-500">{dataHora(r.criado_em)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function Acompanhar() {
  const [params] = useSearchParams()
  const codigo = params.get('c')?.trim().toUpperCase() ?? ''
  const { config } = useLoja()
  const [pedido, setPedido] = useState<Acompanhamento | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'nao_encontrado' | 'erro'>('carregando')
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)

  const finalizado = pedido?.status === 'entregue' || pedido?.status === 'cancelado'
  useEffect(() => {
    if (!codigo) return
    let vivo = true
    async function buscar() {
      const { data, error } = await supabase.rpc('acompanhar_pedido', { p_codigo: codigo })
      if (!vivo) return
      if (error) {
        setErro(mensagemErro(error))
        setEstado((e) => (e === 'ok' ? 'ok' : 'erro')) // falha passageira não apaga o que já está na tela
      } else if (!data) setEstado('nao_encontrado')
      else {
        setPedido(data as Acompanhamento)
        setEstado('ok')
      }
    }
    buscar()
    if (finalizado) return
    const t = setInterval(buscar, 15_000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [codigo, finalizado])

  if (!codigo) return <Buscar />
  if (estado === 'carregando') return <Carregando texto="Buscando seu pedido…" />
  if (estado === 'erro') return <div className="mx-auto max-w-md px-4 py-16"><Erro>{erro}</Erro></div>
  if (estado === 'nao_encontrado' || !pedido) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold">Pedido não encontrado</h1>
        <p className="mt-2 text-stone-600">Confira o código “{codigo}” e tente de novo.</p>
        <Link to="/pedido" className="mt-4 inline-block font-semibold text-molho-700 underline">
          Digitar outro código
        </Link>
      </div>
    )
  }

  const passos = etapas(pedido)
  const titulos: Record<StatusPedido, string> = {
    novo: `Recebemos seu pedido, ${pedido.nome}!`,
    confirmado: `Pedido confirmado, ${pedido.nome}!`,
    em_preparo: `${pedido.nome}, sua pizza está no forno`,
    pronto: pedido.tipo === 'entrega' ? 'Prontinho! Já vai sair para entrega' : `Pode vir buscar, ${pedido.nome}!`,
    saiu_entrega: `${pedido.nome}, seu pedido está a caminho`,
    entregue: `Bom apetite, ${pedido.nome}!`,
    cancelado: 'Pedido cancelado',
  }
  const atual = passos.findIndex((e) => e.status === pedido.status)
  const cancelado = pedido.status === 'cancelado'
  const whats = linkWhatsApp(config?.whatsapp, `Olá! Sobre o pedido #${pedido.numero} (${pedido.codigo})`)
  const pix = pedido.forma_pagamento === 'pix' && !pedido.pago && !cancelado ? config?.chave_pix : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-sm font-semibold text-molho-700">
        Pedido #{pedido.numero} · código {pedido.codigo}
      </p>
      <h1 className="mt-1 font-display text-4xl font-bold text-balance">
        {titulos[pedido.status]}
      </h1>
      {!finalizado && pedido.previsao_em && (
        <p className="mt-2 text-stone-600">
          Previsão de {pedido.tipo === 'entrega' ? 'entrega' : 'retirada'}: <b className="text-forno-900">por volta das {hora(pedido.previsao_em)}</b>
        </p>
      )}

      {cancelado ? (
        <div className="mt-6">
          <Erro>
            {pedido.motivo_cancelamento ? `Motivo: ${pedido.motivo_cancelamento}` : 'Este pedido foi cancelado.'} Qualquer dúvida, fale com a gente.
          </Erro>
        </div>
      ) : (
        <ol className="mt-8">
          {passos.map((e, i) => {
            const feito = i <= atual
            return (
              <li key={e.status} className="relative flex gap-4 pb-7 last:pb-0">
                {i < passos.length - 1 && <span className={cx('absolute top-8 left-[15px] h-full w-0.5', i < atual ? 'bg-manjericao-500' : 'bg-stone-200')} />}
                <span
                  className={cx(
                    'z-10 grid size-8 shrink-0 place-items-center rounded-full border-2',
                    feito ? 'border-manjericao-600 bg-manjericao-600 text-white' : 'border-stone-300 bg-white',
                    i === atual && !finalizado && 'pulsar-novo',
                  )}
                >
                  {feito && <Check className="size-4" />}
                </span>
                <div className={cx(!feito && 'opacity-50')}>
                  <p className="font-semibold text-forno-900">
                    {e.titulo} {feito && e.quando && <span className="ml-1 text-sm font-normal text-stone-500 tabular-nums">{hora(e.quando)}</span>}
                  </p>
                  {i === atual && <p className="text-sm text-stone-600">{e.texto}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {pix && (
        <section className="mt-8 rounded-2xl border border-queijo-400 bg-queijo-300/20 p-5">
          <h2 className="font-display text-xl font-semibold">Pague com Pix</h2>
          <p className="mt-1 text-sm text-forno-700">
            Envie <b>{brl(pedido.total)}</b> para a chave abaixo e mande o comprovante pelo WhatsApp.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-2 text-sm break-all">{pix}</code>
            <Botao
              variante="secundario"
              onClick={() =>
                navigator.clipboard.writeText(pix).then(() => {
                  setCopiado(true)
                  setTimeout(() => setCopiado(false), 2500)
                })
              }
            >
              {copiado ? <Check className="size-4" /> : <Copy className="size-4" />} {copiado ? 'Copiada' : 'Copiar chave'}
            </Botao>
          </div>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-massa-200 bg-white p-5">
        <h2 className="font-display text-xl font-semibold">Resumo</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {pedido.itens.map((i, n) => (
            <li key={n} className="flex justify-between gap-3">
              <span>
                <b>{i.quantidade}x</b> {i.nome}
                {i.adicionais.length > 0 && <span className="block text-stone-500">+ {i.adicionais.map((a) => a.nome).join(', ')}</span>}
                {i.observacoes && <span className="block text-stone-500 italic">“{i.observacoes}”</span>}
              </span>
              <span className="tabular-nums">{brl(i.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-stone-200 pt-3 text-sm">
          {pedido.taxa_entrega > 0 && (
            <div className="flex justify-between">
              <dt>Entrega{pedido.bairro ? ` (${pedido.bairro})` : ''}</dt>
              <dd className="tabular-nums">{brl(pedido.taxa_entrega)}</dd>
            </div>
          )}
          {pedido.desconto > 0 && (
            <div className="flex justify-between text-manjericao-700">
              <dt>Desconto</dt>
              <dd className="tabular-nums">− {brl(pedido.desconto)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{brl(pedido.total)}</dd>
          </div>
          <div className="flex justify-between text-stone-600">
            <dt>Pagamento</dt>
            <dd>
              {PAGAMENTO[pedido.forma_pagamento]}
              {pedido.pago ? ' · pago' : pedido.troco_para ? ` · troco para ${brl(pedido.troco_para)}` : ''}
            </dd>
          </div>
        </dl>
      </section>

      {whats && (
        <a href={whats} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 font-semibold text-manjericao-700 hover:underline">
          <MessageCircle className="size-5" /> Falar com a pizzaria no WhatsApp
        </a>
      )}
    </div>
  )
}
