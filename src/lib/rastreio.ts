// Posição do entregador durante a entrega.
// Dentro do aplicativo Android (Tia Cê Entregas) usa o GPS em segundo plano: continua enviando com o Waze
// aberto ou a tela apagada, com um aviso fixo nas notificações — como nos aplicativos de corrida.
// No navegador usa o GPS da página, que o celular só deixa funcionar com a tela aberta.
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import type { Ponto } from './geo'

export const noAplicativo = Capacitor.isNativePlatform()
const GpsNativo = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export type FalhaGps = 'negado' | 'indisponivel'

/** Começa a acompanhar a posição; devolve a função que para. */
export function acompanharPosicao(aoMudar: (p: Ponto) => void, aoFalhar: (f: FalhaGps) => void): () => void {
  if (noAplicativo) {
    let parado = false
    const pedido = GpsNativo.addWatcher(
      {
        backgroundTitle: 'Tia Cê Entregas',
        backgroundMessage: 'Enviando sua localização ao cliente durante a entrega.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0, // também parado no semáforo: é o que mantém a posição "recente" para o cliente
      },
      (posicao, erro) => {
        if (parado) return
        if (erro) aoFalhar(erro.code === 'NOT_AUTHORIZED' ? 'negado' : 'indisponivel')
        else if (posicao) aoMudar({ lat: posicao.latitude, lng: posicao.longitude })
      },
    )
    pedido.catch(() => aoFalhar('indisponivel'))
    return () => {
      parado = true
      pedido.then((id) => GpsNativo.removeWatcher({ id })).catch(() => {})
    }
  }
  if (!('geolocation' in navigator)) {
    aoFalhar('indisponivel')
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => aoMudar({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (e) => aoFalhar(e.code === e.PERMISSION_DENIED ? 'negado' : 'indisponivel'),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
