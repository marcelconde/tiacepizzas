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
  cep?: string | null
}

export interface EnderecoDoCep {
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

/** Endereço de um CEP (ViaCEP). Devolve null quando o CEP não existe; lança erro quando o serviço não responde. */
export async function consultarCep(cep: string): Promise<EnderecoDoCep | null> {
  const r = await fetch(`https://viacep.com.br/ws/${cep.replace(/\D/g, '')}/json/`).then((x) => x.json())
  if (r.erro) return null
  return { logradouro: r.logradouro ?? '', bairro: r.bairro ?? '', cidade: r.localidade ?? '', uf: r.uf ?? '' }
}

const BASE = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=5&addressdetails=1&accept-language=pt-BR'
const soNumeros = (s: unknown) => String(s ?? '').replace(/\D/g, '')

interface Achado extends Ponto {
  numero: string
  cep: string
}

async function consultar(parametros: Record<string, string>, perto?: Ponto | null): Promise<Achado[]> {
  const filtros = new URLSearchParams(Object.entries(parametros).filter(([, v]) => v))
  if (perto) {
    // só vale resultado a até uns 55 km do ponto de referência: sem isto, uma rua de mesmo nome em outra cidade ganha
    filtros.set('viewbox', [perto.lng - 0.5, perto.lat + 0.5, perto.lng + 0.5, perto.lat - 0.5].map((n) => n.toFixed(4)).join(','))
    filtros.set('bounded', '1')
  }
  const r = await fetch(`${BASE}&${filtros}`).then((x) => (x.ok ? x.json() : []))
  return (Array.isArray(r) ? r : []).map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), numero: String(x.address?.house_number ?? '').trim().toLowerCase(), cep: soNumeros(x.address?.postcode) }))
}

/**
 * Converte um endereço em coordenadas. Devolve null quando não encontra.
 * `perto` (o ponto da loja) limita a busca à região. Entre os resultados, vale primeiro a casa com o número
 * pedido, depois o trecho da rua com o mesmo CEP e só então o primeiro da lista.
 */
export async function localizarEndereco(e: EnderecoBusca, perto?: Ponto | null): Promise<Ponto | null> {
  const rua = e.logradouro?.trim()
  if (!rua) return null
  const numero = String(e.numero ?? '').trim().toLowerCase()
  const cep = soNumeros(e.cep)
  const cidade = e.cidade?.trim() ?? ''
  const uf = e.uf?.trim() ?? ''
  const chave = `tiace.geo.${[rua, numero, e.bairro, cidade, uf, cep, perto?.lat.toFixed(3), perto?.lng.toFixed(3)].join('|').toLowerCase()}`
  try {
    const salvo = sessionStorage.getItem(chave)
    if (salvo) return JSON.parse(salvo)
  } catch {
    /* sem armazenamento de sessão: segue consultando */
  }
  const escolher = (lista: Achado[]) => lista.find((x) => numero && x.numero === numero) ?? lista.find((x) => cep.length === 8 && x.cep === cep) ?? lista[0] ?? null
  try {
    const comNumero = [numero, rua].filter(Boolean).join(' ')
    let achado = escolher(await consultar({ street: comNumero, city: cidade, state: uf }, perto))
    // a cidade informada pode não ser a do endereço (cliente de cidade vizinha que não digitou o CEP)
    if (!achado && cidade && perto) achado = escolher(await consultar({ street: comNumero, state: uf }, perto))
    if (!achado) achado = escolher(await consultar({ q: [rua, e.bairro?.trim(), cidade, uf, 'Brasil'].filter(Boolean).join(', ') }, perto))
    if (!achado) return null
    const ponto: Ponto = { lat: achado.lat, lng: achado.lng }
    try {
      sessionStorage.setItem(chave, JSON.stringify(ponto))
    } catch {
      /* idem */
    }
    return ponto
  } catch {
    return null
  }
}

// Trajeto de carro/moto pelo serviço de rotas do OpenStreetMap (OSRM): gratuito e sem chave, para uso leve.
// Dois servidores públicos, um de reserva do outro. Sem resposta, o banco estima pela linha reta.
const ROTAS = ['https://router.project-osrm.org/route/v1/driving/', 'https://routing.openstreetmap.de/routed-car/route/v1/driving/']

/** Distância pelas ruas, em km, de `origem` até `destino`. Devolve null quando nenhum serviço responde. */
export async function distanciaPelasRuas(origem: Ponto, destino: Ponto): Promise<number | null> {
  const r5 = (n: number) => n.toFixed(5)
  const chave = `tiace.rota.${r5(origem.lat)},${r5(origem.lng)};${r5(destino.lat)},${r5(destino.lng)}`
  try {
    const salvo = sessionStorage.getItem(chave)
    if (salvo) return Number(salvo)
  } catch {
    /* sem armazenamento de sessão: segue consultando */
  }
  for (const base of ROTAS) {
    const limite = new AbortController()
    const t = setTimeout(() => limite.abort(), 5000)
    try {
      const r = await fetch(`${base}${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=false`, { signal: limite.signal }).then((x) => (x.ok ? x.json() : null))
      const metros = r?.code === 'Ok' ? Number(r.routes?.[0]?.distance) : NaN
      if (metros >= 0) {
        const km = Math.round(metros / 10) / 100
        try {
          sessionStorage.setItem(chave, String(km))
        } catch {
          /* idem */
        }
        return km
      }
    } catch {
      /* tenta o próximo servidor */
    } finally {
      clearTimeout(t)
    }
  }
  return null
}

const NUMERO = String.raw`(-?\d{1,3}(?:[.,]\d+)?)`
// em link vale o ponto marcado (!3d…!4d…), depois a busca (q=, ll=…), o começo de um trajeto (/dir/…) e por fim o centro da tela (@…)
const NO_LINK = [
  new RegExp(String.raw`!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)`),
  new RegExp(String.raw`[?&](?:q|ll|query|destination|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)`),
  new RegExp(String.raw`/dir/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)`),
  new RegExp(String.raw`@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)`),
]
// números sozinhos: "-7.99850, -34.84403", "-7,99850; -34,84403" ou separados por espaço
const SOZINHOS = [new RegExp(`^${NUMERO}\\s*[;,]\\s+${NUMERO}$`), new RegExp(`^${NUMERO}\\s*;\\s*${NUMERO}$`), new RegExp(`^(-?\\d{1,3}\\.\\d+),(-?\\d{1,3}\\.\\d+)$`), new RegExp(`^${NUMERO}\\s+${NUMERO}$`)]

/** Lê um ponto colado do Google Maps: os números ("-7.99850, -34.84403") ou um link que os contenha. */
export function lerCoordenadas(texto: string): Ponto | null {
  let s = texto.trim()
  try {
    s = decodeURIComponent(s)
  } catch {
    /* texto com % solto: usa como veio */
  }
  for (const re of /^https?:/i.test(s) ? NO_LINK : SOZINHOS) {
    const m = s.match(re)
    if (!m) continue
    const lat = Number(m[1].replace(',', '.'))
    const lng = Number(m[2].replace(',', '.'))
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) return { lat, lng }
  }
  return null
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
