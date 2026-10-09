import { useState } from 'react'
import { Crud } from '../components/Crud'
import { Abas, Carregando, Cartao, Erro, Selecao, Selo, Tabela, Vazio, cx } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { exportar, type TabelaExport } from '../lib/exportar'
import { PAGAMENTO, STATUS, brl, dataCurta, dataHora } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { supabase } from '../lib/supabase'
import type { FormaPagamento, Pedido } from '../lib/tipos'
import { Pagina } from './AdminLayout'
import { BotoesExportar } from './Analises'
import { Quadro, Ranking, Semaforo, Tendencia, classificar } from './graficos'
import { agruparPara, nomePasso, rotuloPasso, usePeriodo, useRelatorio, type Agrupar, type Relatorio } from './Painel'

interface Despesa {
  id: string
  descricao: string
  categoria: string
  valor: number
  data: string
  forma_pagamento: FormaPagamento | null
  observacao: string | null
}

function linhasResultado(r: Relatorio) {
  const s = r.resumo
  const lucroBruto = Number(s.faturamento) - Number(s.cmv) - Number(s.perdas)
  return [
    { rotulo: 'Venda de produtos', valor: Number(s.faturamento) - Number(s.taxas_entrega) + Number(s.descontos) },
    { rotulo: 'Taxas de entrega', valor: Number(s.taxas_entrega) },
    { rotulo: 'Descontos e cupons', valor: -Number(s.descontos) || 0, tipo: 'menos' as const },
    { rotulo: 'Faturamento bruto (entradas)', valor: Number(s.faturamento), tipo: 'total' as const },
    { rotulo: 'Custo dos insumos vendidos', valor: -Number(s.cmv) || 0, tipo: 'menos' as const, dica: 'Calculado pelas fichas técnicas e pelo custo médio do estoque.' },
    { rotulo: 'Perdas e desperdício de estoque', valor: -Number(s.perdas) || 0, tipo: 'menos' as const, dica: 'Perdas (vencimento, quebra) e desperdício registrados no Estoque, pelo custo médio.' },
    { rotulo: 'Lucro bruto', valor: lucroBruto, tipo: 'total' as const },
    { rotulo: 'Despesas lançadas (saídas)', valor: -Number(s.despesas) || 0, tipo: 'menos' as const },
    { rotulo: 'Resultado do período', valor: lucroBruto - Number(s.despesas), tipo: 'final' as const },
  ]
}

function Resumo({ r }: { r: Relatorio }) {
  const s = r.resumo
  const linhas = linhasResultado(r)
  const resultado = linhas[linhas.length - 1].valor
  const margem = Number(s.faturamento) > 0 ? (resultado / Number(s.faturamento)) * 100 : 0
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { rotulo: 'Entradas (faturamento bruto)', valor: brl(s.faturamento), detalhe: `${s.pedidos} pedido(s) · ticket médio ${brl(s.ticket_medio)}` },
          { rotulo: 'Recebido', valor: brl(s.recebido), detalhe: `${brl(s.a_receber)} ainda a receber` },
          { rotulo: 'Saídas (despesas)', valor: brl(s.despesas), detalhe: `${r.despesas_por_categoria.length} categoria(s)` },
          { rotulo: 'Resultado do período', valor: brl(resultado), detalhe: `margem de ${margem.toFixed(1).replace('.', ',')}%` },
        ].map((c) => (
          <Cartao key={c.rotulo} className="p-4">
            <p className="text-sm text-stone-500">{c.rotulo}</p>
            <p className="mt-1 text-2xl font-semibold">{c.valor}</p>
            <p className="mt-1 text-xs text-stone-500">{c.detalhe}</p>
          </Cartao>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Cartao className="h-fit overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {linhas.map((l) => (
                <tr key={l.rotulo} className={cx('border-b border-stone-100 last:border-0', l.tipo === 'total' && 'bg-stone-50 font-semibold', l.tipo === 'final' && 'text-base font-bold text-white [&>td]:bg-forno-800')}>
                  <td className="px-4 py-2.5">
                    {l.tipo === 'menos' && <span className="mr-1 text-stone-400">(−)</span>}
                    {l.rotulo}
                    {l.dica && <span className="block text-xs font-normal text-stone-500">{l.dica}</span>}
                  </td>
                  <td className={cx('px-4 py-2.5 text-right tabular-nums', l.tipo !== 'final' && l.valor < 0 && 'text-red-700')}>{brl(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>
        <div className="space-y-4">
          <Quadro titulo="Entradas por forma de pagamento" subtitulo="Valor dos pedidos válidos; ao lado, quanto já foi recebido">
            <Ranking formato={brl} dados={r.por_pagamento.map((p) => ({ rotulo: PAGAMENTO[p.forma], valor: Number(p.faturamento), detalhe: `${p.pedidos} pedido(s) · ${brl(p.recebido)} recebido` }))} />
          </Quadro>
          <Quadro titulo="Saídas por categoria">
            <Ranking formato={brl} dados={r.despesas_por_categoria.map((d) => ({ rotulo: d.categoria, valor: Number(d.valor) }))} />
          </Quadro>
        </div>
      </div>
      <p className="text-xs text-stone-500">
        Estimativa gerencial: o resultado só fica fiel se as despesas forem lançadas e as fichas técnicas e os custos de entrada no estoque estiverem em dia. Não substitui a contabilidade.
      </p>
    </div>
  )
}

function PorPeriodo({ r, agrupar, setAgrupar }: { r: Relatorio; agrupar: Agrupar; setAgrupar: (a: Agrupar) => void }) {
  const { config } = useLoja()
  return (
    <div className="space-y-4">
      <Quadro titulo={`Faturamento por ${nomePasso[r.agrupar]}`}>
        <Tendencia formato={brl} dados={r.por_dia.map((d) => ({ rotulo: rotuloPasso(d.dia, r.agrupar), valor: Number(d.faturamento), detalhe: `${dataCurta(d.dia)} · ${d.pedidos} pedido(s)` }))} />
      </Quadro>
      <Selecao aria-label="Agrupar por" className="w-auto" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
        <option value="dia">Agrupar por dia</option>
        <option value="semana">Agrupar por semana</option>
        <option value="mes">Agrupar por mês</option>
      </Selecao>
      <Tabela colunas={[r.agrupar === 'dia' ? 'Dia' : 'A partir de', 'Pedidos', 'Faturamento', 'Ticket médio', ...(r.agrupar === 'dia' ? ['Meta do dia'] : [])]}>
        {r.por_dia.slice().reverse().map((d) => (
          <tr key={d.dia}>
            <td className="tabular-nums">{dataCurta(d.dia)}</td>
            <td className="tabular-nums">{d.pedidos}</td>
            <td className="font-semibold tabular-nums">{brl(d.faturamento)}</td>
            <td className="tabular-nums">{d.pedidos ? brl(Number(d.faturamento) / d.pedidos) : '—'}</td>
            {r.agrupar === 'dia' && (
              <td>
                <Semaforo nivel={classificar(Number(d.faturamento), config?.metas.faturamento_dia)} />
              </td>
            )}
          </tr>
        ))}
        <tr className="bg-stone-50 font-bold">
          <td>Total</td>
          <td className="tabular-nums">{r.resumo.pedidos}</td>
          <td className="tabular-nums">{brl(r.resumo.faturamento)}</td>
          <td className="tabular-nums">{brl(r.resumo.ticket_medio)}</td>
          {r.agrupar === 'dia' && <td />}
        </tr>
      </Tabela>
    </div>
  )
}

function Entradas({ pedidos }: { pedidos: Pedido[] }) {
  if (!pedidos.length) return <Vazio titulo="Nenhuma entrada com esses filtros" />
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0)
  const recebido = pedidos.filter((p) => p.pago).reduce((s, p) => s + Number(p.total), 0)
  return (
    <>
      <p className="mb-2 text-sm text-stone-600">
        {pedidos.length} pedido(s) · <b>{brl(total)}</b> em vendas · {brl(recebido)} já recebido
      </p>
      <Tabela colunas={['Pedido', 'Data', 'Cliente', 'Pagamento', 'Situação', 'Valor']}>
        {pedidos.slice(0, 500).map((p) => (
          <tr key={p.id}>
            <td className="font-semibold">#{p.numero}</td>
            <td className="whitespace-nowrap tabular-nums">{dataHora(p.criado_em)}</td>
            <td>{p.cliente_nome}</td>
            <td>{PAGAMENTO[p.forma_pagamento]}</td>
            <td>
              <Selo className={p.pago ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}>{p.pago ? 'Recebido' : 'A receber'}</Selo>
            </td>
            <td className="font-semibold tabular-nums">{brl(p.total)}</td>
          </tr>
        ))}
      </Tabela>
      {pedidos.length > 500 && <p className="mt-2 text-sm text-stone-500">Mostrando os 500 mais recentes; a exportação traz todos.</p>}
    </>
  )
}

export default function Financeiro() {
  const { config } = useLoja()
  const [aba, setAba] = useState<'resumo' | 'periodo' | 'entradas' | 'saidas'>('resumo')
  const [categoria, setCategoria] = useState('')
  const [forma, setForma] = useState('')
  const [agruparEscolhido, setAgrupar] = useState<Agrupar | null>(null)
  const { inicio, fim, seletor, texto } = usePeriodo('mes')
  const agrupar = agruparEscolhido ?? agruparPara(inicio, fim)
  const { dados: r, carregando, erro, recarregar } = useRelatorio(inicio, fim, agrupar)
  const categorias = config?.categorias_despesa ?? ['Outros']

  // entradas e saídas detalhadas do período, para as abas e para a exportação
  const { dados: pedidos } = useConsulta<Pedido[]>(
    () =>
      supabase
        .from('pedidos')
        .select('*')
        .gte('criado_em', new Date(`${inicio}T00:00:00`).toISOString())
        .lte('criado_em', new Date(`${fim}T23:59:59.999`).toISOString())
        .not('status', 'in', '(cancelado,reembolsado)')
        .order('criado_em', { ascending: false })
        .limit(10000),
    [inicio, fim],
  )
  const { dados: despesas, recarregar: recarregarDespesas } = useConsulta<Despesa[]>(
    () => supabase.from('despesas').select('*').gte('data', inicio).lte('data', fim).order('data', { ascending: false }).limit(10000),
    [inicio, fim],
  )
  const entradas = (pedidos ?? []).filter((p) => !forma || p.forma_pagamento === forma)
  const saidas = (despesas ?? []).filter((d) => (!categoria || d.categoria === categoria) && (!forma || d.forma_pagamento === forma))

  function baixar(formato: 'pdf' | 'xlsx' | 'csv') {
    if (!r) return
    const filtros = [texto, categoria && `categoria: ${categoria}`, forma && `pagamento: ${PAGAMENTO[forma as FormaPagamento]}`].filter(Boolean).join(' · ')
    const tabelas: TabelaExport[] = [
      { titulo: 'Resultado', colunas: ['Linha', 'Valor (R$)'], linhas: linhasResultado(r).map((l) => [l.rotulo, l.valor]) },
      { titulo: 'Entradas por pagamento', colunas: ['Forma de pagamento', 'Pedidos', 'Vendido (R$)', 'Recebido (R$)'], linhas: r.por_pagamento.map((p) => [PAGAMENTO[p.forma], p.pedidos, Number(p.faturamento), Number(p.recebido)]) },
      { titulo: `Faturamento por ${nomePasso[r.agrupar]}`, colunas: ['Data', 'Pedidos', 'Faturamento (R$)'], linhas: r.por_dia.map((d) => [dataCurta(d.dia), d.pedidos, Number(d.faturamento)]) },
      { titulo: 'Saídas por categoria', colunas: ['Categoria', 'Valor (R$)'], linhas: r.despesas_por_categoria.map((d) => [d.categoria, Number(d.valor)]) },
      { titulo: 'Saídas detalhadas', colunas: ['Data', 'Descrição', 'Categoria', 'Pagamento', 'Valor (R$)'], linhas: saidas.map((d) => [dataCurta(d.data), d.descricao, d.categoria, d.forma_pagamento ? PAGAMENTO[d.forma_pagamento] : '', Number(d.valor)]) },
      { titulo: 'Entradas detalhadas', colunas: ['Pedido', 'Data', 'Cliente', 'Pagamento', 'Situação', 'Recebido', 'Valor (R$)'], linhas: entradas.map((p) => [p.numero, dataHora(p.criado_em), p.cliente_nome, PAGAMENTO[p.forma_pagamento], STATUS[p.status].rotulo, p.pago ? 'sim' : 'não', Number(p.total)]) },
    ]
    exportar(formato, `financeiro_${inicio}_a_${fim}`, 'Relatório financeiro', filtros, tabelas)
  }

  return (
    <Pagina titulo="Financeiro" descricao="Entradas, saídas e resultado por dia, semana, mês, ano ou período à escolha." acoes={<BotoesExportar onExportar={baixar} desativado={!r} />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {seletor}
        <Selecao aria-label="Categoria de despesa" className="w-auto" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categorias.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Selecao>
        <Selecao aria-label="Forma de pagamento" className="w-auto" value={forma} onChange={(e) => setForma(e.target.value)}>
          <option value="">Todos os pagamentos</option>
          {Object.entries(PAGAMENTO).map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </Selecao>
      </div>
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'resumo', rotulo: 'Resumo e resultado' },
            { id: 'periodo', rotulo: 'Faturamento por período' },
            { id: 'entradas', rotulo: 'Entradas' },
            { id: 'saidas', rotulo: 'Saídas (despesas)' },
          ]}
        />
      </div>
      {erro && <Erro>{erro}</Erro>}
      {(categoria || forma) && (aba === 'resumo' || aba === 'periodo') && (
        <p className="mb-3 text-sm text-stone-500">Os filtros de categoria e pagamento valem para as abas Entradas e Saídas e para a exportação.</p>
      )}

      {aba === 'saidas' ? (
        <Crud<Despesa>
          tabela="despesas"
          nome="despesa"
          feminino
          ordem="data"
          crescente={false}
          deps={[inicio, fim, categoria, forma]}
          filtrar={(q) => {
            let c = q.gte('data', inicio).lte('data', fim)
            if (categoria) c = c.eq('categoria', categoria)
            if (forma) c = c.eq('forma_pagamento', forma)
            return c
          }}
          aoMudar={() => {
            recarregar()
            recarregarDespesas()
          }}
          texto={(d) => `${d.descricao} ${d.categoria}`}
          topo={<span className="text-sm text-stone-600">Total com esses filtros: <b>{brl(saidas.reduce((s, d) => s + Number(d.valor), 0))}</b></span>}
          colunas={[
            { rotulo: 'Data', classe: 'tabular-nums', render: (d) => dataCurta(d.data) },
            { rotulo: 'Descrição', render: (d) => <b>{d.descricao}</b> },
            { rotulo: 'Categoria', render: (d) => d.categoria },
            { rotulo: 'Pagamento', render: (d) => (d.forma_pagamento ? PAGAMENTO[d.forma_pagamento] : '—') },
            { rotulo: 'Valor', classe: 'tabular-nums font-semibold', render: (d) => brl(d.valor) },
          ]}
          campos={[
            { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, inteira: true },
            { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'moeda', obrigatorio: true },
            { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, padrao: fim },
            { nome: 'categoria', rotulo: 'Categoria', tipo: 'selecao', obrigatorio: true, padrao: categoria || categorias[categorias.length - 1], opcoes: categorias.map((c) => ({ valor: c, rotulo: c })) },
            { nome: 'forma_pagamento', rotulo: 'Forma de pagamento', tipo: 'selecao', opcoes: Object.entries(PAGAMENTO).map(([valor, rotulo]) => ({ valor, rotulo })) },
            { nome: 'observacao', rotulo: 'Observação', tipo: 'area' },
          ]}
        />
      ) : aba === 'entradas' ? (
        <Entradas pedidos={entradas} />
      ) : !r ? (
        carregando && <Carregando />
      ) : (
        <div className={cx('transition-opacity', carregando && 'opacity-60')}>{aba === 'resumo' ? <Resumo r={r} /> : <PorPeriodo r={r} agrupar={agrupar} setAgrupar={setAgrupar} />}</div>
      )}
    </Pagina>
  )
}
