import { useState } from 'react'
import { Download } from 'lucide-react'
import { Crud } from '../components/Crud'
import { Abas, Botao, Carregando, Cartao, Erro, Tabela, cx } from '../components/ui'
import { PAGAMENTO, baixarCsv, brl, dataCurta } from '../lib/formato'
import type { FormaPagamento } from '../lib/tipos'
import { Pagina } from './AdminLayout'
import { Quadro, Tendencia } from './graficos'
import { usePeriodo, useRelatorio, type Relatorio } from './Painel'

const CATEGORIAS = ['Aluguel', 'Energia', 'Água', 'Gás', 'Internet e telefone', 'Salários', 'Entregadores', 'Fornecedores', 'Embalagens', 'Marketing', 'Impostos e taxas', 'Manutenção', 'Outros']

interface Despesa {
  id: string
  descricao: string
  categoria: string
  valor: number
  data: string
  forma_pagamento: FormaPagamento | null
  observacao: string | null
}

function Resultado({ r }: { r: Relatorio }) {
  const s = r.resumo
  const produtos = Number(s.faturamento) - Number(s.taxas_entrega) + Number(s.descontos)
  const lucroBruto = Number(s.faturamento) - Number(s.cmv) - Number(s.perdas)
  const resultado = lucroBruto - Number(s.despesas)
  const margem = Number(s.faturamento) > 0 ? (resultado / Number(s.faturamento)) * 100 : 0

  const linhas: { rotulo: string; valor: number; tipo?: 'total' | 'menos' | 'final'; dica?: string }[] = [
    { rotulo: 'Venda de produtos', valor: produtos },
    { rotulo: 'Taxas de entrega', valor: Number(s.taxas_entrega) },
    { rotulo: 'Descontos e cupons', valor: -Number(s.descontos) || 0, tipo: 'menos' },
    { rotulo: 'Faturamento', valor: Number(s.faturamento), tipo: 'total' },
    { rotulo: 'Custo dos insumos vendidos', valor: -Number(s.cmv) || 0, tipo: 'menos', dica: 'Calculado pelas fichas técnicas e pelo custo médio do estoque.' },
    { rotulo: 'Perdas de estoque', valor: -Number(s.perdas) || 0, tipo: 'menos' },
    { rotulo: 'Lucro bruto', valor: lucroBruto, tipo: 'total' },
    { rotulo: 'Despesas lançadas', valor: -Number(s.despesas) || 0, tipo: 'menos' },
    { rotulo: 'Resultado do período', valor: resultado, tipo: 'final' },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Cartao className="overflow-hidden">
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
      <div className="space-y-3">
        <Cartao className="p-4">
          <p className="text-sm text-stone-500">Margem sobre o faturamento</p>
          <p className="mt-1 text-2xl font-semibold">{margem.toFixed(1).replace('.', ',')}%</p>
        </Cartao>
        <Cartao className="p-4">
          <p className="text-sm text-stone-500">Recebido / a receber</p>
          <p className="mt-1 text-2xl font-semibold">{brl(s.recebido)}</p>
          <p className="text-sm text-stone-500">{brl(s.a_receber)} ainda a receber</p>
        </Cartao>
        <p className="text-xs text-stone-500">
          Estimativa gerencial: o resultado só fica fiel se as despesas forem lançadas e as fichas técnicas e os custos de entrada no estoque estiverem em dia. Não substitui a contabilidade.
        </p>
      </div>
    </div>
  )
}

function PorDia({ r }: { r: Relatorio }) {
  const dias = r.por_dia.slice().reverse()
  return (
    <div className="space-y-4">
      <Quadro titulo="Faturamento por dia">
        <Tendencia formato={brl} dados={r.por_dia.map((d) => ({ rotulo: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`, valor: Number(d.faturamento), detalhe: `${dataCurta(d.dia)} · ${d.pedidos} pedido(s)` }))} />
      </Quadro>
      <div className="flex justify-end">
        <Botao
          variante="secundario"
          onClick={() =>
            baixarCsv(`faturamento_${r.inicio}_a_${r.fim}`, r.por_dia.map((d) => ({ dia: dataCurta(d.dia), pedidos: d.pedidos, faturamento: Number(d.faturamento), ticket_medio: d.pedidos ? Math.round((Number(d.faturamento) / d.pedidos) * 100) / 100 : 0 })))
          }
        >
          <Download className="size-4" /> Exportar
        </Botao>
      </div>
      <Tabela colunas={['Dia', 'Pedidos', 'Faturamento', 'Ticket médio']}>
        {dias.map((d) => (
          <tr key={d.dia}>
            <td className="tabular-nums">{dataCurta(d.dia)}</td>
            <td className="tabular-nums">{d.pedidos}</td>
            <td className="font-semibold tabular-nums">{brl(d.faturamento)}</td>
            <td className="tabular-nums">{d.pedidos ? brl(Number(d.faturamento) / d.pedidos) : '—'}</td>
          </tr>
        ))}
        <tr className="bg-stone-50 font-bold">
          <td>Total</td>
          <td className="tabular-nums">{r.resumo.pedidos}</td>
          <td className="tabular-nums">{brl(r.resumo.faturamento)}</td>
          <td className="tabular-nums">{brl(r.resumo.ticket_medio)}</td>
        </tr>
      </Tabela>
    </div>
  )
}

export default function Financeiro() {
  const [aba, setAba] = useState<'resultado' | 'dias' | 'despesas'>('resultado')
  const { inicio, fim, seletor } = usePeriodo('mes')
  const { dados: r, carregando, erro, recarregar } = useRelatorio(inicio, fim)

  return (
    <Pagina titulo="Financeiro" descricao="Histórico de faturamento, despesas e resultado.">
      <div className="mb-4">{seletor}</div>
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'resultado', rotulo: 'Resultado' },
            { id: 'dias', rotulo: 'Faturamento por dia' },
            { id: 'despesas', rotulo: 'Despesas' },
          ]}
        />
      </div>
      {erro && <Erro>{erro}</Erro>}

      {aba === 'despesas' ? (
        <Crud<Despesa>
          tabela="despesas"
          nome="despesa"
          feminino
          ordem="data"
          crescente={false}
          deps={[inicio, fim]}
          filtrar={(q) => q.gte('data', inicio).lte('data', fim)}
          aoMudar={recarregar}
          texto={(d) => `${d.descricao} ${d.categoria}`}
          topo={<span className="text-sm text-stone-600">Total no período: <b>{brl(r?.resumo.despesas)}</b></span>}
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
            { nome: 'categoria', rotulo: 'Categoria', tipo: 'selecao', obrigatorio: true, padrao: 'Outros', opcoes: CATEGORIAS.map((c) => ({ valor: c, rotulo: c })) },
            { nome: 'forma_pagamento', rotulo: 'Forma de pagamento', tipo: 'selecao', opcoes: Object.entries(PAGAMENTO).map(([valor, rotulo]) => ({ valor, rotulo })) },
            { nome: 'observacao', rotulo: 'Observação', tipo: 'area' },
          ]}
        />
      ) : !r ? (
        carregando && <Carregando />
      ) : (
        <div className={cx('transition-opacity', carregando && 'opacity-60')}>{aba === 'resultado' ? <Resultado r={r} /> : <PorDia r={r} />}</div>
      )}
    </Pagina>
  )
}
