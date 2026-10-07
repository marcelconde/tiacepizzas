import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Carregando, Entrada, Erro, cx } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { DIAS_SEMANA, ORIGEM, PAGAMENTO, TIPO, brl, diasAtras, isoDia, num } from '../lib/formato'
import { supabase } from '../lib/supabase'
import type { FormaPagamento, Insumo, OrigemPedido, TipoPedido } from '../lib/tipos'
import { Pagina, usePedidosAoVivo } from './AdminLayout'
import { Colunas, Indicador, Quadro, Ranking, Tendencia } from './graficos'

interface Fatia {
  pedidos: number
  faturamento: number
}
export interface Relatorio {
  inicio: string
  fim: string
  resumo: {
    faturamento: number; pedidos: number; ticket_medio: number; taxas_entrega: number; descontos: number; recebido: number; a_receber: number
    tempo_preparo_min: number | null; tempo_total_min: number | null; cancelados: number; valor_cancelado: number
    clientes_novos: number; clientes_atendidos: number; cmv: number; perdas: number; despesas: number
  }
  anterior: { faturamento: number; pedidos: number; ticket_medio: number }
  por_dia: (Fatia & { dia: string })[]
  por_hora: (Fatia & { hora: number })[]
  por_dia_semana: (Fatia & { dia_semana: number })[]
  por_pagamento: (Fatia & { forma: FormaPagamento })[]
  por_tipo: (Fatia & { tipo: TipoPedido })[]
  por_origem: (Fatia & { origem: OrigemPedido })[]
  por_bairro: (Fatia & { bairro: string })[]
  top_produtos: { nome: string; quantidade: number; faturamento: number }[]
  por_entregador: { nome: string; entregas: number; taxas: number; a_pagar: number }[]
}

function inicioDoMes(deslocamento = 0) {
  const d = new Date()
  return isoDia(new Date(d.getFullYear(), d.getMonth() + deslocamento, 1))
}
function fimDoMesPassado() {
  const d = new Date()
  return isoDia(new Date(d.getFullYear(), d.getMonth(), 0))
}

const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje', faixa: () => [isoDia(), isoDia()] },
  { id: '7d', rotulo: '7 dias', faixa: () => [diasAtras(6), isoDia()] },
  { id: '30d', rotulo: '30 dias', faixa: () => [diasAtras(29), isoDia()] },
  { id: 'mes', rotulo: 'Este mês', faixa: () => [inicioDoMes(), isoDia()] },
  { id: 'mes_passado', rotulo: 'Mês passado', faixa: () => [inicioDoMes(-1), fimDoMesPassado()] },
] as const

/** Filtro de período compartilhado pelo Painel e pelo Financeiro. */
export function usePeriodo(inicial: (typeof PERIODOS)[number]['id'] = '7d') {
  const [periodo, setPeriodo] = useState<string>(inicial)
  const [[inicio, fim], setFaixa] = useState<string[]>(() => PERIODOS.find((p) => p.id === inicial)!.faixa())
  const seletor = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-x-auto rounded-lg border border-stone-300 bg-white p-0.5">
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
  return { inicio, fim, seletor }
}

export const useRelatorio = (inicio: string, fim: string) =>
  useConsulta<Relatorio>(() => supabase.rpc('relatorio_faturamento', { p_inicio: inicio, p_fim: fim }), [inicio, fim])

const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const pedidosTxt = (n: number) => `${n} pedido${n === 1 ? '' : 's'}`

export default function Painel() {
  const { inicio, fim, seletor } = usePeriodo('7d')
  const { dados: r, carregando, erro, recarregar } = useRelatorio(inicio, fim)
  const { dados: insumos } = useConsulta<Insumo[]>(() => supabase.from('insumos').select('*').eq('ativo', true).order('nome'), [])
  usePedidosAoVivo(recarregar)

  const baixos = (insumos ?? []).filter((i) => Number(i.quantidade) <= Number(i.estoque_minimo))
  const umDia = inicio === fim

  return (
    <Pagina titulo="Painel" descricao="Faturamento e desempenho da pizzaria.">
      <div className="mb-4">{seletor}</div>
      {erro && <Erro>{erro}</Erro>}
      {!r ? (
        carregando && <Carregando />
      ) : (
        <div className={cx('space-y-4 transition-opacity', carregando && 'opacity-60')}>
          {baixos.length > 0 && (
            <Link to="/admin/estoque" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>Estoque baixo:</b> {baixos.slice(0, 6).map((i) => i.nome).join(', ')}
                {baixos.length > 6 && ` e mais ${baixos.length - 6}`}. Ver estoque →
              </span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador rotulo="Faturamento" valor={brl(r.resumo.faturamento)} atual={r.resumo.faturamento} anterior={r.anterior.faturamento} detalhe="sem período anterior para comparar" />
            <Indicador rotulo="Pedidos" valor={num(r.resumo.pedidos)} atual={r.resumo.pedidos} anterior={r.anterior.pedidos} detalhe="sem período anterior para comparar" />
            <Indicador rotulo="Ticket médio" valor={brl(r.resumo.ticket_medio)} atual={r.resumo.ticket_medio} anterior={r.anterior.ticket_medio} detalhe="por pedido" />
            <Indicador rotulo="A receber" valor={brl(r.resumo.a_receber)} detalhe={`${brl(r.resumo.recebido)} já recebido`} />
            <Indicador rotulo="Clientes atendidos" valor={num(r.resumo.clientes_atendidos)} detalhe={`${r.resumo.clientes_novos} novo(s) no período`} />
            <Indicador rotulo="Tempo de preparo" valor={r.resumo.tempo_preparo_min != null ? `${r.resumo.tempo_preparo_min} min` : '—'} detalhe="da confirmação até ficar pronto" />
            <Indicador rotulo="Tempo até a entrega" valor={r.resumo.tempo_total_min != null ? `${r.resumo.tempo_total_min} min` : '—'} detalhe="do pedido até a conclusão" />
            <Indicador rotulo="Cancelamentos" valor={num(r.resumo.cancelados)} detalhe={`${brl(r.resumo.valor_cancelado)} em pedidos cancelados`} />
          </div>

          {umDia ? (
            <Quadro titulo="Faturamento por hora" subtitulo="Pedidos válidos, pela hora em que foram feitos">
              <Colunas formato={brl} dados={r.por_hora.map((h) => ({ rotulo: `${h.hora}h`, valor: Number(h.faturamento), detalhe: `${h.hora}h · ${pedidosTxt(h.pedidos)}` }))} />
            </Quadro>
          ) : (
            <Quadro titulo="Faturamento por dia" subtitulo="Pedidos válidos (cancelados não entram)">
              <Tendencia formato={brl} dados={r.por_dia.map((d) => ({ rotulo: diaMes(d.dia), valor: Number(d.faturamento), detalhe: `${diaMes(d.dia)} · ${pedidosTxt(d.pedidos)}` }))} />
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
        </div>
      )}
    </Pagina>
  )
}
