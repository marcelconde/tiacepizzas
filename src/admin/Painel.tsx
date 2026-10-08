import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Carregando, Cartao, Entrada, Erro, cx } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { DIAS_SEMANA, ORIGEM, PAGAMENTO, TIPO, brl, dataCurta, diasAtras, isoDia, num } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { supabase } from '../lib/supabase'
import type { FormaPagamento, Insumo, OrigemPedido, TipoPedido } from '../lib/tipos'
import { Pagina, useAdmin, usePedidosAoVivo } from './AdminLayout'
import { Colunas, Indicador, Quadro, Ranking, Semaforo, Tendencia, classificar, type Nivel } from './graficos'

interface Fatia {
  pedidos: number
  faturamento: number
}
export type Agrupar = 'dia' | 'semana' | 'mes'
export interface Relatorio {
  inicio: string
  fim: string
  agrupar: Agrupar
  dias: number
  resumo: {
    faturamento: number; pedidos: number; ticket_medio: number; taxas_entrega: number; descontos: number; recebido: number; a_receber: number
    tempo_preparo_min: number | null; tempo_total_min: number | null; cancelados: number; valor_cancelado: number
    reembolsados: number; valor_reembolsado: number; total_pedidos: number
    clientes_novos: number; clientes_atendidos: number; cmv: number; perdas: number; despesas: number
  }
  anterior: { faturamento: number; pedidos: number; ticket_medio: number }
  por_dia: (Fatia & { dia: string })[]
  por_hora: (Fatia & { hora: number })[]
  por_dia_semana: (Fatia & { dia_semana: number })[]
  por_pagamento: (Fatia & { forma: FormaPagamento; recebido: number })[]
  por_tipo: (Fatia & { tipo: TipoPedido })[]
  por_origem: (Fatia & { origem: OrigemPedido })[]
  por_bairro: (Fatia & { bairro: string })[]
  top_produtos: { nome: string; quantidade: number; faturamento: number }[]
  top_clientes: { nome: string; pedidos: number; faturamento: number }[]
  despesas_por_categoria: { categoria: string; valor: number }[]
  por_entregador: { nome: string; entregas: number; taxas: number; a_pagar: number }[]
}

const hoje = () => new Date()
const inicioDaSemana = () => {
  const d = hoje()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // segunda-feira
  return isoDia(d)
}

const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje', faixa: () => [isoDia(), isoDia()] },
  { id: 'semana', rotulo: 'Semana', faixa: () => [inicioDaSemana(), isoDia()] },
  { id: 'mes', rotulo: 'Mês', faixa: () => [isoDia(new Date(hoje().getFullYear(), hoje().getMonth(), 1)), isoDia()] },
  { id: 'ano', rotulo: 'Ano', faixa: () => [`${hoje().getFullYear()}-01-01`, isoDia()] },
  { id: '30d', rotulo: '30 dias', faixa: () => [diasAtras(29), isoDia()] },
  { id: 'mes_passado', rotulo: 'Mês passado', faixa: () => [isoDia(new Date(hoje().getFullYear(), hoje().getMonth() - 1, 1)), isoDia(new Date(hoje().getFullYear(), hoje().getMonth(), 0))] },
] as const

const diasEntre = (inicio: string, fim: string) => Math.round((new Date(`${fim}T12:00:00`).getTime() - new Date(`${inicio}T12:00:00`).getTime()) / 86_400_000) + 1
/** Passo da série: por dia até um mês, por semana até quatro meses, depois por mês. */
export const agruparPara = (inicio: string, fim: string): Agrupar => {
  const dias = diasEntre(inicio, fim)
  return dias <= 31 ? 'dia' : dias <= 120 ? 'semana' : 'mes'
}

/** Filtro de período compartilhado pelas telas de indicadores (dia, semana, mês, ano ou datas à escolha). */
export function usePeriodo(inicial: (typeof PERIODOS)[number]['id'] = 'semana') {
  const [periodo, setPeriodo] = useState<string>(inicial)
  const [[inicio, fim], setFaixa] = useState<string[]>(() => PERIODOS.find((p) => p.id === inicial)!.faixa())
  const seletor = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="sem-barra flex overflow-x-auto rounded-lg border border-stone-300 bg-white p-0.5">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={periodo === p.id}
            onClick={() => {
              setPeriodo(p.id)
              setFaixa(p.faixa())
            }}
            className={cx('rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap', periodo === p.id ? 'bg-forno-800 text-white' : 'text-forno-700 hover:bg-stone-100')}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <Entrada type="date" aria-label="De" className="w-auto" value={inicio} max={fim} onChange={(e) => { setPeriodo(''); setFaixa([e.target.value, fim]) }} />
      <span className="text-sm text-stone-500">até</span>
      <Entrada type="date" aria-label="Até" className="w-auto" value={fim} min={inicio} onChange={(e) => { setPeriodo(''); setFaixa([inicio, e.target.value]) }} />
    </div>
  )
  return { inicio, fim, seletor, dias: diasEntre(inicio, fim), texto: `${dataCurta(inicio)} a ${dataCurta(fim)}` }
}

export const useRelatorio = (inicio: string, fim: string, agrupar: Agrupar = agruparPara(inicio, fim)) =>
  useConsulta<Relatorio>(() => supabase.rpc('relatorio_faturamento', { p_inicio: inicio, p_fim: fim, p_agrupar: agrupar }), [inicio, fim, agrupar])

const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const rotuloPasso = (iso: string, agrupar: Agrupar) => (agrupar === 'mes' ? `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}` : diaMes(iso))
export const nomePasso: Record<Agrupar, string> = { dia: 'dia', semana: 'semana', mes: 'mês' }
const pedidosTxt = (n: number) => `${n} pedido${n === 1 ? '' : 's'}`

export default function Painel() {
  const { config } = useLoja()
  const { pode } = useAdmin()
  const { inicio, fim, seletor, dias } = usePeriodo('semana')
  const { dados: r, carregando, erro, recarregar } = useRelatorio(inicio, fim)
  const { dados: insumos } = useConsulta<Insumo[]>(() => supabase.from('insumos').select('*').eq('ativo', true).order('nome'), [])
  usePedidosAoVivo(recarregar)

  const baixos = (insumos ?? []).filter((i) => Number(i.quantidade) <= Number(i.estoque_minimo))
  const umDia = inicio === fim
  const metas = config?.metas ?? {}
  const s = r?.resumo
  const mediaDia = s ? Number(s.faturamento) / dias : 0
  const cancelPct = s && s.total_pedidos > 0 ? (s.cancelados * 100) / s.total_pedidos : 0
  // dias do período classificados pela meta de faturamento diário
  const niveisDias = r && r.agrupar === 'dia' && dias > 1 ? r.por_dia.map((d) => classificar(Number(d.faturamento), metas.faturamento_dia)).filter(Boolean) as Nivel[] : []
  const conta = (n: Nivel) => niveisDias.filter((x) => x === n).length

  return (
    <Pagina titulo="Painel" descricao="Faturamento e desempenho da pizzaria.">
      <div className="mb-4">{seletor}</div>
      {erro && <Erro>{erro}</Erro>}
      {!r || !s ? (
        carregando && <Carregando />
      ) : (
        <div className={cx('space-y-4 transition-opacity', carregando && 'opacity-60')}>
          {baixos.length > 0 && (
            <Link to={pode('estoque') ? '/admin/estoque' : '#'} className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>Estoque baixo:</b> {baixos.slice(0, 6).map((i) => i.nome).join(', ')}
                {baixos.length > 6 && ` e mais ${baixos.length - 6}`}.{pode('estoque') && ' Ver estoque →'}
              </span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador
              rotulo="Faturamento"
              valor={brl(s.faturamento)}
              atual={s.faturamento}
              anterior={r.anterior.faturamento}
              detalhe="sem período anterior para comparar"
              nivel={classificar(mediaDia, metas.faturamento_dia)}
              nivelTexto={umDia ? undefined : `média de ${brl(mediaDia)} por dia`}
            />
            <Indicador
              rotulo="Pedidos"
              valor={num(s.pedidos)}
              atual={s.pedidos}
              anterior={r.anterior.pedidos}
              detalhe="sem período anterior para comparar"
              nivel={classificar(s.pedidos / dias, metas.pedidos_dia)}
              nivelTexto={umDia ? undefined : `média de ${num(Math.round((s.pedidos / dias) * 10) / 10)} por dia`}
            />
            <Indicador rotulo="Ticket médio" valor={brl(s.ticket_medio)} atual={s.ticket_medio} anterior={r.anterior.ticket_medio} detalhe="valor médio por pedido" nivel={s.pedidos ? classificar(s.ticket_medio, metas.ticket_medio) : null} />
            <Indicador rotulo="A receber" valor={brl(s.a_receber)} detalhe={`${brl(s.recebido)} já recebido`} />
            <Indicador
              rotulo="Tempo de preparo"
              valor={s.tempo_preparo_min != null ? `${s.tempo_preparo_min} min` : '—'}
              detalhe="da confirmação até ficar pronto"
              nivel={classificar(s.tempo_preparo_min, metas.tempo_preparo)}
            />
            <Indicador rotulo="Tempo até a entrega" valor={s.tempo_total_min != null ? `${s.tempo_total_min} min` : '—'} detalhe="do pedido até a conclusão" />
            <Indicador
              rotulo="Cancelamentos"
              valor={`${num(s.cancelados)} (${cancelPct.toFixed(0)}%)`}
              detalhe={`${brl(s.valor_cancelado)} cancelados${s.reembolsados ? ` · ${s.reembolsados} reembolso(s)` : ''}`}
              nivel={s.total_pedidos ? classificar(cancelPct, metas.cancelamentos_pct) : null}
            />
            <Indicador rotulo="Clientes atendidos" valor={num(s.clientes_atendidos)} detalhe={`${s.clientes_novos} novo(s) no período`} />
          </div>

          {niveisDias.length > 0 && (
            <Cartao className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
              <b>Dias do período pela meta de faturamento:</b>
              <Semaforo nivel="bom" texto={`${conta('bom')} bom(ns) — a partir de ${brl(metas.faturamento_dia?.bom)}`} />
              <Semaforo nivel="medio" texto={`${conta('medio')} médio(s)`} />
              <Semaforo nivel="ruim" texto={`${conta('ruim')} ruim(ns) — abaixo de ${brl(metas.faturamento_dia?.ruim)}`} />
              {pode('configuracoes') && (
                <Link to="/admin/configuracoes" className="ml-auto text-xs font-semibold text-molho-700 hover:underline">
                  Alterar metas
                </Link>
              )}
            </Cartao>
          )}

          {umDia ? (
            <Quadro titulo="Faturamento por hora" subtitulo="Pedidos válidos, pela hora em que foram feitos">
              <Colunas formato={brl} dados={r.por_hora.map((h) => ({ rotulo: `${h.hora}h`, valor: Number(h.faturamento), detalhe: `${h.hora}h · ${pedidosTxt(h.pedidos)}` }))} />
            </Quadro>
          ) : (
            <Quadro titulo={`Faturamento por ${nomePasso[r.agrupar]}`} subtitulo="Pedidos válidos (cancelados e reembolsados não entram)">
              <Tendencia formato={brl} dados={r.por_dia.map((d) => ({ rotulo: rotuloPasso(d.dia, r.agrupar), valor: Number(d.faturamento), detalhe: `${r.agrupar === 'dia' ? '' : 'a partir de '}${dataCurta(d.dia)} · ${pedidosTxt(d.pedidos)}` }))} />
            </Quadro>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Quadro titulo="Pedidos por horário" subtitulo="Quando a cozinha mais trabalha">
              <Colunas formato={pedidosTxt} dados={r.por_hora.map((h) => ({ rotulo: `${h.hora}h`, valor: h.pedidos, detalhe: `${h.hora}h · ${brl(h.faturamento)}` }))} />
            </Quadro>
            <Quadro titulo="Faturamento por dia da semana">
              <Colunas
                formato={brl}
                dados={DIAS_SEMANA.map((nome, i) => {
                  const d = r.por_dia_semana.find((x) => x.dia_semana === i)
                  return { rotulo: nome.slice(0, 3), valor: Number(d?.faturamento ?? 0), detalhe: `${nome} · ${pedidosTxt(d?.pedidos ?? 0)}` }
                })}
              />
            </Quadro>
            <Quadro titulo="Mais vendidos" subtitulo="Por faturamento; pizzas meio a meio contam metade para cada sabor">
              <Ranking formato={brl} dados={r.top_produtos.map((p) => ({ rotulo: p.nome, valor: Number(p.faturamento), detalhe: `${num(p.quantidade)} unidade(s)` }))} />
            </Quadro>
            <Quadro titulo="Clientes que mais gastaram">
              <Ranking formato={brl} dados={r.top_clientes.map((c) => ({ rotulo: c.nome, valor: Number(c.faturamento), detalhe: pedidosTxt(c.pedidos) }))} />
            </Quadro>
            <Quadro titulo="Formas de pagamento">
              <Ranking formato={brl} dados={r.por_pagamento.map((p) => ({ rotulo: PAGAMENTO[p.forma], valor: Number(p.faturamento), detalhe: pedidosTxt(p.pedidos) }))} />
            </Quadro>
            <Quadro titulo="Bairros que mais pedem" subtitulo="Somente entregas">
              <Ranking formato={brl} dados={r.por_bairro.map((b) => ({ rotulo: b.bairro, valor: Number(b.faturamento), detalhe: pedidosTxt(b.pedidos) }))} />
            </Quadro>
            <Quadro titulo="Canais de venda">
              <Ranking formato={brl} dados={r.por_origem.map((o) => ({ rotulo: ORIGEM[o.origem], valor: Number(o.faturamento), detalhe: pedidosTxt(o.pedidos) }))} />
            </Quadro>
            <Quadro titulo="Entrega, retirada e balcão">
              <Ranking formato={brl} dados={r.por_tipo.map((t) => ({ rotulo: TIPO[t.tipo], valor: Number(t.faturamento), detalhe: pedidosTxt(t.pedidos) }))} />
            </Quadro>
          </div>
          {pode('analises') && (
            <p className="text-sm text-stone-600">
              Quer o ranking completo de produtos e clientes?{' '}
              <Link to="/admin/analises" className="font-semibold text-molho-700 hover:underline">
                Abrir Análises →
              </Link>
            </p>
          )}
        </div>
      )}
    </Pagina>
  )
}
