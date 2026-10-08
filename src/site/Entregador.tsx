import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, LocateFixed, LogOut, MapPinned, MessageCircle, Navigation, Phone, RefreshCw } from 'lucide-react'
import { Login, Moldura } from '../components/Login'
import { AreaTexto, Botao, Carregando, Erro, Modal, Selo, cx, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { PAGAMENTO, STATUS, brl, enderecoTexto, haQuanto, soDigitos, telefone } from '../lib/formato'
import { linkRota, linkWaze } from '../lib/geo'
import { acompanharPosicao, noAplicativo } from '../lib/rastreio'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Endereco, FormaPagamento, StatusPedido } from '../lib/tipos'

interface Entrega {
  id: string
  numero: number
  status: StatusPedido
  cliente_nome: string
  cliente_telefone: string | null
  endereco: Endereco | null
  bairro: string | null
  lat: number | null
  lng: number | null
  total: number
  forma_pagamento: FormaPagamento
  troco_para: number | null
  pago: boolean
  observacoes: string | null
  problema_entrega: string | null
  pronto_em: string | null
  saiu_em: string | null
  itens: { nome: string; quantidade: number }[]
}

interface Painel {
  entregador: { nome: string; valor_por_entrega: number }
  entregues_hoje: number
  entregas: Entrega[]
}

/**
 * Aplicativo do entregador (abre no navegador do celular e pode ser adicionado à tela inicial).
 * Mostra só as entregas atribuídas a ele e, com uma entrega na rua, envia a posição a cada 15 segundos
 * para o cliente acompanhar no mapa. O navegador só envia a posição com esta tela aberta: enquanto o
 * motoboy estiver no Waze ou no Google Maps o envio pausa, e volta quando ele retorna aqui.
 * Dentro do aplicativo Android (Tia Cê Entregas) o envio continua em segundo plano — ver lib/rastreio.ts.
 */
export default function Entregador() {
  const { sessao, carregando: carregandoSessao, sair } = useAuth()
  const aviso = useAviso()
  const [painel, setPainel] = useState<Painel | null>(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [problema, setProblema] = useState<Entrega | null>(null)
  const [texto, setTexto] = useState('')
  const [gps, setGps] = useState<'desligado' | 'ativo' | 'negado' | 'indisponivel'>('desligado')
  const ultimoEnvio = useRef(0)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('minhas_entregas')
    if (error) setErro(mensagemErro(error))
    else {
      setErro('')
      setPainel(data as Painel)
    }
  }, [])

  const usuarioId = sessao?.user.id
  useEffect(() => {
    if (!usuarioId) return
    carregar()
    const t = setInterval(carregar, 20_000)
    return () => clearInterval(t)
  }, [usuarioId, carregar])

  // a posição só é enviada enquanto há entrega na rua
  const naRua = Boolean(painel?.entregas.some((e) => e.status === 'saiu_entrega'))
  useEffect(() => {
    if (!naRua) {
      setGps('desligado')
      return
    }
    return acompanharPosicao((p) => {
      setGps('ativo')
      if (Date.now() - ultimoEnvio.current < 15_000) return
      ultimoEnvio.current = Date.now()
      supabase.rpc('entrega_posicao', { p_lat: p.lat, p_lng: p.lng }).then(() => {})
    }, setGps)
  }, [naRua])

  useEffect(() => {
    // com entrega na rua, a tela não apaga sozinha enquanto o aplicativo estiver à vista
    if (!naRua || !('wakeLock' in navigator)) return
    let trava: WakeLockSentinel | null = null
    const pedir = () => {
      if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').then((t) => (trava = t), () => {})
    }
    pedir()
    document.addEventListener('visibilitychange', pedir)
    return () => {
      document.removeEventListener('visibilitychange', pedir)
      trava?.release().catch(() => {})
    }
  }, [naRua])

  useEffect(() => {
    // ícone e nome próprios ao adicionar esta tela à tela inicial do celular
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const anterior = link?.href
    if (link) link.href = '/entregador.webmanifest'
    return () => {
      if (link && anterior) link.href = anterior
    }
  }, [])

  async function acao(e: Entrega, tipo: 'sair' | 'entregar' | 'problema', obs?: string) {
    setOcupado(e.id)
    const { error } = await supabase.rpc('entrega_acao', { p_pedido: e.id, p_acao: tipo, p_obs: obs ?? null })
    setOcupado('')
    if (error) return aviso.erro(mensagemErro(error))
    if (tipo === 'entregar') aviso.sucesso(`Pedido #${e.numero} entregue`)
    setProblema(null)
    setTexto('')
    carregar()
  }

  if (carregandoSessao) return <Carregando />
  if (!sessao) return <Login titulo="Entregadores" voltarPara="/entregador" />
  if (erro && !painel) {
    return (
      <Moldura>
        <Erro>{erro}</Erro>
        <p className="mt-3 text-sm text-stone-600">Esta área é só para entregadores cadastrados. Peça para a administradora liberar seu acesso.</p>
        <div className="mt-5 flex gap-2">
          <Botao variante="secundario" className="flex-1" onClick={sair}>
            Sair
          </Botao>
          <Link to="/admin" className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-stone-300 text-sm font-semibold">
            Ir para o painel
          </Link>
        </div>
      </Moldura>
    )
  }
  if (!painel) return <Carregando />

  const aviso_gps = {
    desligado: null,
    ativo: {
      cor: 'bg-manjericao-100 text-manjericao-700',
      texto: noAplicativo ? 'Enviando sua localização ao cliente. Pode abrir o Waze: o envio continua.' : 'Enviando sua localização ao cliente enquanto esta tela está aberta.',
    },
    negado: { cor: 'bg-red-100 text-red-900', texto: `Localização bloqueada. Libere o acesso à localização nas permissões do ${noAplicativo ? 'aplicativo' : 'navegador'}.` },
    indisponivel: { cor: 'bg-amber-100 text-amber-900', texto: 'Não foi possível obter a localização deste aparelho.' },
  }[gps]

  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-stone-100 pb-10">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-forno-900 px-4 py-3 text-massa-50">
        <div>
          <p className="font-display text-lg leading-tight font-semibold">Olá, {painel.entregador.nome.split(' ')[0]}</p>
          <p className="text-xs text-massa-300">
            {painel.entregues_hoje} entrega(s) hoje
            {Number(painel.entregador.valor_por_entrega) > 0 && ` · ${brl(painel.entregues_hoje * Number(painel.entregador.valor_por_entrega))} a receber`}
          </p>
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label="Atualizar" onClick={carregar} className="grid size-11 place-items-center rounded-lg hover:bg-white/10">
            <RefreshCw className="size-5" />
          </button>
          <button type="button" aria-label="Sair" onClick={sair} className="grid size-11 place-items-center rounded-lg hover:bg-white/10">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {aviso_gps && (
        <p className={cx('flex items-center gap-2 px-4 py-2 text-sm font-semibold', aviso_gps.cor)}>
          <LocateFixed className="size-4 shrink-0" /> {aviso_gps.texto}
        </p>
      )}
      {gps === 'ativo' && !noAplicativo && (
        <p className="bg-amber-50 px-4 py-2 text-xs text-amber-900">
          No navegador, o envio pausa enquanto o Waze ou o Maps estiver aberto. Para continuar enviando, use o aplicativo Tia Cê Entregas (Android).
        </p>
      )}

      <main className="space-y-3 p-3">
        {erro && <Erro>{erro}</Erro>}
        {painel.entregas.length === 0 && (
          <div className="rounded-2xl bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-manjericao-600" />
            <p className="mt-3 font-semibold">Nenhuma entrega atribuída a você agora.</p>
            <p className="mt-1 text-sm text-stone-500">Esta tela se atualiza sozinha a cada 20 segundos.</p>
          </div>
        )}

        {painel.entregas.map((e) => {
          const endereco = enderecoTexto(e.endereco)
          const destino = e.lat != null && e.lng != null ? { lat: Number(e.lat), lng: Number(e.lng) } : null
          const cobrar = !e.pago
          return (
            <article key={e.id} className={cx('rounded-2xl border-2 bg-white p-4', e.status === 'saiu_entrega' ? 'border-violet-400' : e.status === 'problema_entrega' ? 'border-red-400' : 'border-transparent')}>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold">#{e.numero}</span>
                <Selo className={STATUS[e.status].cor}>{STATUS[e.status].rotulo}</Selo>
              </div>
              <p className="mt-2 font-semibold">{e.cliente_nome}</p>
              <p className="text-lg leading-snug font-semibold">{endereco}</p>
              {e.endereco?.referencia && <p className="text-sm text-stone-600">Ref.: {e.endereco.referencia}</p>}
              {e.observacoes && <p className="mt-2 rounded-lg bg-queijo-300/40 px-3 py-2 text-sm font-semibold">Obs.: {e.observacoes}</p>}
              {e.problema_entrega && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">Problema: {e.problema_entrega}</p>}

              <div className={cx('mt-3 rounded-lg px-3 py-2 text-sm', cobrar ? 'bg-amber-50 text-amber-900' : 'bg-manjericao-100 text-manjericao-700')}>
                {cobrar ? (
                  <>
                    <b className="text-base">Cobrar {brl(e.total)}</b> · {PAGAMENTO[e.forma_pagamento]}
                    {e.forma_pagamento === 'dinheiro' && e.troco_para && <span className="block font-semibold">Levar troco de {brl(e.troco_para - e.total)} (paga com {brl(e.troco_para)})</span>}
                  </>
                ) : (
                  <b>Já está pago — não cobrar</b>
                )}
              </div>
              <p className="mt-2 text-sm text-stone-600">{e.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(' · ')}</p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={linkWaze(destino, endereco)} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-stone-300 text-sm font-semibold">
                  <Navigation className="size-4" /> Waze
                </a>
                <a href={linkRota(destino, endereco)} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-stone-300 text-sm font-semibold">
                  <MapPinned className="size-4" /> Google Maps
                </a>
                {e.cliente_telefone && (
                  <>
                    <a href={`tel:${soDigitos(e.cliente_telefone)}`} title={telefone(e.cliente_telefone)} className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-stone-300 text-sm font-semibold">
                      <Phone className="size-4" /> Ligar
                    </a>
                    <a href={`https://wa.me/55${soDigitos(e.cliente_telefone)}?text=${encodeURIComponent(`Olá! Sou o entregador da pizzaria, estou com o seu pedido #${e.numero}.`)}`} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-stone-300 text-sm font-semibold">
                      <MessageCircle className="size-4" /> WhatsApp
                    </a>
                  </>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {e.status === 'em_preparo' && <p className="rounded-lg bg-stone-100 px-3 py-3 text-center text-sm font-semibold text-stone-600">Na cozinha — aguarde ficar pronto</p>}
                {(e.status === 'pronto' || e.status === 'problema_entrega') && (
                  <Botao tamanho="g" className="w-full" carregando={ocupado === e.id} onClick={() => acao(e, 'sair')}>
                    <MapPinned className="size-5" /> {e.status === 'pronto' ? 'Saí para entregar' : 'Tentar entregar de novo'}
                  </Botao>
                )}
                {e.status === 'saiu_entrega' && (
                  <>
                    <p className="text-center text-xs text-stone-500">Saiu há {haQuanto(e.saiu_em ?? e.pronto_em ?? new Date().toISOString())}</p>
                    <Botao variante="verde" tamanho="g" className="w-full" carregando={ocupado === e.id} onClick={() => acao(e, 'entregar')}>
                      <CheckCircle2 className="size-5" /> {cobrar ? 'Entreguei e recebi' : 'Entreguei'}
                    </Botao>
                    <Botao variante="perigo" tamanho="g" className="w-full" onClick={() => setProblema(e)}>
                      <AlertTriangle className="size-5" /> Tive um problema
                    </Botao>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </main>

      <Modal
        aberto={problema != null}
        titulo={`Problema na entrega #${problema?.numero ?? ''}`}
        onFechar={() => setProblema(null)}
        rodape={
          <Botao variante="perigo" tamanho="g" className="w-full" disabled={!texto.trim()} carregando={ocupado === problema?.id} onClick={() => acao(problema!, 'problema', texto)}>
            Avisar a pizzaria
          </Botao>
        }
      >
        <p className="mb-3 text-sm text-stone-600">Conte o que aconteceu. A pizzaria e o cliente são avisados na hora.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {['Cliente não atende', 'Endereço não encontrado', 'Cliente recusou o pedido', 'Problema com a moto'].map((m) => (
            <button key={m} type="button" onClick={() => setTexto(m)} className="rounded-full border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-50">
              {m}
            </button>
          ))}
        </div>
        <AreaTexto rows={3} maxLength={300} placeholder="Descreva o problema" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Modal>
    </div>
  )
}
