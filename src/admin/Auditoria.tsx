import { useState } from 'react'
import { Carregando, Entrada, Erro, Selecao, Selo, Tabela, Vazio } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { PAGAMENTO, PAPEIS, STATUS, brl, dataHora, diasAtras, isoDia } from '../lib/formato'
import { supabase } from '../lib/supabase'
import type { FormaPagamento, Papel, StatusPedido } from '../lib/tipos'
import { MODULOS, Pagina } from './AdminLayout'

interface Registro {
  id: number
  tabela: string
  registro_id: string | null
  acao: 'criou' | 'alterou' | 'excluiu'
  descricao: string | null
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
  usuario_nome: string | null
  criado_em: string
}

const TABELAS: Record<string, string> = {
  pedidos: 'Pedido', produtos: 'Produto', produto_precos: 'Preço de pizza', adicionais: 'Borda/adicional', promocoes: 'Promoção', cupons: 'Cupom',
  bairros: 'Taxa por bairro', faixas_entrega: 'Faixa de entrega', entregadores: 'Entregador', despesas: 'Despesa', insumos: 'Insumo', estoque: 'Estoque',
  configuracoes: 'Configurações', config_fiscal: 'Configuração fiscal', perfis: 'Usuário', permissoes: 'Permissão',
}
const CAMPOS: Record<string, string> = {
  preco: 'Preço', nome: 'Nome', descricao: 'Descrição', disponivel: 'Disponível', ativo: 'Ativo', destaque: 'Destaque', status: 'Situação', pago: 'Pago',
  taxa_entrega: 'Taxa de entrega', taxa: 'Taxa', ate_km: 'Até (km)', quantidade: 'Quantidade', estoque_minimo: 'Estoque mínimo', valor: 'Valor', papel: 'Função',
  forma_pagamento: 'Forma de pagamento', motivo_cancelamento: 'Motivo do cancelamento', motivo_reembolso: 'Motivo do reembolso', problema_entrega: 'Problema na entrega',
  entregador_id: 'Entregador', pedido_minimo: 'Pedido mínimo', tempo_preparo_min: 'Tempo de preparo', tempo_entrega_min: 'Tempo de entrega', metas: 'Metas',
  alertas_pedido: 'Alertas de atraso', horarios: 'Horários', modo_entrega: 'Modo de entrega', valor_por_entrega: 'Valor por entrega', data_inicio: 'Início', data_fim: 'Fim',
  tipo: 'Tipo', selo: 'Selo', categoria: 'Categoria', data: 'Data', codigo: 'Código', loja_aberta_manual: 'Abertura manual', tempo_extra_min: 'Tempo extra',
}
const COR = { criou: 'bg-emerald-100 text-emerald-900', alterou: 'bg-sky-100 text-sky-900', excluiu: 'bg-red-100 text-red-900' }
const MONETARIOS = new Set(['preco', 'taxa_entrega', 'taxa', 'valor', 'pedido_minimo', 'valor_por_entrega'])

function mostrar(campo: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (campo === 'status') return STATUS[v as StatusPedido]?.rotulo ?? String(v)
  if (campo === 'forma_pagamento') return PAGAMENTO[v as FormaPagamento] ?? String(v)
  if (campo === 'papel') return PAPEIS[v as Papel] ?? String(v)
  if (campo === 'modulo') return MODULOS.find((m) => m.id === v)?.rotulo ?? String(v)
  if (MONETARIOS.has(campo) && typeof v === 'number') return brl(v)
  if (typeof v === 'object') return 'alterado'
  return String(v)
}

function Mudancas({ r }: { r: Registro }) {
  if (r.acao === 'alterou' && r.depois) {
    return (
      <ul>
        {Object.keys(r.depois).map((campo) => (
          <li key={campo}>
            <span className="text-stone-500">{CAMPOS[campo] ?? campo}:</span> {mostrar(campo, r.antes?.[campo])} → <b>{mostrar(campo, r.depois![campo])}</b>
          </li>
        ))}
      </ul>
    )
  }
  const linha = r.depois ?? r.antes ?? {}
  const resumo = ['preco', 'valor', 'taxa_entrega', 'taxa', 'papel', 'modulo', 'tipo']
    .filter((c) => linha[c] != null)
    .map((c) => `${CAMPOS[c] ?? c}: ${mostrar(c, linha[c])}`)
  return <span className="text-stone-600">{resumo.join(' · ') || '—'}</span>
}

/** Quem alterou o quê e quando, com o valor anterior e o novo. Ninguém apaga estes registros pelo painel. */
export default function Auditoria() {
  const [inicio, setInicio] = useState(diasAtras(6))
  const [fim, setFim] = useState(isoDia())
  const [tabela, setTabela] = useState('')
  const [busca, setBusca] = useState('')
  const { dados, carregando, erro } = useConsulta<Registro[]>(() => {
    let q = supabase
      .from('auditoria')
      .select('*')
      .gte('criado_em', new Date(`${inicio}T00:00:00`).toISOString())
      .lte('criado_em', new Date(`${fim}T23:59:59.999`).toISOString())
      .order('criado_em', { ascending: false })
      .limit(1000)
    if (tabela) q = q.eq('tabela', tabela)
    return q
  }, [inicio, fim, tabela])

  const termo = busca.trim().toLowerCase()
  const linhas = (dados ?? []).filter((r) => !termo || `${r.usuario_nome ?? ''} ${r.descricao ?? ''}`.toLowerCase().includes(termo))

  return (
    <Pagina titulo="Auditoria" descricao="Registro das alterações importantes: preços, estoque, pedidos, promoções, taxas, usuários e configurações.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Entrada type="date" aria-label="De" className="w-auto" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
        <span className="text-sm text-stone-500">até</span>
        <Entrada type="date" aria-label="Até" className="w-auto" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
        <Selecao aria-label="O que foi alterado" className="w-auto" value={tabela} onChange={(e) => setTabela(e.target.value)}>
          <option value="">Tudo</option>
          {Object.entries(TABELAS).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Selecao>
        <Entrada type="search" aria-label="Buscar" placeholder="Usuário ou registro" className="w-full sm:w-56" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="text-sm text-stone-500">{linhas.length} registro(s)</span>
      </div>
      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : linhas.length === 0 ? (
        <Vazio titulo="Nenhuma alteração no período" />
      ) : (
        <Tabela colunas={['Data e hora', 'Usuário', 'Ação', 'Registro', 'De → para']}>
          {linhas.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap tabular-nums">{dataHora(r.criado_em)}</td>
              <td>{r.usuario_nome ?? 'Sistema'}</td>
              <td>
                <Selo className={COR[r.acao]}>{r.acao}</Selo>
              </td>
              <td>
                <span className="text-stone-500">{TABELAS[r.tabela] ?? r.tabela}</span>
                <span className="block font-semibold">{r.tabela === 'pedidos' ? `#${r.descricao}` : r.tabela === 'faixas_entrega' ? `até ${r.descricao} km` : r.tabela === 'permissoes' ? mostrar('modulo', r.depois?.modulo ?? r.antes?.modulo) + ' — ' + mostrar('papel', r.depois?.papel ?? r.antes?.papel) : r.descricao}</span>
              </td>
              <td>
                <Mudancas r={r} />
              </td>
            </tr>
          ))}
        </Tabela>
      )}
    </Pagina>
  )
}
