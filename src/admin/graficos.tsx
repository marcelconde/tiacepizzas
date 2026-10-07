import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Cartao, cx } from '../components/ui'

// Uma série só por gráfico: uma cor para tudo. O texto usa tinta neutra, nunca a cor da série.
const SERIE = '#2a78d6'
const GRADE = '#e1e0d9'
const EIXO = '#c3c2b7'
const APAGADO = '#898781'

export interface Ponto {
  rotulo: string
  valor: number
  detalhe?: string
}

const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

export function Indicador({ rotulo, valor, anterior, atual, detalhe, subirEhBom = true }: { rotulo: string; valor: string; anterior?: number; atual?: number; detalhe?: ReactNode; subirEhBom?: boolean }) {
  const variacao = anterior != null && atual != null && anterior > 0 ? ((atual - anterior) / anterior) * 100 : null
  const subiu = (variacao ?? 0) >= 0
  return (
    <Cartao className="p-4">
      <p className="text-sm text-stone-500">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
      <p className="mt-1 flex min-h-5 items-center gap-1 text-xs text-stone-500">
        {variacao != null && (
          <span className={cx('inline-flex items-center font-semibold', subiu === subirEhBom ? 'text-emerald-700' : 'text-red-700')}>
            {subiu ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(variacao).toFixed(0)}%
          </span>
        )}
        {variacao != null ? 'vs. período anterior' : detalhe}
      </p>
    </Cartao>
  )
}

export function Quadro({ titulo, subtitulo, children, className }: { titulo: string; subtitulo?: string; children: ReactNode; className?: string }) {
  return (
    <Cartao className={cx('p-4', className)}>
      <h2 className="font-semibold">{titulo}</h2>
      {subtitulo && <p className="text-xs text-stone-500">{subtitulo}</p>}
      <div className="mt-4">{children}</div>
    </Cartao>
  )
}

const SemDados = () => <p className="py-10 text-center text-sm text-stone-400">Sem dados no período.</p>

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function Dica({ active, payload, label, formato }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="text-sm font-semibold text-forno-900">{formato(payload[0].value)}</p>
      <p className="text-stone-500">{payload[0].payload.detalhe ?? label}</p>
    </div>
  )
}

const eixoX = { tickLine: false, axisLine: { stroke: EIXO }, tick: { fill: APAGADO, fontSize: 12 }, minTickGap: 16 }
const eixoY = { tickLine: false, axisLine: false, tick: { fill: APAGADO, fontSize: 12 }, width: 44, tickFormatter: (v: number) => compacto.format(v) }

/** Evolução no tempo de uma única medida. */
export function Tendencia({ dados, formato }: { dados: Ponto[]; formato: (v: number) => string }) {
  if (!dados.some((d) => d.valor > 0)) return <SemDados />
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={dados} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRADE} />
        <XAxis dataKey="rotulo" {...eixoX} />
        <YAxis {...eixoY} />
        <Tooltip content={<Dica formato={formato} />} cursor={{ stroke: EIXO, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="valor"
          stroke={SERIE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill={SERIE}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 5, fill: SERIE, stroke: '#fff', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Comparação de magnitude entre poucas categorias ordenadas (horas, dias da semana). */
export function Colunas({ dados, formato }: { dados: Ponto[]; formato: (v: number) => string }) {
  if (!dados.some((d) => d.valor > 0)) return <SemDados />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={dados} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRADE} />
        <XAxis dataKey="rotulo" {...eixoX} />
        <YAxis {...eixoY} allowDecimals={false} />
        <Tooltip content={<Dica formato={formato} />} cursor={{ fill: 'rgba(11, 11, 11, 0.04)' }} />
        <Bar dataKey="valor" fill={SERIE} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Ranking: nomes longos à esquerda, barra fina e o valor na ponta. */
export function Ranking({ dados, formato }: { dados: Ponto[]; formato: (v: number) => string }) {
  const maximo = Math.max(...dados.map((d) => d.valor), 0)
  if (maximo <= 0) return <SemDados />
  return (
    <ul className="space-y-3">
      {dados.map((d) => (
        <li key={d.rotulo} title={d.detalhe}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-forno-800">{d.rotulo}</span>
            <span className="shrink-0 font-semibold tabular-nums">{formato(d.valor)}</span>
          </div>
          <div className="mt-1 h-2 rounded-r bg-stone-100">
            <div className="h-2 rounded-r" style={{ width: `${Math.max(1, (d.valor / maximo) * 100)}%`, background: SERIE }} />
          </div>
          {d.detalhe && <p className="mt-0.5 text-xs text-stone-500">{d.detalhe}</p>}
        </li>
      ))}
    </ul>
  )
}
