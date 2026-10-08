// Localização de endereços com o OpenStreetMap (serviço Nominatim): gratuito e sem chave.
// A política de uso pede no máximo uma consulta por segundo, por isso o resultado fica guardado na sessão.

export interface Ponto {
  lat: number
  lng: number
}

interface EnderecoBusca {
  logradouro: string
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
}

const BASE = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=1&accept-language=pt-BR'

async function consultar(parametros: Record<string, string>): Promise<Ponto | null> {
  const url = `${BASE}&${new URLSearchParams(parametros)}`
  const r = await fetch(url).then((x) => (x.ok ? x.json() : []))
  return r?.[0] ? { lat: Number(r[0].lat), lng: Number(r[0].lon) } : null
}

/** Converte um endereço em coordenadas. Devolve null quando não encontra. */
export async function localizarEndereco(e: EnderecoBusca): Promise<Ponto | null> {
  if (!e.logradouro?.trim()) return null
  const chave = `tiace.geo.${[e.logradouro, e.numero, e.bairro, e.cidade, e.uf].join('|').toLowerCase()}`
  try {
    const salvo = sessionStorage.getItem(chave)
    if (salvo) return JSON.parse(salvo)
  } catch {
    /* sem armazenamento de sessão: segue consultando */
  }
  try {
    const rua = [e.numero, e.logradouro].filter(Boolean).join(' ')
    const ponto =
      (await consultar({ street: rua, city: e.cidade ?? '', state: e.uf ?? '' })) ??
      (await consultar({ q: [e.logradouro, e.bairro, e.cidade, e.uf, 'Brasil'].filter(Boolean).join(', ') }))
    if (ponto) {
      try {
        sessionStorage.setItem(chave, JSON.stringify(ponto))
      } catch {
        /* idem */
      }
    }
    return ponto
  } catch {
    return null
  }
}

/** Distância em linha reta, em km (mesma fórmula usada no banco). */
export function distanciaKm(a: Ponto, b: Ponto) {
  const rad = (g: number) => (g * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 100) / 100
}

/** Link que abre o trajeto no Google Maps do celular. */
export const linkRota = (destino: Ponto | null, enderecoTexto: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${destino ? `${destino.lat},${destino.lng}` : encodeURIComponent(enderecoTexto)}`

/** Link que abre o Waze já navegando até o destino (pelo ponto no mapa, se houver, ou pela busca do endereço). */
export const linkWaze = (destino: Ponto | null, enderecoTexto: string) =>
  `https://waze.com/ul?${destino ? `ll=${destino.lat}%2C${destino.lng}` : `q=${encodeURIComponent(enderecoTexto)}`}&navigate=yes`
