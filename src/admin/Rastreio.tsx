import { Suspense, lazy, useEffect, useState } from 'react'
import { MessageCircle, Phone } from 'lucide-react'
import type { Marcador } from '../components/Mapa'
import { Carregando, Erro, Modal, cx } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { enderecoTexto, haQuanto, soDigitos, telefone } from '../lib/formato'
import { distanciaKm } from '../lib/geo'
import { useLoja } from '../lib/loja'
import { supabase } from '../lib/supabase'
import type { Endereco, StatusPedido } from '../lib/tipos'

const Mapa = lazy(() => import('../components/Mapa'))

interface Rastreado {
  id: string
  numero: number
  status: StatusPedido
  cliente_nome: string
  endereco: Endereco | null
  lat: number | null
  lng: number | null
  entregadores: { nome: string; telefone: string | null; usuario_id: string | null; lat: number | null; lng: number | null; posicao_em: string | null } | null
}

// o celular envia a posição a cada 15 a 30 segundos; passou disto, algo o impediu (sem internet, aplicativo fechado)
const SEM_SINAL_MS = 2 * 60_000
const quando = (iso: string) => (haQuanto(iso) === 'agora' ? 'agora há pouco' : `há ${haQuanto(iso)}`)

/** Onde está o motoboy de uma entrega: loja, destino e a última posição enviada pelo celular dele, atualizada sozinha. */
export function RastreioEntrega({ pedidoId, onFechar }: { pedidoId: string | null; onFechar: () => void }) {
  const { config } = useLoja()
  const [, setRelogio] = useState(0)
  const { dados, carregando, erro, recarregar } = useConsulta<Rastreado | null>(
    () =>
      pedidoId
        ? supabase.from('pedidos').select('id, numero, status, cliente_nome, endereco, lat, lng, entregadores(nome, telefone, usuario_id, lat, lng, posicao_em)').eq('id', pedidoId).single()
        : Promise.resolve({ data: null, error: null }),
    [pedidoId],
  )
  useEffect(() => {
    if (!pedidoId) return
    const t = setInterval(() => {
      recarregar()
      setRelogio((n) => n + 1)
    }, 10_000)
    return () => clearInterval(t)
  }, [pedidoId, recarregar])

  if (!pedidoId) return null
  const p = dados?.id === pedidoId ? dados : null
  const m = p?.entregadores ?? null
  const ponto = (lat: unknown, lng: unknown) => (lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null)
  const loja = ponto(config?.loja_lat, config?.loja_lng)
  const destino = ponto(p?.lat, p?.lng)
  const posicao = m?.posicao_em ? ponto(m.lat, m.lng) : null
  const naRua = p?.status === 'saiu_entrega' || p?.status === 'problema_entrega'
  const semSinal = Boolean(posicao) && Date.now() - new Date(m!.posicao_em!).getTime() > SEM_SINAL_MS
  const falta = posicao && destino && naRua ? distanciaKm(posicao, destino) : null
  const marcadores: Marcador[] = [
    ...(loja ? [{ id: 'loja', ponto: loja, tipo: 'loja' as const, rotulo: config?.nome_loja }] : []),
    ...(destino ? [{ id: 'cliente', ponto: destino, tipo: 'cliente' as const, rotulo: p?.cliente_nome }] : []),
    ...(posicao ? [{ id: 'motoboy', ponto: posicao, tipo: 'motoboy' as const, rotulo: m!.nome }] : []),
  ]
  const fone = soDigitos(m?.telefone)

  return (
    <Modal aberto largura="max-w-2xl" onFechar={onFechar} titulo={p ? `Rastrear entrega · Pedido #${p.numero}` : 'Rastrear entrega'}>
      {erro && <Erro>{erro}</Erro>}
      {carregando && !p ? (
        <Carregando />
      ) : (
        p && (
          <div className="space-y-3 text-sm">
            {!m ? (
              <Erro>Este pedido ainda não tem motoboy escolhido. Escolha em “Motoboy responsável”, nos detalhes do pedido.</Erro>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <p className="text-base font-semibold">{m.nome}</p>
                  {fone && (
                    <>
                      <a href={`tel:+55${fone}`} className="inline-flex items-center gap-1 font-semibold text-forno-600 hover:underline">
                        <Phone className="size-4" /> {telefone(m.telefone)}
                      </a>
                      <a href={`https://wa.me/55${fone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-manjericao-700 hover:underline">
                        <MessageCircle className="size-4" /> WhatsApp
                      </a>
                    </>
                  )}
                </div>
                {!m.usuario_id ? (
                  <Erro>{m.nome} não tem acesso ao aplicativo de entregas, por isso não dá para ver onde está. Crie o acesso em Configurações → Usuários.</Erro>
                ) : !posicao ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
                    Ainda não chegou nenhuma posição do celular de {m.nome}. Ela começa a chegar quando ele toca em “Saí para entregar” no aplicativo, com a localização permitida.
                  </p>
                ) : !naRua ? (
                  <p className="rounded-lg bg-stone-100 px-3 py-2 text-stone-700">
                    Este pedido ainda não saiu para entrega. O mapa mostra a última posição que o celular de {m.nome} enviou, {quando(m.posicao_em!)}.
                  </p>
                ) : (
                  <p role="status" className={cx('flex items-start gap-2 rounded-lg px-3 py-2', semSinal ? 'bg-amber-50 text-amber-950' : 'bg-emerald-50 text-emerald-950')}>
                    <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', semSinal ? 'bg-amber-500' : 'bg-emerald-500')} />
                    <span>
                      {semSinal ? (
                        <>
                          <b>Sem sinal {quando(m.posicao_em!)}.</b> O mapa mostra a última posição recebida. Pode ser falta de internet ou o aplicativo fechado no celular de {m.nome}.
                        </>
                      ) : (
                        <>
                          <b>Posição recebida {quando(m.posicao_em!)}.</b> O mapa se atualiza sozinho.
                        </>
                      )}
                      {falta != null && ` Faltam cerca de ${falta.toFixed(1).replace('.', ',')} km até o cliente, em linha reta.`}
                    </span>
                  </p>
                )}
              </>
            )}
            {marcadores.length > 0 && (
              <Suspense fallback={<Carregando />}>
                <Mapa marcadores={marcadores} className="h-80" />
              </Suspense>
            )}
            <p className="text-stone-600">
              <b>Destino:</b> {p.cliente_nome} — {enderecoTexto(p.endereco)}
              {!destino && ' (este endereço não foi localizado no mapa)'}
            </p>
            <p className="text-xs text-stone-500">🍕 loja · 📍 cliente · 🛵 motoboy</p>
          </div>
        )
      )}
    </Modal>
  )
}
