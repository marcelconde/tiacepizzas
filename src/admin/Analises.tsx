import { useState } from 'react'
import { Download } from 'lucide-react'
import { Abas, Botao, Carregando, Cartao, Erro, Modal, Tabela, Vazio } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { exportar } from '../lib/exportar'
import { brl, dataCurta, dataHora, num, telefone } from '../lib/formato'
import { supabase } from '../lib/supabase'
import { Pagina } from './AdminLayout'
import { usePeriodo } from './Painel'

interface ProdutoAnalise {
  produto_id: string
  nome: string
  categoria: string
  quantidade: number
  faturamento: number
  pedidos: number
  participacao: number
}
interface ClienteAnalise {
  id: string
  nome: string
  telefone: string | null
  pedidos: number
  pizzas: number
  total: number
  ticket_medio: number
  ultimo_pedido_em: string
}
export interface DetalheCliente {
  pedidos: number
  total: number
  ticket_medio: number
  pizzas: number
  ultimo_pedido_em: string | null
  datas: { id: string; numero: number; criado_em: string; total: number }[]
  produtos: { nome: string; quantidade: number; total: number }[]
}

export function BotoesExportar({ onExportar, desativado }: { onExportar: (formato: 'pdf' | 'xlsx' | 'csv') => void; desativado?: boolean }) {
  return (
    <div className="flex gap-1">
      {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
        <Botao key={f} variante="secundario" disabled={desativado} onClick={() => onExportar(f)}>
          <Download className="size-4" /> {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
        </Botao>
      ))}
    </div>
  )
}

const Destaque = ({ rotulo, titulo, detalhe }: { rotulo: string; titulo: string; detalhe: string }) => (
  <Cartao className="p-4">
    <p className="text-sm text-stone-500">{rotulo}</p>
    <p className="mt-1 truncate text-xl font-semibold">{titulo}</p>
    <p className="text-sm text-stone-600">{detalhe}</p>
  </Cartao>
)

/** Barra de participação: comparação de magnitude numa só cor, com o valor escrito ao lado. */
const Participacao = ({ valor }: { valor: number }) => (
  <div className="flex items-center gap-2">
    <div className="h-2 w-24 rounded-r bg-stone-100">
      <div className="h-2 rounded-r" style={{ width: `${Math.min(100, valor)}%`, background: '#2a78d6' }} />
    </div>
    <span className="tabular-nums">{String(valor).replace('.', ',')}%</span>
  </div>
)

function Produtos({ inicio, fim, texto }: { inicio: string; fim: string; texto: string }) {
  const { dados, carregando, erro } = useConsulta<ProdutoAnalise[]>(() => supabase.rpc('analise_produtos', { p_inicio: inicio, p_fim: fim }), [inicio, fim])
  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !dados) return <Carregando />
  const lista = dados ?? []
  const vendidos = lista.filter((p) => Number(p.quantidade) > 0)
  if (!vendidos.length) return <Vazio titulo="Nenhuma venda no período" />
  const porQuantidade = vendidos.slice().sort((a, b) => Number(b.quantidade) - Number(a.quantidade))
  const parados = lista.filter((p) => Number(p.quantidade) === 0)

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Destaque rotulo="Mais vendido (em quantidade)" titulo={porQuantidade[0].nome} detalhe={`${num(porQuantidade[0].quantidade)} unidade(s) · ${brl(porQuantidade[0].faturamento)}`} />
        <Destaque rotulo="Maior faturamento" titulo={vendidos[0].nome} detalhe={`${brl(vendidos[0].faturamento)} · ${String(vendidos[0].participacao).replace('.', ',')}% das vendas`} />
        <Destaque
          rotulo="Menos vendido"
          titulo={parados.length ? `${parados.length} produto(s) sem venda` : porQuantidade[porQuantidade.length - 1].nome}
          detalhe={parados.length ? parados.slice(0, 3).map((p) => p.nome).join(', ') + (parados.length > 3 ? '…' : '') : `${num(porQuantidade[porQuantidade.length - 1].quantidade)} unidade(s)`}
        />
      </div>
      <div className="mb-3 flex justify-end">
        <BotoesExportar
          onExportar={(f) =>
            exportar(f, `produtos_${inicio}_a_${fim}`, 'Análise de produtos', texto, [
              { titulo: 'Produtos', colunas: ['Posição', 'Produto', 'Categoria', 'Quantidade', 'Faturamento', 'Participação (%)', 'Pedidos'], linhas: lista.map((p, i) => [i + 1, p.nome, p.categoria, Number(p.quantidade), Number(p.faturamento), Number(p.participacao), p.pedidos]) },
            ])
          }
        />
      </div>
      <Tabela colunas={['#', 'Produto', 'Categoria', 'Quantidade', 'Faturamento', 'Participação nas vendas', 'Pedidos']}>
        {lista.map((p, i) => (
          <tr key={p.produto_id} className={Number(p.quantidade) === 0 ? 'text-stone-400' : ''}>
            <td className="tabular-nums">{i + 1}</td>
            <td className="font-semibold">{p.nome}</td>
            <td>{p.categoria}</td>
            <td className="tabular-nums">{num(p.quantidade)}</td>
            <td className="tabular-nums">{brl(p.faturamento)}</td>
            <td>
              <Participacao valor={Number(p.participacao)} />
            </td>
            <td className="tabular-nums">{p.pedidos}</td>
          </tr>
        ))}
      </Tabela>
      <p className="mt-2 text-xs text-stone-500">Pizzas com mais de um sabor contam a fração de cada sabor (meia pizza = 0,5).</p>
    </>
  )
}

/** Compras de um cliente: resumo, produtos e datas dos pedidos. Usado aqui e na ficha do cliente. */
export function ComprasDoCliente({ clienteId, inicio, fim, onAbrirPedido }: { clienteId: string; inicio?: string; fim?: string; onAbrirPedido?: (id: string) => void }) {
  const { dados: d, carregando, erro } = useConsulta<DetalheCliente>(
    () => supabase.rpc('analise_cliente', { p_cliente: clienteId, p_inicio: inicio ?? null, p_fim: fim ?? null }),
    [clienteId, inicio, fim],
  )
  if (erro) return <Erro>{erro}</Erro>
  if (carregando || !d) return <Carregando />
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Pedidos', num(d.pedidos)],
          ['Pizzas', num(d.pizzas)],
          ['Total gasto', brl(d.total)],
          ['Ticket médio', brl(d.ticket_medio)],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-lg bg-stone-50 p-3">
            <p className="text-xs text-stone-500">{rotulo}</p>
            <p className="text-lg font-semibold">{valor}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 font-semibold">Produtos mais comprados</h3>
          {d.produtos.length === 0 && <p className="text-stone-500">Sem compras no período.</p>}
          <ul className="divide-y divide-stone-100">
            {d.produtos.map((p) => (
              <li key={p.nome} className="flex justify-between gap-3 py-1.5">
                <span>
                  <b>{num(p.quantidade)}x</b> {p.nome}
                </span>
                <span className="tabular-nums">{brl(p.total)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Datas dos pedidos</h3>
          <ul className="max-h-64 divide-y divide-stone-100 overflow-y-auto">
            {d.datas.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={!onAbrirPedido} onClick={() => onAbrirPedido?.(p.id)} className="flex w-full justify-between gap-3 py-1.5 text-left enabled:hover:bg-stone-50">
                  <span>
                    <b>#{p.numero}</b> · {dataHora(p.criado_em)}
                  </span>
                  <span className="tabular-nums">{brl(p.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Clientes({ inicio, fim, texto }: { inicio: string; fim: string; texto: string }) {
  const [aberto, setAberto] = useState<ClienteAnalise | null>(null)
  const { dados, carregando, erro } = useConsulta<ClienteAnalise[]>(() => supabase.rpc('analise_clientes', { p_inicio: inicio, p_fim: fim }), [inicio, fim])
  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !dados) return <Carregando />
  const lista = dados ?? []
  if (!lista.length) return <Vazio titulo="Nenhum cliente comprou no período" texto="Só entram pedidos com telefone ou conta de cliente." />
  const maisPedidos = lista.slice().sort((a, b) => b.pedidos - a.pedidos)[0]

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Destaque rotulo="Quem mais gastou" titulo={lista[0].nome} detalhe={`${brl(lista[0].total)} em ${lista[0].pedidos} pedido(s)`} />
        <Destaque rotulo="Quem mais pediu" titulo={maisPedidos.nome} detalhe={`${maisPedidos.pedidos} pedido(s) · ${num(maisPedidos.pizzas)} pizza(s)`} />
        <Destaque rotulo="Clientes no período" titulo={num(lista.length)} detalhe={`ticket médio de ${brl(lista.reduce((s, c) => s + Number(c.total), 0) / lista.reduce((s, c) => s + c.pedidos, 0))}`} />
      </div>
      <div className="mb-3 flex justify-end">
        <BotoesExportar
          onExportar={(f) =>
            exportar(f, `clientes_${inicio}_a_${fim}`, 'Análise de clientes', texto, [
              { titulo: 'Clientes', colunas: ['Posição', 'Cliente', 'Telefone', 'Pedidos', 'Pizzas', 'Total gasto', 'Ticket médio', 'Último pedido'], linhas: lista.map((c, i) => [i + 1, c.nome, telefone(c.telefone), c.pedidos, Number(c.pizzas), Number(c.total), Number(c.ticket_medio), dataCurta(c.ultimo_pedido_em)]) },
            ])
          }
        />
      </div>
      <Tabela colunas={['#', 'Cliente', 'Telefone', 'Pedidos', 'Pizzas', 'Total gasto', 'Ticket médio', 'Último pedido']}>
        {lista.map((c, i) => (
          <tr key={c.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setAberto(c)}>
            <td className="tabular-nums">{i + 1}</td>
            <td className="font-semibold">{c.nome}</td>
            <td className="whitespace-nowrap tabular-nums">{telefone(c.telefone)}</td>
            <td className="tabular-nums">{c.pedidos}</td>
            <td className="tabular-nums">{num(c.pizzas)}</td>
            <td className="font-semibold tabular-nums">{brl(c.total)}</td>
            <td className="tabular-nums">{brl(c.ticket_medio)}</td>
            <td className="tabular-nums">{dataCurta(c.ultimo_pedido_em)}</td>
          </tr>
        ))}
      </Tabela>
      <Modal aberto={aberto != null} titulo={aberto ? `${aberto.nome} — ${texto}` : ''} onFechar={() => setAberto(null)} largura="max-w-2xl">
        {aberto && <ComprasDoCliente clienteId={aberto.id} inicio={inicio} fim={fim} />}
      </Modal>
    </>
  )
}

export default function Analises() {
  const [aba, setAba] = useState<'produtos' | 'clientes'>('produtos')
  const { inicio, fim, seletor, texto } = usePeriodo('mes')
  return (
    <Pagina titulo="Análises" descricao="Quem compra mais e o que vende mais, para planejar promoções e campanhas.">
      <div className="mb-4">{seletor}</div>
      <div className="mb-4">
        <Abas atual={aba} onChange={setAba} abas={[{ id: 'produtos', rotulo: 'Produtos' }, { id: 'clientes', rotulo: 'Clientes' }]} />
      </div>
      {aba === 'produtos' ? <Produtos inicio={inicio} fim={fim} texto={texto} /> : <Clientes inicio={inicio} fim={fim} texto={texto} />}
    </Pagina>
  )
}
