import { Suspense, lazy } from 'react'
import { MapPin } from 'lucide-react'
import { Botao, Carregando } from '../components/ui'
import type { Ponto, PontoAchado } from '../lib/geo'
import { useLoja } from '../lib/loja'

const Mapa = lazy(() => import('../components/Mapa'))

/**
 * Mapa pequeno com o pino da entrega, para a atendente conferir onde o motoboy vai e arrastar o pino quando a busca
 * pelo endereço errar (o mapa gratuito não tem o número de todas as casas). A loja aparece junto, como referência.
 */
export function PinoDoEndereco({
  ponto, aproximado, onMudar, onLocalizar, localizando, className = 'h-48',
}: {
  ponto: Ponto | null
  aproximado?: PontoAchado['aproximado']
  onMudar: (p: Ponto) => void
  onLocalizar?: () => void
  localizando?: boolean
  className?: string
}) {
  const { config } = useLoja()
  const loja = config?.loja_lat != null && config.loja_lng != null ? { lat: Number(config.loja_lat), lng: Number(config.loja_lng) } : null
  return (
    <div className="space-y-2 text-xs">
      {ponto ? (
        <>
          {aproximado && (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-950">
              O número não está no mapa: o pino foi posto {aproximado === 'rua' ? 'na rua' : 'no meio do bairro'}. Arraste até a casa.
            </p>
          )}
          <Suspense fallback={<Carregando />}>
            <Mapa
              zoom={17}
              className={className}
              marcadores={[
                ...(loja ? [{ id: 'loja', ponto: loja, tipo: 'loja' as const, rotulo: config?.nome_loja }] : []),
                { id: 'cliente', ponto, tipo: 'cliente' as const, rotulo: 'Arraste até o lugar certo da entrega', aoArrastar: onMudar },
              ]}
            />
          </Suspense>
          <p className="text-stone-500">O pino 📍 marca onde o motoboy vai. Se estiver no lugar errado, arraste até o certo.</p>
        </>
      ) : (
        <p className="text-stone-500">O pino aparece no mapa assim que o endereço for localizado.</p>
      )}
      {onLocalizar && (
        <Botao variante="secundario" tamanho="p" carregando={localizando} onClick={onLocalizar}>
          <MapPin className="size-4" /> Localizar de novo pelo endereço
        </Botao>
      )}
    </div>
  )
}
