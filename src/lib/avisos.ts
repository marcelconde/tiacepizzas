// Avisos no celular do motoboy: "Pedido #123 está pronto".
// Só existem dentro do aplicativo Android gerado com o arquivo do Firebase (android/app/google-services.json).
// No navegador, e no aplicativo gerado sem esse arquivo, nada disto roda.
import { noAplicativo } from './rastreio'
import { supabase } from './supabase'

// O aplicativo abre o site publicado com "?avisos=1" (gerado com o Firebase) ou "?avisos=0". A resposta fica
// guardada para valer também quando a tela recarrega numa versão nova ou volta da tela "sem conexão".
const avisosDoAplicativo = (() => {
  try {
    const doEndereco = new URLSearchParams(location.search).get('avisos')
    if (doEndereco === '1' || doEndereco === '0') localStorage.setItem('tce_avisos', doEndereco)
    return localStorage.getItem('tce_avisos') === '1'
  } catch {
    return false
  }
})()
const temAvisos = noAplicativo && (import.meta.env.VITE_AVISOS === '1' || avisosDoAplicativo)
let aparelho: string | null = null

/**
 * Pede a permissão de notificações, registra este aparelho para o motoboy que entrou e chama `aoChegar`
 * quando um aviso chega com o aplicativo aberto ou é tocado. Devolve a função que para de ouvir.
 */
export async function ligarAvisos(aoChegar: () => void): Promise<() => void> {
  if (!temAvisos) return () => {}
  const { PushNotifications } = await import('@capacitor/push-notifications')
  // importância máxima: o aviso aparece por cima da tela e toca, mesmo com o Waze aberto
  await PushNotifications.createChannel({ id: 'pedidos', name: 'Pedidos prontos', description: 'Avisa quando um pedido seu fica pronto na pizzaria', importance: 5, visibility: 1, vibration: true })
  let permissao = await PushNotifications.checkPermissions()
  if (permissao.receive !== 'granted' && permissao.receive !== 'denied') permissao = await PushNotifications.requestPermissions()
  if (permissao.receive !== 'granted') return () => {}

  const ouvintes = [
    await PushNotifications.addListener('registration', ({ value }) => {
      aparelho = value
      supabase.rpc('entrega_aparelho', { p_token: value }).then(() => {})
    }),
    await PushNotifications.addListener('pushNotificationReceived', aoChegar),
    await PushNotifications.addListener('pushNotificationActionPerformed', aoChegar),
  ]
  await PushNotifications.register()
  return () => ouvintes.forEach((o) => void o.remove())
}

/** Ao sair da conta: este aparelho deixa de receber os avisos deste motoboy. */
export async function desligarAvisos() {
  if (!temAvisos || !aparelho) return
  await supabase.rpc('entrega_aparelho', { p_token: aparelho, p_ligar: false }).then(() => {}, () => {})
  aparelho = null
}
