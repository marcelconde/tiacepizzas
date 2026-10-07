import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, Download, Plus, Store } from 'lucide-react'
import { Abas, Botao, Carregando, Entrada, Erro, Selecao, Selo, Tabela, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { ORIGEM, PAGAMENTO, STATUS, TIPO, baixarCsv, brl, dataHora, haQuanto, isoDia, telefone } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { aceitarPedido, mudarStatus, proximoPasso } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Pedido, StatusPedido } from '../lib/tipos'
import { Pagina, useAdmin, usePedidosAoVivo } from './AdminLayout'
import { DetalhePedido } from './DetalhePedido'

const COLUNAS: { status: StatusPedido; titulo: string }[] = [
  { status: 'novo', titulo: 'Novos' },
  { status: 'confirmado', titulo: 'Confirmados' },
  { status: 'em_preparo', titulo: 'Em preparo' },
  { status: 'pronto', titulo: 'Prontos' },
  { status: 'saiu_entrega', titulo: 'Em entrega' },
]

function CartaoPedido({ p, onAbrir, onAvancar, ocupado }: { p: Pedido; onAbrir: () => void; onAvancar: () => void; ocupado: boolean }) {
  const passo = proximoPasso(p)
  const itens = p.pedido_itens ?? []
  const minutos = (Date.now() - new Date(p.criado_em).getTime()) / 60000
  return (
    <article className={cx('rounded-xl border bg-white p-3 text-sm shadow-sm', p.status === 'novo' ? 'pulsar-novo border-queijo-400' : 'border-stone-200')}>
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">#{p.numero}</span>
          <span className={cx('tabular-nums', minutos > 60 ? 'font-bold text-red-700' : 'text-stone-500')}>{haQuanto(p.criado_em)}</span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 font-semibold">
          {p.tipo === 'entrega' ? <Bike className="size-4 shrink-0 text-stone-500" /> : <Store className="size-4 shrink-0 text-stone-500" />}
          <span className="truncate">{p.cliente_nome}</span>
        </p>
        <p className="truncate text-stone-500">{p.tipo === 'entrega' ? (p.bairro ?? 'Entrega') : TIPO[p.tipo]}</p>
        <ul className="mt-2 space-y-0.5 text-stone-700">
          {itens.slice(0, 3).map((i) => (
            <li key={i.id} className="truncate">
              {i.quantidade}x {i.nome}
            </li>
          ))}
          {itens.length > 3 && <li className="text-stone-500">+ {itens.length - 3} item(ns)</li>}
        </ul>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-bold tabular-nums">{brl(p.total)}</span>
          <Selo className={p.pago ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700'}>
            {PAGAMENTO[p.forma_pagamento].replace('Cartão de ', '')}
            {p.pago && ' ✓'}
          </Selo>
        </div>
      </button>
      {passo && (
        <Botao variante={p.status === 'novo' ? 'verde' : 'secundario'} tamanho="p" className="mt-3 w-full" carregando={ocupado} onClick={onAvancar}>
          {passo.rotulo}
        </Botao>
      )}
    </article>
  )
}

function Quadro({ onAbrir, versao }: { onAbrir: (id: string) => void; versao: number }) {
  const { config } = useLoja()
  const { fiscal, sincronizar } = useAdmin()
  const aviso = useAviso()
  const [ocupado, setOcupado] = useState('')
  const [, setRelogio] = useState(0)
  const { dados, carregando, erro, recarregar } = useConsulta<Pedido[]>(
    () => supabase.from('pedidos').select('*, pedido_itens(id, nome, quantidade)').in('status', COLUNAS.map((c) => c.status)).order('criado_em'),
    [versao],
  )
  usePedidosAoVivo(recarregar)
  useEffect(() => {
    const t = setInterval(() => setRelogio((n) => n + 1), 30_000) // mantém o "há X min" em dia
    return () => clearInterval(t)
  }, [])

  async function avancar(p: Pedido) {
    const passo = proximoPasso(p)
    if (!passo || !config) return
    setOcupado(p.id)
    try {
      const r = passo.status === 'confirmado' ? await aceitarPedido(p.id, config, fiscal) : await mudarStatus(p, passo.status)
      ;(Array.isArray(r) ? r : r ? [r] : []).forEach((a) => aviso.erro(a))
      sincronizar()
    } catch (e) {
      aviso.erro(mensagemErro(e))
    } finally {
      setOcupado('')
    }
  }

  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !dados) return <Carregando />
  if (!dados?.length) {
    return (
      <Vazio titulo="Nenhum pedido em andamento" texto="Os pedidos do site aparecem aqui sozinhos, com aviso sonoro. Para pedidos por telefone ou balcão, use “Novo pedido”." />
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUNAS.map((col) => {
        const lista = dados.filter((p) => p.status === col.status)
        return (
          <section key={col.status} className="w-64 shrink-0 rounded-xl bg-stone-200/60 p-2 xl:w-auto xl:min-w-0 xl:flex-1">
            <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-bold">
              {col.titulo}
              <span className="rounded-full bg-white px-2 text-xs tabular-nums">{lista.length}</span>
            </h2>
            <div className="space-y-2">
              {lista.map((p) => (
                <CartaoPedido key={p.id} p={p} ocupado={ocupado === p.id} onAbrir={() => onAbrir(p.id)} onAvancar={() => avancar(p)} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Historico({ onAbrir, versao }: { onAbrir: (id: string) => void; versao: number }) {
  const [inicio, setInicio] = useState(isoDia())
  const [fim, setFim] = useState(isoDia())
  const [status, setStatus] = useState('')
  const [busca, setBusca] = useState('')
  const { dados, carregando, erro } = useConsulta<Pedido[]>(() => {
    let q = supabase
      .from('pedidos')
      .select('*')
      .gte('criado_em', new Date(`${inicio}T00:00:00`).toISOString())
      .lte('criado_em', new Date(`${fim}T23:59:59.999`).toISOString())
      .order('criado_em', { ascending: false })
      .limit(1000)
    if (status) q = q.eq('status', status)
    return q
  }, [inicio, fim, status, versao])

  const termo = busca.trim().toLowerCase()
  const linhas = (dados ?? []).filter((p) => !termo || `${p.numero} ${p.cliente_nome} ${p.cliente_telefone ?? ''} ${p.codigo}`.toLowerCase().includes(termo))
  const total = linhas.filter((p) => p.status !== 'cancelado').reduce((s, p) => s + Number(p.total), 0)

  const exportar = () =>
    baixarCsv(
      `pedidos_${inicio}_a_${fim}`,
      linhas.map((p) => ({
        numero: p.numero, data: dataHora(p.criado_em), cliente: p.cliente_nome, telefone: p.cliente_telefone ?? '', tipo: TIPO[p.tipo],
        origem: ORIGEM[p.origem], status: STATUS[p.status].rotulo, bairro: p.bairro ?? '', subtotal: Number(p.subtotal),
        taxa_entrega: Number(p.taxa_entrega), desconto: Number(p.desconto), total: Number(p.total),
        pagamento: PAGAMENTO[p.forma_pagamento], pago: p.pago ? 'sim' : 'não',
      })),
    )

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Entrada type="date" aria-label="De" className="w-auto" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
        <span className="text-sm text-stone-500">até</span>
        <Entrada type="date" aria-label="Até" className="w-auto" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
        <Selecao aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([v, s]) => (
            <option key={v} value={v}>
              {s.rotulo}
            </option>
          ))}
        </Selecao>
        <Entrada type="search" aria-label="Buscar" placeholder="Nº, nome ou telefone" className="w-full sm:w-56" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Botao variante="secundario" className="ml-auto" disabled={!linhas.length} onClick={exportar}>
          <Download className="size-4" /> Exportar
        </Botao>
      </div>
      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : linhas.length === 0 ? (
        <Vazio titulo="Nenhum pedido no período" />
      ) : (
        <>
          <p className="mb-2 text-sm text-stone-600">
            {linhas.length} pedido(s) · <b>{brl(total)}</b> em vendas válidas
          </p>
          <Tabela colunas={['Nº', 'Data', 'Cliente', 'Tipo', 'Status', 'Pagamento', 'Total']}>
            {linhas.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-stone-50" onClick={() => onAbrir(p.id)}>
                <td className="font-semibold">#{p.numero}</td>
                <td className="whitespace-nowrap tabular-nums">{dataHora(p.criado_em)}</td>
                <td>
                  {p.cliente_nome}
                  <span className="block text-xs text-stone-500">{telefone(p.cliente_telefone)}</span>
                </td>
                <td>
                  {TIPO[p.tipo]}
                  <span className="block text-xs text-stone-500">{ORIGEM[p.origem]}</span>
                </td>
                <td>
                  <Selo className={STATUS[p.status].cor}>{STATUS[p.status].rotulo}</Selo>
                </td>
                <td>
                  {PAGAMENTO[p.forma_pagamento]}
                  {p.status !== 'cancelado' && <span className={cx('block text-xs', p.pago ? 'text-emerald-700' : 'text-amber-700')}>{p.pago ? 'Pago' : 'A receber'}</span>}
                </td>
                <td className="font-semibold tabular-nums">{brl(p.total)}</td>
              </tr>
            ))}
          </Tabela>
        </>
      )}
    </>
  )
}

export default function Pedidos() {
  const [aba, setAba] = useState<'quadro' | 'historico'>('quadro')
  const [aberto, setAberto] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)

  return (
    <Pagina
      titulo="Pedidos"
      descricao="Acompanhe cada pedido do recebimento até a entrega."
      acoes={
        <Link to="/admin/pdv" className="inline-flex h-10 items-center gap-2 rounded-lg bg-molho-600 px-4 text-sm font-semibold text-white hover:bg-molho-700">
          <Plus className="size-4" /> Novo pedido
        </Link>
      }
    >
      <div className="mb-4">
        <Abas abas={[{ id: 'quadro', rotulo: 'Em andamento' }, { id: 'historico', rotulo: 'Histórico' }]} atual={aba} onChange={setAba} />
      </div>
      {aba === 'quadro' ? <Quadro onAbrir={setAberto} versao={versao} /> : <Historico onAbrir={setAberto} versao={versao} />}
      <DetalhePedido pedidoId={aberto} onFechar={() => setAberto(null)} onMudou={() => setVersao((v) => v + 1)} />
    </Pagina>
  )
}
