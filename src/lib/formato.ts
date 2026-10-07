import type { FormaPagamento, OrigemPedido, StatusPedido, TipoPedido } from './tipos'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl = (v: number | null | undefined) => moeda.format(Number(v ?? 0))

const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
export const num = (v: number | null | undefined) => numero.format(Number(v ?? 0))

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function telefone(s: string | null | undefined) {
  const d = soDigitos(s)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s ?? ''
}

export function cpf(s: string | null | undefined) {
  const d = soDigitos(s)
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (s ?? '')
}

export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export const dataCurta = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : ''

export const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''

export function haQuanto(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d`
}

/** Data local no formato AAAA-MM-DD (para campos de data e filtros). */
export function isoDia(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function diasAtras(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDia(d)
}

export const STATUS: Record<StatusPedido, { rotulo: string; cor: string }> = {
  novo: { rotulo: 'Novo', cor: 'bg-amber-100 text-amber-900' },
  confirmado: { rotulo: 'Confirmado', cor: 'bg-sky-100 text-sky-900' },
  em_preparo: { rotulo: 'Em preparo', cor: 'bg-orange-100 text-orange-900' },
  pronto: { rotulo: 'Pronto', cor: 'bg-lime-100 text-lime-900' },
  saiu_entrega: { rotulo: 'Saiu para entrega', cor: 'bg-violet-100 text-violet-900' },
  entregue: { rotulo: 'Entregue', cor: 'bg-emerald-100 text-emerald-900' },
  cancelado: { rotulo: 'Cancelado', cor: 'bg-stone-200 text-stone-700' },
}

export const TIPO: Record<TipoPedido, string> = { entrega: 'Entrega', retirada: 'Retirada', balcao: 'Balcão' }

export const ORIGEM: Record<OrigemPedido, string> = {
  site: 'Site',
  balcao: 'Balcão',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  ifood: 'iFood',
}

export const PAGAMENTO: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  vale_refeicao: 'Vale-refeição',
}

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export function enderecoTexto(e: { logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null } | null | undefined) {
  if (!e?.logradouro) return ''
  return [`${e.logradouro}, ${e.numero ?? 's/n'}`, e.complemento, e.bairro].filter(Boolean).join(' — ')
}

/** Baixa uma tabela como CSV que o Excel abre com acentos e colunas certas. */
export function baixarCsv(nome: string, linhas: Record<string, unknown>[]) {
  if (!linhas.length) return
  const colunas = Object.keys(linhas[0])
  const celula = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(';'))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nome}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
