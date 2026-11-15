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
const semAcento = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
// "Travessa Coronel Frederico Lundgren" → "Coronel Frederico Lundgren": o mapa às vezes não tem a travessa, mas tem a avenida de mesmo nome ao lado
const TIPO_DE_VIA = /^(rua|r\.|avenida|av\.?|travessa|tv\.?|trav\.?|alameda|al\.?|estrada|estr?\.|rodovia|rod\.?|pra[cç]a|p[cç]a\.?|largo|beco|vila|viela|via|ladeira|passagem|caminho|servid[aã]o)\s+/i

/** Ponto no mapa. `aproximado`: o número da casa não foi achado e o ponto é o da rua de mesmo nome ou o do bairro. */
export interface PontoAchado extends Ponto {
  aproximado?: 'rua' | 'bairro'
}

interface Achado extends Ponto {
  numero: string
  cep: string
  bairro: string
}

// a política do serviço pede no máximo uma consulta por segundo
let ultimaConsulta = 0
async function consultar(parametros: Record<string, string>, perto?: Ponto | null): Promise<Achado[]> {
  const espera = ultimaConsulta + 1000 - Date.now()
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimaConsulta = Date.now()
  const filtros = new URLSearchParams(Object.entries(parametros).filter(([, v]) => v))
  if (perto) {
    // só vale resultado a até uns 55 km do ponto de referência: sem isto, uma rua de mesmo nome em outra cidade ganha
    filtros.set('viewbox', [perto.lng - 0.5, perto.lat + 0.5, perto.lng + 0.5, perto.lat - 0.5].map((n) => n.toFixed(4)).join(','))
    filtros.set('bounded', '1')
  }
  const r = await fetch(`${BASE}&${filtros}`).then((x) => (x.ok ? x.json() : []))
  return (Array.isArray(r) ? r : []).map((x) => ({
    lat: Number(x.lat), lng: Number(x.lon), numero: String(x.address?.house_number ?? '').trim().toLowerCase(), cep: soNumeros(x.address?.postcode),
    bairro: semAcento([x.address?.suburb, x.address?.neighbourhood, x.address?.quarter, x.address?.city_district].filter(Boolean).join('|')),
  }))
}

/**
 * Avenidas longas têm um CEP por trecho de numeração ("até 999 - lado ímpar", "de 2 a 1300 - lado par"…). Com a
 * rua, o número e a cidade, o ViaCEP diz o CEP e o bairro daquele trecho — e o mapa tem o CEP de cada trecho da rua,
 * mesmo quando não tem o número da casa. É o que separa o 907 da avenida no Bairro Novo do mesmo nome em Casa Caiada.
 */
export async function cepDoTrecho(e: { logradouro: string; numero?: string | null; cidade?: string | null; uf?: string | null }): Promise<{ cep: string; bairro: string } | null> {
  const nome = e.logradouro.trim().replace(TIPO_DE_VIA, '')
  const cidade = e.cidade?.trim()
  const uf = e.uf?.trim()
  if (!cidade || !uf || nome.length < 3) return null
  const n = Number(soNumeros(e.numero))
  try {
    const r = await fetch(`https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(nome)}/json/`).then((x) => (x.ok ? x.json() : []))
    const trechos = (Array.isArray(r) ? r : []) as { cep: string; logradouro: string; complemento: string; bairro: string }[]
    // só a mesma rua (o ViaCEP também devolve ruas que contêm o nome)
    const mesmaRua = trechos.filter((t) => semAcento(t.logradouro).replace(TIPO_DE_VIA, '') === semAcento(nome))
    const candidatos = n ? mesmaRua.filter((t) => cabeNoTrecho(t.complemento, n)) : mesmaRua
    const escolhido = candidatos.length === 1 ? candidatos[0] : candidatos.find((t) => t.complemento) ?? (mesmaRua.length === 1 ? mesmaRua[0] : undefined)
    return escolhido ? { cep: soNumeros(escolhido.cep), bairro: escolhido.bairro } : null
  } catch {
    return null
  }
}

/** O número cabe na faixa do CEP? Faixas do Correios: "até 999 - lado ímpar", "de 1005 a 1197", "de 4001/4002 ao fim", "4295". */
export function cabeNoTrecho(complemento: string, n: number) {
  const c = semAcento(complemento)
  if (!c) return true
  if (c.includes('lado par') && n % 2 !== 0) return false
  if (c.includes('lado impar') && n % 2 === 0) return false
  let m = c.match(/de (\d+)(?:\/\d+)? a (\d+)/)
  if (m) return n >= Number(m[1]) && n <= Number(m[2])
  m = c.match(/de (\d+)(?:\/\d+)? ao fim/)
  if (m) return n >= Number(m[1])
  m = c.match(/ate (\d+)/)
  if (m) return n <= Number(m[1])
  m = c.match(/^(\d+)$/)
  if (m) return n === Number(m[1])
  return true // faixa escrita de outro jeito: não descarta
}

/**
 * Converte um endereço em coordenadas. Devolve null quando não encontra nem a rua nem o bairro.
 * `perto` (o ponto da loja) limita a busca à região. Entre os trechos de rua devolvidos, vale primeiro a casa com o
 * número pedido, depois o trecho com o CEP certo (o digitado ou o que o ViaCEP diz para aquele número), depois o do
 * bairro certo. Se nenhum trecho bate com o CEP ou o bairro, procura de novo com o bairro no texto.
 * O mapa do OpenStreetMap não tem todas as ruas pequenas: nesse caso o ponto sai aproximado (rua de mesmo nome
 * no bairro, ou o meio do bairro) e quem usa a tela confere e arrasta o pino.
 */
export async function localizarEndereco(e: EnderecoBusca, perto?: Ponto | null): Promise<PontoAchado | null> {
  const rua = e.logradouro?.trim()
  if (!rua) return null
  const numero = String(e.numero ?? '').trim().toLowerCase()
  let cep = soNumeros(e.cep)
  let bairro = e.bairro?.trim() ?? ''
  const cidade = e.cidade?.trim() ?? ''
  const uf = e.uf?.trim() ?? ''
  const chave = `tiace.geo2.${[rua, numero, bairro, cidade, uf, cep, perto?.lat.toFixed(3), perto?.lng.toFixed(3)].join('|').toLowerCase()}`
  try {
    const salvo = sessionStorage.getItem(chave)
    if (salvo) return JSON.parse(salvo)
  } catch {
    /* sem armazenamento de sessão: segue consultando */
  }
  // sem CEP digitado (ou com um CEP geral da cidade), descobre o do trecho pelo número
  if (cep.length !== 8 || cep.endsWith('000')) {
    const trecho = await cepDoTrecho({ logradouro: rua, numero, cidade, uf })
    if (trecho) {
      cep = trecho.cep
      bairro ||= trecho.bairro
    }
  }
  const mesmoBairro = (x: Achado) => Boolean(bairro) && x.bairro.split('|').includes(semAcento(bairro))
  const certo = (x: Achado) => (numero && x.numero === numero) || (cep.length === 8 && x.cep === cep) || mesmoBairro(x)
  const escolher = (lista: Achado[]) =>
    lista.find((x) => numero && x.numero === numero) ?? lista.find((x) => cep.length === 8 && x.cep === cep) ?? lista.find(mesmoBairro) ?? lista[0] ?? null
  try {
    const comNumero = [numero, rua].filter(Boolean).join(' ')
    let achado: Achado | null = escolher(await consultar({ street: comNumero, city: cidade, state: uf }, perto))
    // a cidade informada pode não ser a do endereço (cliente de cidade vizinha que não digitou o CEP)
    if (!achado && cidade && perto) achado = escolher(await consultar({ street: comNumero, state: uf }, perto))
    // achou a rua, mas num trecho de outro bairro (avenida longa): procura de novo com o bairro e o CEP no texto
    if ((!achado || !certo(achado)) && (bairro || cep.length === 8)) {
      const outra = escolher(await consultar({ q: [rua, bairro, cidade, uf, cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '', 'Brasil'].filter(Boolean).join(', ') }, perto))
      if (outra && (!achado || certo(outra))) achado = outra
    }
    if (!achado) achado = escolher(await consultar({ q: [rua, bairro, cidade, uf, 'Brasil'].filter(Boolean).join(', ') }, perto))
    let aproximado: PontoAchado['aproximado']
    // a rua não está no mapa: tenta o nome sem "Travessa", "Rua"… (a avenida de mesmo nome costuma ser a vizinha)
    const nome = rua.replace(TIPO_DE_VIA, '')
    if (!achado && nome !== rua) {
      const lista = await consultar({ q: [nome, cidade, uf, 'Brasil'].filter(Boolean).join(', ') }, perto)
      // só serve se ficar no bairro informado: fora dele seria outra rua qualquer
      achado = bairro ? (lista.find(mesmoBairro) ?? null) : escolher(lista)
      if (achado) aproximado = 'rua'
    }
    // por fim, o meio do bairro
    if (!achado && bairro) {
      achado = escolher(await consultar({ q: [bairro, cidade, uf, 'Brasil'].filter(Boolean).join(', ') }, perto))
      if (achado) aproximado = 'bairro'
    }
    if (!achado) return null
    const ponto: PontoAchado = { lat: achado.lat, lng: achado.lng, ...(aproximado ? { aproximado } : {}) }
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

/**
 * O mesmo destino pelo endereço próprio do aplicativo do Waze (waze://). Dentro do aplicativo Android, o link https
 * abria o site do Waze: o Android só manda para o app os links https que o Waze "assina", e no celular do motoboy não mandou.
 */
export const linkWazeApp = (destino: Ponto | null, enderecoTexto: string) =>
  `waze://?${destino ? `ll=${destino.lat},${destino.lng}` : `q=${encodeURIComponent(enderecoTexto)}`}&navigate=yes`
