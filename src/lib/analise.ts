// Contagem de visitas do site público. Só liga com os identificadores definidos na publicação (variáveis do GitHub):
//   VITE_CF_BEACON — Cloudflare Web Analytics: não usa cookies, não precisa pedir licença ao visitante;
//   VITE_GA_ID     — Google Analytics 4 ("G-…"): usa cookies; até o visitante aceitar, o Google só recebe
//                    contagens anônimas (modo de consentimento), como pede a LGPD.
// Painel, aplicativo do motoboy e ambiente de teste ficam de fora.

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const CF = import.meta.env.VITE_CF_BEACON as string | undefined
const GA = import.meta.env.VITE_GA_ID as string | undefined
const CHAVE_CONSENTIMENTO = 'tiace.cookies'
let iniciada = false

function lerConsentimento(): 'sim' | 'nao' | null {
  try {
    const v = localStorage.getItem(CHAVE_CONSENTIMENTO)
    return v === 'sim' || v === 'nao' ? v : null
  } catch {
    return null
  }
}

function script(src: string, extra?: (s: HTMLScriptElement) => void) {
  const s = document.createElement('script')
  s.async = true
  s.src = src
  extra?.(s)
  document.head.appendChild(s)
}

export function iniciarAnalise() {
  // a prévia da página inicial no painel abre o site dentro de um quadro: não é visita
  if (iniciada || typeof window === 'undefined' || window.self !== window.top) return
  iniciada = true
  if (CF) script('https://static.cloudflareinsights.com/beacon.min.js', (s) => (s.dataset.cfBeacon = JSON.stringify({ token: CF, spa: true })))
  if (GA) {
    window.dataLayer = window.dataLayer ?? []
    // o gtag do Google precisa receber o objeto "arguments", não uma lista
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
    window.gtag('consent', 'default', {
      analytics_storage: lerConsentimento() === 'sim' ? 'granted' : 'denied',
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    })
    window.gtag('js', new Date())
    window.gtag('config', GA)
    script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA)}`)
  }
}

/** O aviso de cookies só aparece com o Google ligado e enquanto o visitante não respondeu. */
export const precisaPerguntarCookies = () => Boolean(GA) && lerConsentimento() === null

export function responderCookies(aceitou: boolean) {
  try {
    localStorage.setItem(CHAVE_CONSENTIMENTO, aceitou ? 'sim' : 'nao')
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
  window.gtag?.('consent', 'update', { analytics_storage: aceitou ? 'granted' : 'denied' })
}

/** Evento para o Google Analytics (ex.: pedido feito); sem o Google, não faz nada. */
export function registrarEvento(nome: string, dados: Record<string, unknown>) {
  if (GA) window.gtag?.('event', nome, dados)
}
