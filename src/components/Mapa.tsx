import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Ponto } from '../lib/geo'

export interface Marcador {
  id: string
  ponto: Ponto
  tipo: 'loja' | 'motoboy' | 'cliente'
  rotulo?: string
  aoArrastar?: (p: Ponto) => void
}

const SIMBOLO = { loja: '🍕', motoboy: '🛵', cliente: '📍' }
const icone = (tipo: Marcador['tipo']) =>
  L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 36],
    html: `<div style="width:40px;height:40px;display:grid;place-items:center;font-size:24px;background:#fff;border-radius:50%;box-shadow:0 2px 8px rgb(0 0 0/.35);border:2px solid ${tipo === 'motoboy' ? '#c0351d' : '#36251c'}">${SIMBOLO[tipo]}</div>`,
  })

/**
 * Mapa do OpenStreetMap com marcadores (loja, motoboy, cliente) e, opcionalmente, os círculos das faixas de entrega.
 * Carregado sob demanda: só quem abre uma tela com mapa baixa a biblioteca.
 */
export default function Mapa({ marcadores, circulosKm = [], className = 'h-64' }: { marcadores: Marcador[]; circulosKm?: number[]; className?: string }) {
  const el = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const camada = useRef<L.LayerGroup | null>(null)
  const enquadrado = useRef('')

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { scrollWheelZoom: false, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    camada.current = L.layerGroup().addTo(m)
    mapa.current = m
    return () => {
      m.remove()
      mapa.current = null
    }
  }, [])

  useEffect(() => {
    const m = mapa.current
    if (!m || !camada.current) return
    camada.current.clearLayers()
    const loja = marcadores.find((x) => x.tipo === 'loja')
    for (const km of circulosKm) {
      if (loja) L.circle(loja.ponto, { radius: km * 1000, color: '#2a78d6', weight: 1, fillOpacity: 0.04 }).addTo(camada.current)
    }
    for (const x of marcadores) {
      const marca = L.marker(x.ponto, { icon: icone(x.tipo), draggable: Boolean(x.aoArrastar), title: x.rotulo }).addTo(camada.current)
      if (x.rotulo) marca.bindTooltip(x.rotulo)
      if (x.aoArrastar) marca.on('dragend', () => x.aoArrastar!({ lat: marca.getLatLng().lat, lng: marca.getLatLng().lng }))
    }
    // reenquadra só quando o conjunto de pontos muda de verdade (não a cada atualização de posição do motoboy)
    const assinatura = marcadores.map((x) => x.id).join(',') + '|' + circulosKm.join(',')
    if (marcadores.length && assinatura !== enquadrado.current) {
      enquadrado.current = assinatura
      const limites = L.latLngBounds(marcadores.map((x) => x.ponto))
      if (loja && circulosKm.length) {
        const km = Math.max(...circulosKm)
        const dLat = km / 111
        const dLng = km / (111 * Math.cos((loja.ponto.lat * Math.PI) / 180))
        limites.extend([loja.ponto.lat - dLat, loja.ponto.lng - dLng]).extend([loja.ponto.lat + dLat, loja.ponto.lng + dLng])
      }
      m.fitBounds(limites.pad(0.25), { maxZoom: 16 })
    }
  }, [marcadores, circulosKm])

  return <div ref={el} className={`z-0 w-full overflow-hidden rounded-xl border border-stone-200 ${className}`} />
}
