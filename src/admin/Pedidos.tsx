import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bike, Download, Plus, Search, Store } from 'lucide-react'
import { Abas, Botao, Carregando, Entrada, Erro, Selecao, Selo, Tabela, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { exportar } from '../lib/exportar'
import { ORIGEM, PAGAMENTO, STATUS, TIPO, brl, dataHora, haQuanto, isoDia, telefone } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { aceitarPedido, atualizarPedido, mudarStatus, proximoPasso } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Pedido, StatusPedido } from '../lib/tipos'
import { ATRASO, Pagina, nivelAtraso, useAdmin, usePedidosAoVivo, type NivelAtraso } from './AdminLayout'
import { DetalhePedido } from './DetalhePedido'

// pedidos com problema na entrega ficam na coluna "Em entrega", destacados
const COLUNAS: { status: StatusPedido[]; titulo: string }[] = [
  { status: ['novo'], titulo: 'Novos' },
  { status: ['confirmado'], titulo: 'Confirmados' },
  { status: ['em_preparo'], titulo: 'Em preparo' },
  { status: ['pronto'], titulo: 'Prontos' },
  { status: ['saiu_entrega', 'problema_entrega'], titulo: 'Em entrega' },
]

function CartaoPedido({ p, atraso, onAbrir, onAvancar, ocupado }: { p: Pedido; atraso: NivelAtraso | null; onAbrir: () => void; onAvancar: () => void; ocupado: boolean }) {
  const passo = proximoPasso(p)
  const itens = p.pedido_itens ?? []
  const problema = p.status === 'problema_entrega'
  return (
    <article
      className={cx(
        'rounded-xl border-2 bg-white p-3 text-sm shadow-sm',
        problema ? 'border-red-500' : atraso ? ATRASO[atraso].borda : p.status === 'novo' ? 'pulsar-novo border-queijo-400' : 'border-transparent',
      )}
    >
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">#{p.numero}</span>
          <span className="text-stone-500 tabular-nums" title="Tempo desde que o pedido chegou">
            {haQuanto(p.criado_em)}
          </span>
        </div>
        {(problema || atraso) && (
          <p className="mt-1 flex flex-wrap gap-1">
            {problema && <Selo className="bg-red-600 text-white">Problema na entrega</Selo>}
            {atraso && (
              <Selo className={ATRASO[atraso].cor}>
                {ATRASO[atraso].rotulo} · {haQuanto(p.status_em)} parado
              </Selo>
            )}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1.5 font-semibold">
          {p.tipo === 'entrega' ? <Bike className="size-4 shrink-0 text-stone-500" /> : <Store className="size-4 shrink-0 text-stone-500" />}
          <span className="truncate">{p.cliente_nome}</span>
        </p>
        <p className="truncate text-stone-500">{p.tipo === 'entrega' ? [p.bairro ?? 'Entrega', p.entregadores?.nome].filter(Boolean).join(' · ') : TIPO[p.tipo]}</p>
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
    () => supabase.from('pedidos').select('*, pedido_itens(id, nome, quantidade), entregadores(nome)').in('status', COLUNAS.flatMap((c) => c.status)).order('criado_em'),
    [versao],
  )
  usePedidosAoVivo(recarregar)
  useEffect(() => {
    const t = setInterval(() => setRelogio((n) => n + 1), 30_000) // mantém tempos e alertas de atraso em dia
    return () => clearInterval(t)
  }, [])

  async function avancar(p: Pedido) {
    const passo = proximoPasso(p)
    if (!passo || !config) return
    setOcupado(p.id)
    try {
      const r =
        passo.status === 'confirmado' ? await aceitarPedido(p.id, config, fiscal)
        : p.status === 'problema_entrega' ? await atualizarPedido(p.id, { status: 'saiu_entrega', problema_entrega: null })
        : await mudarStatus(p, passo.status)
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

  const atrasos = new Map(dados.map((p) => [p.id, nivelAtraso(p.status_em, config)]))
  const contagem = (nivel: NivelAtraso) => dados.filter((p) => atrasos.get(p.id) === nivel).length
  const problemas = dados.filter((p) => p.status === 'problema_entrega').length
  const alertas = (['critico', 'atrasado', 'atencao'] as NivelAtraso[]).filter((n) => contagem(n) > 0)

  return (
    <>
      {(alertas.length > 0 || problemas > 0) && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          <AlertTriangle className="size-4 shrink-0" />
          <b>Pedidos parados há muito tempo:</b>
          {alertas.map((n) => (
            <Selo key={n} className={ATRASO[n].cor}>
              {contagem(n)} {ATRASO[n].rotulo.toLowerCase()}
            </Selo>
          ))}
          {problemas > 0 && <Selo className="bg-red-600 text-white">{problemas} com problema na entrega</Selo>}
          <span className="text-xs text-amber-800">
            Limites: {config?.alertas_pedido.atencao}, {config?.alertas_pedido.atrasado} e {config?.alertas_pedido.critico} min sem mudar de etapa.
          </span>
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUNAS.map((col) => {
          const lista = dados.filter((p) => col.status.includes(p.status))
          return (
            <section key={col.titulo} className="w-64 shrink-0 rounded-xl bg-stone-200/60 p-2 xl:w-auto xl:min-w-0 xl:flex-1">
              <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-bold">
                {col.titulo}
                <span className="rounded-full bg-white px-2 text-xs tabular-nums">{lista.length}</span>
              </h2>
              <div className="space-y-2">
                {lista.map((p) => (
                  <CartaoPedido key={p.id} p={p} atraso={atrasos.get(p.id) ?? null} ocupado={ocupado === p.id} onAbrir={() => onAbrir(p.id)} onAvancar={() => avancar(p)} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

function Historico({ onAbrir, versao }: { onAbrir: (id: string) => void; versao: number }) {
  const [inicio, setInicio] = useState(isoDia())
  const [fim, setFim] = useState(isoDia())
  const [status, setStatus] = useState('')
  const [pagamento, setPagamento] = useState('')
  const [busca, setBusca] = useState('')
  const { dados, carregando, erro } = useConsulta<Pedido[]>(() => {
    let q = supabase
      .from('pedidos')
      .select('*, entregadores(nome)')
      .gte('criado_em', new Date(`${inicio}T00:00:00`).toISOString())
      .lte('criado_em', new Date(`${fim}T23:59:59.999`).toISOString())
      .order('criado_em', { ascending: false })
      .limit(2000)
    if (status) q = q.eq('status', status)
    if (pagamento) q = q.eq('forma_pagamento', pagamento)
    return q
  }, [inicio, fim, status, pagamento, versao])

  const termo = busca.trim().toLowerCase().replace(/^#/, '')
  const linhas = (dados ?? []).filter((p) => !termo || `${p.numero} ${p.cliente_nome} ${p.cliente_telefone ?? ''} ${p.codigo}`.toLowerCase().includes(termo))
  const total = linhas.filter((p) => p.status !== 'cancelado' && p.status !== 'reembolsado').reduce((s, p) => s + Number(p.total), 0)

  const baixar = (formato: 'csv' | 'xlsx' | 'pdf') =>
    exportar(formato, `pedidos_${inicio}_a_${fim}`, 'Pedidos', `De ${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')} · ${linhas.length} pedido(s) · ${brl(total)} em vendas válidas`, [
      {
        titulo: 'Pedidos',
        colunas: ['Nº', 'Data', 'Cliente', 'Telefone', 'Tipo', 'Canal', 'Situação', 'Bairro', 'Motoboy', 'Subtotal', 'Entrega', 'Desconto', 'Total', 'Pagamento', 'Pago'],
        linhas: linhas.map((p) => [
          p.numero, dataHora(p.criado_em), p.cliente_nome, telefone(p.cliente_telefone), TIPO[p.tipo], ORIGEM[p.origem], STATUS[p.status].rotulo, p.bairro ?? '',
          p.entregadores?.nome ?? '', Number(p.subtotal), Number(p.taxa_entrega), Number(p.desconto), Number(p.total), PAGAMENTO[p.forma_pagamento], p.pago ? 'sim' : 'não',
        ]),
      },
    ])

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Entrada type="date" aria-label="De" className="w-auto" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
        <span className="text-sm text-stone-500">até</span>
        <Entrada type="date" aria-label="Até" className="w-auto" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
        <Selecao aria-label="Situação" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(STATUS).map(([v, s]) => (
            <option key={v} value={v}>
              {s.rotulo}
            </option>
          ))}
        </Selecao>
        <Selecao aria-label="Forma de pagamento" className="w-auto" value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
          <option value="">Todos os pagamentos</option>
          {Object.entries(PAGAMENTO).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Selecao>
        <Entrada type="search" aria-label="Buscar" placeholder="Nº, nome ou telefone" className="w-full sm:w-52" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="ml-auto flex gap-1">
          {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
            <Botao key={f} variante="secundario" disabled={!linhas.length} onClick={() => baixar(f)}>
              <Download className="size-4" /> {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
            </Botao>
          ))}
        </div>
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
          <Tabela colunas={['Nº', 'Data', 'Cliente', 'Tipo', 'Situação', 'Pagamento', 'Total']}>
            {linhas.slice(0, 500).map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-stone-50" onClick={() => onAbrir(p.id)}>
                <td className="font-semibold">#{p.numero}</td>
                <td className="whitespace-nowrap tabular-nums">{dataHora(p.criado_em)}</td>
                <td>
                  {p.cliente_nome}
                  <span className="block text-xs text-stone-500">{telefone(p.cliente_telefone)}</span>
                </td>
                <td>
                  {TIPO[p.tipo]}
                  <span className="block text-xs text-stone-500">{[ORIGEM[p.origem], p.entregadores?.nome].filter(Boolean).join(' · ')}</span>
                </td>
                <td>
                  <Selo className={STATUS[p.status].cor}>{STATUS[p.status].rotulo}</Selo>
                </td>
                <td>
                  {PAGAMENTO[p.forma_pagamento]}
                  {p.status !== 'cancelado' && p.status !== 'reembolsado' && <span className={cx('block text-xs', p.pago ? 'text-emerald-700' : 'text-amber-700')}>{p.pago ? 'Pago' : 'A receber'}</span>}
                </td>
                <td className="font-semibold tabular-nums">{brl(p.total)}</td>
              </tr>
            ))}
          </Tabela>
          {linhas.length > 500 && <p className="mt-2 text-sm text-stone-500">Mostrando os 500 mais recentes; a exportação traz todos.</p>}
        </>
      )}
    </>
  )
}

export default function Pedidos() {
  const aviso = useAviso()
  const [aba, setAba] = useState<'quadro' | 'historico'>('quadro')
  const [aberto, setAberto] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [numero, setNumero] = useState('')

  async function buscarNumero(e: FormEvent) {
    e.preventDefault()
    const n = Number(numero.replace(/\D/g, ''))
    if (!n) return
    const { data } = await supabase.from('pedidos').select('id').eq('numero', n).maybeSingle()
    if (!data) return aviso.erro(`Não existe pedido #${n}.`)
    setAberto(data.id)
    setNumero('')
  }

  return (
    <Pagina
      titulo="Pedidos"
      descricao="Acompanhe cada pedido do recebimento até a entrega."
      acoes={
        <>
          <form onSubmit={buscarNumero} className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone-400" />
            <Entrada aria-label="Buscar pedido pelo número" inputMode="numeric" placeholder="Buscar nº do pedido" className="w-48 pl-9" value={numero} onChange={(e) => setNumero(e.target.value)} />
          </form>
          <Link to="/admin/pdv" className="inline-flex h-10 items-center gap-2 rounded-lg bg-molho-600 px-4 text-sm font-semibold text-white hover:bg-molho-700">
            <Plus className="size-4" /> Novo pedido
          </Link>
        </>
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
