import { useState, type FormEvent } from 'react'
import { ArrowDownToLine, Download, SlidersHorizontal } from 'lucide-react'
import { Crud } from '../components/Crud'
import { Abas, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selecao, Selo, Tabela, Vazio, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { exportar } from '../lib/exportar'
import { brl, dataCurta, dataHora, isoDia, num } from '../lib/formato'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Insumo } from '../lib/tipos'
import { Pagina } from './AdminLayout'
import { FormDesperdicio } from './Desperdicio'

const TIPOS_MOV = {
  entrada: { rotulo: 'Entrada (compra)', cor: 'bg-emerald-100 text-emerald-900' },
  saida: { rotulo: 'Saída (uso interno)', cor: 'bg-stone-200 text-stone-800' },
  perda: { rotulo: 'Perda / vencimento', cor: 'bg-red-100 text-red-900' },
  desperdicio: { rotulo: 'Desperdício', cor: 'bg-orange-100 text-orange-900' },
  ajuste: { rotulo: 'Ajuste de contagem', cor: 'bg-sky-100 text-sky-900' },
  venda: { rotulo: 'Venda', cor: 'bg-stone-100 text-stone-700' },
  estorno: { rotulo: 'Estorno', cor: 'bg-amber-100 text-amber-900' },
}
type TipoMov = keyof typeof TIPOS_MOV

interface Fornecedor {
  id: string
  nome: string
  telefone: string | null
  cnpj: string | null
  observacoes: string | null
  ativo: boolean
}

interface Movimento {
  id: string
  tipo: TipoMov
  quantidade: number
  custo_unitario: number | null
  observacao: string | null
  criado_em: string
  insumos: { nome: string; unidade: string } | null
  pedidos: { numero: number } | null
}

function Movimentar({ insumo, tipoInicial, onFechar, onSalvo }: { insumo: Insumo; tipoInicial: TipoMov; onFechar: () => void; onSalvo: () => void }) {
  const aviso = useAviso()
  const [tipo, setTipo] = useState<TipoMov>(tipoInicial)
  const [quantidade, setQuantidade] = useState('')
  const [custo, setCusto] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const n = (s: string) => Number(s.replace(',', '.'))
  // no ajuste a pessoa informa o que contou; o sistema calcula a diferença
  const delta = tipo === 'ajuste' ? n(quantidade) - Number(insumo.quantidade) : n(quantidade)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!delta) return aviso.erro(tipo === 'ajuste' ? 'A contagem é igual ao estoque atual.' : 'Informe a quantidade.')
    setSalvando(true)
    const { error } = await supabase.from('estoque_movimentos').insert({
      insumo_id: insumo.id,
      tipo,
      quantidade: delta,
      custo_unitario: tipo === 'entrada' && custo ? n(custo) : null,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Estoque atualizado')
    onSalvo()
    onFechar()
  }

  return (
    <Modal aberto titulo={insumo.nome} onFechar={onFechar} largura="max-w-md">
      <p className="mb-4 text-sm text-stone-600">
        Em estoque: <b>{num(insumo.quantidade)} {insumo.unidade}</b> · custo médio {brl(insumo.custo_unitario)}/{insumo.unidade}
      </p>
      <form onSubmit={salvar} className="space-y-4">
        <Campo rotulo="Tipo de movimento">
          <Selecao value={tipo} onChange={(e) => setTipo(e.target.value as TipoMov)}>
            {(['entrada', 'saida', 'perda', 'ajuste'] as TipoMov[]).map((t) => (
              <option key={t} value={t}>
                {TIPOS_MOV[t].rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo={tipo === 'ajuste' ? `Quantidade contada (${insumo.unidade})` : `Quantidade (${insumo.unidade})`}>
            <Entrada required autoFocus inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </Campo>
          {tipo === 'entrada' && (
            <Campo rotulo={`Custo por ${insumo.unidade} (R$)`} dica="Atualiza o custo médio.">
              <Entrada inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} />
            </Campo>
          )}
        </div>
        {tipo === 'ajuste' && quantidade !== '' && (
          <p className="text-sm text-stone-600">
            Diferença: <b>{delta > 0 ? '+' : ''}{num(delta)} {insumo.unidade}</b>
          </p>
        )}
        <Campo rotulo="Observação (opcional)">
          <Entrada placeholder={tipo === 'entrada' ? 'Nota, fornecedor…' : 'Motivo'} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Campo>
        <Botao type="submit" className="w-full" carregando={salvando}>
          Registrar
        </Botao>
      </form>
    </Modal>
  )
}

function Movimentos() {
  const [tipo, setTipo] = useState('')
  const { dados, carregando, erro } = useConsulta<Movimento[]>(() => {
    let q = supabase.from('estoque_movimentos').select('*, insumos(nome, unidade), pedidos(numero)').order('criado_em', { ascending: false }).limit(300)
    if (tipo) q = q.eq('tipo', tipo)
    return q
  }, [tipo])

  return (
    <>
      <Selecao aria-label="Tipo" className="mb-3 w-auto" value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="">Todos os movimentos</option>
        {Object.entries(TIPOS_MOV).map(([v, t]) => (
          <option key={v} value={v}>
            {t.rotulo}
          </option>
        ))}
      </Selecao>
      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhuma movimentação" />
      ) : (
        <Tabela colunas={['Data', 'Insumo', 'Movimento', 'Quantidade', 'Custo', 'Observação']}>
          {dados.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap tabular-nums">{dataHora(m.criado_em)}</td>
              <td className="font-semibold">{m.insumos?.nome}</td>
              <td>
                <Selo className={TIPOS_MOV[m.tipo].cor}>{TIPOS_MOV[m.tipo].rotulo.split(' (')[0]}</Selo>
              </td>
              <td className="whitespace-nowrap tabular-nums">
                {Number(m.quantidade) > 0 ? '+' : ''}
                {num(m.quantidade)} {m.insumos?.unidade}
              </td>
              <td className="tabular-nums">{m.custo_unitario != null ? brl(Math.abs(Number(m.quantidade)) * Number(m.custo_unitario)) : '—'}</td>
              <td className="text-stone-600">{m.pedidos ? `Pedido #${m.pedidos.numero}` : m.observacao}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </>
  )
}

interface Desperdicios {
  total: number
  registros: { id: string; criado_em: string; insumo: string; unidade: string; quantidade: number; valor: number; observacao: string; usuario: string }[]
  por_insumo: { insumo: string; unidade: string; quantidade: number; valor: number; vezes: number }[]
}

const PERIODOS_DESPERDICIO = [
  { id: '7', rotulo: 'Últimos 7 dias' },
  { id: '30', rotulo: 'Últimos 30 dias' },
  { id: '90', rotulo: 'Últimos 90 dias' },
  { id: 'mes', rotulo: 'Este mês' },
]

/** Aba Desperdício: registra o que se perdeu no preparo e mostra o que já foi registrado, com o valor. */
function Desperdicio({ aoMudar }: { aoMudar: () => void }) {
  const [periodo, setPeriodo] = useState('30')
  const [versao, setVersao] = useState(0)
  const hoje = new Date()
  const fim = isoDia(hoje)
  const inicio = isoDia(periodo === 'mes' ? new Date(hoje.getFullYear(), hoje.getMonth(), 1) : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - Number(periodo) + 1))
  const { dados, carregando, erro } = useConsulta<Desperdicios>(() => supabase.rpc('listar_desperdicios', { p_inicio: inicio, p_fim: fim }), [inicio, fim, versao])
  const texto = `${dataCurta(inicio)} a ${dataCurta(fim)}`

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Cartao className="p-4">
        <h2 className="font-display text-lg font-semibold">Registrar desperdício</h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">Caiu no chão, queimou, foi montado errado? Registre aqui: a quantidade sai do estoque e o motivo fica guardado.</p>
        <FormDesperdicio
          aoRegistrar={() => {
            setVersao((v) => v + 1)
            aoMudar()
          }}
        />
      </Cartao>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Selecao aria-label="Período" className="w-auto" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS_DESPERDICIO.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </Selecao>
          <div className="flex gap-1">
            {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
              <Botao
                key={f}
                variante="secundario"
                disabled={!dados?.registros.length}
                onClick={() =>
                  dados &&
                  exportar(f, `desperdicio_${inicio}_a_${fim}`, 'Desperdício', texto, [
                    { titulo: 'Registros', colunas: ['Data', 'Item', 'Quantidade', 'Unidade', 'Valor (R$)', 'O que aconteceu', 'Quem registrou'], linhas: dados.registros.map((d) => [dataHora(d.criado_em), d.insumo, Number(d.quantidade), d.unidade, Number(d.valor), d.observacao, d.usuario]) },
                    { titulo: 'Por item', colunas: ['Item', 'Quantidade', 'Unidade', 'Vezes', 'Valor (R$)'], linhas: dados.por_insumo.map((d) => [d.insumo, Number(d.quantidade), d.unidade, d.vezes, Number(d.valor)]) },
                  ])
                }
              >
                <Download className="size-4" /> {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
              </Botao>
            ))}
          </div>
        </div>
        {erro && <Erro>{erro}</Erro>}
        {carregando && !dados ? (
          <Carregando />
        ) : !dados?.registros.length ? (
          <Vazio titulo="Nenhum desperdício registrado no período" texto="Quando algo se perder no preparo, registre ao lado." />
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Cartao className="p-4">
                <p className="text-sm text-stone-500">Valor desperdiçado no período</p>
                <p className="mt-1 text-2xl font-semibold">{brl(dados.total)}</p>
                <p className="text-sm text-stone-500">
                  {dados.registros.length} registro{dados.registros.length === 1 ? '' : 's'} · pelo custo médio de cada item
                </p>
              </Cartao>
              <Cartao className="p-4">
                <p className="text-sm text-stone-500">O que mais se perde</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {dados.por_insumo.slice(0, 3).map((d) => (
                    <li key={d.insumo} className="flex justify-between gap-3">
                      <span className="font-semibold">{d.insumo}</span>
                      <span className="tabular-nums text-stone-600">
                        {num(d.quantidade)} {d.unidade} · {brl(d.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Cartao>
            </div>
            <Tabela colunas={['Data', 'Item', 'Quantidade', 'Valor', 'O que aconteceu', 'Quem registrou']}>
              {dados.registros.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap tabular-nums">{dataHora(d.criado_em)}</td>
                  <td className="font-semibold">{d.insumo}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {num(d.quantidade)} {d.unidade}
                  </td>
                  <td className="tabular-nums">{brl(d.valor)}</td>
                  <td className="text-stone-700">{d.observacao}</td>
                  <td className="text-stone-600">{d.usuario}</td>
                </tr>
              ))}
            </Tabela>
          </>
        )}
      </div>
    </div>
  )
}

export default function Estoque() {
  const [aba, setAba] = useState<'insumos' | 'desperdicio' | 'movimentos' | 'fornecedores'>('insumos')
  const [versao, setVersao] = useState(0)
  const [mov, setMov] = useState<{ insumo: Insumo; tipo: TipoMov } | null>(null)
  const { dados: fornecedores } = useConsulta<Fornecedor[]>(() => supabase.from('fornecedores').select('*').order('nome'), [aba])
  const { dados: insumos } = useConsulta<Insumo[]>(() => supabase.from('insumos').select('*').eq('ativo', true), [versao])

  const valorTotal = (insumos ?? []).reduce((s, i) => s + Math.max(0, Number(i.quantidade)) * Number(i.custo_unitario), 0)
  const baixos = (insumos ?? []).filter((i) => Number(i.quantidade) <= Number(i.estoque_minimo)).length

  return (
    <Pagina titulo="Estoque" descricao="Insumos, compras, perdas e desperdício. As vendas dão baixa sozinhas pela ficha técnica de cada produto.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'insumos', rotulo: 'Insumos' },
            { id: 'desperdicio', rotulo: 'Desperdício' },
            { id: 'movimentos', rotulo: 'Movimentações' },
            { id: 'fornecedores', rotulo: 'Fornecedores' },
          ]}
        />
      </div>

      {aba === 'insumos' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <Cartao className="p-4">
              <p className="text-sm text-stone-500">Valor em estoque</p>
              <p className="mt-1 text-2xl font-semibold">{brl(valorTotal)}</p>
            </Cartao>
            <Cartao className="p-4">
              <p className="text-sm text-stone-500">Abaixo do mínimo</p>
              <p className="mt-1 text-2xl font-semibold">{baixos}</p>
            </Cartao>
          </div>
          <Crud<Insumo>
            tabela="insumos"
            nome="insumo"
            deps={[versao]}
            aoMudar={() => setVersao((v) => v + 1)}
            texto={(i) => i.nome}
            colunas={[
              { rotulo: 'Insumo', render: (i) => <b className={i.ativo ? '' : 'opacity-50'}>{i.nome}</b> },
              {
                rotulo: 'Em estoque',
                classe: 'whitespace-nowrap tabular-nums',
                render: (i) => (
                  <>
                    {num(i.quantidade)} {i.unidade}{' '}
                    {Number(i.quantidade) <= Number(i.estoque_minimo) && <Selo className="ml-1 bg-red-100 text-red-900">Repor</Selo>}
                  </>
                ),
              },
              { rotulo: 'Mínimo', classe: 'tabular-nums', render: (i) => `${num(i.estoque_minimo)} ${i.unidade}` },
              { rotulo: 'Custo médio', classe: 'tabular-nums', render: (i) => `${brl(i.custo_unitario)}/${i.unidade}` },
              { rotulo: 'Valor', classe: 'tabular-nums', render: (i) => brl(Math.max(0, Number(i.quantidade)) * Number(i.custo_unitario)) },
            ]}
            campos={[
              { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
              {
                nome: 'unidade', rotulo: 'Unidade de medida', tipo: 'selecao', obrigatorio: true, padrao: 'kg',
                opcoes: [{ valor: 'kg', rotulo: 'Quilo (kg)' }, { valor: 'g', rotulo: 'Grama (g)' }, { valor: 'l', rotulo: 'Litro (l)' }, { valor: 'ml', rotulo: 'Mililitro (ml)' }, { valor: 'un', rotulo: 'Unidade (un)' }],
              },
              { nome: 'estoque_minimo', rotulo: 'Estoque mínimo', tipo: 'numero', padrao: 0, obrigatorio: true, dica: 'Abaixo disso o sistema avisa para repor.' },
              { nome: 'fornecedor_id', rotulo: 'Fornecedor', tipo: 'selecao', opcoes: (fornecedores ?? []).map((f) => ({ valor: f.id, rotulo: f.nome })) },
              { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
            ]}
            acoes={(i) => (
              <>
                <Botao variante="secundario" tamanho="p" onClick={() => setMov({ insumo: i, tipo: 'entrada' })}>
                  <ArrowDownToLine className="size-4" /> Entrada
                </Botao>
                <Botao variante="sutil" tamanho="p" title="Saída, perda ou ajuste" aria-label="Saída, perda ou ajuste" onClick={() => setMov({ insumo: i, tipo: 'ajuste' })}>
                  <SlidersHorizontal className="size-4" />
                </Botao>
              </>
            )}
          />
        </>
      )}

      {aba === 'desperdicio' && <Desperdicio aoMudar={() => setVersao((v) => v + 1)} />}

      {aba === 'movimentos' && <Movimentos />}

      {aba === 'fornecedores' && (
        <Crud<Fornecedor>
          tabela="fornecedores"
          nome="fornecedor"
          texto={(f) => f.nome}
          colunas={[
            { rotulo: 'Nome', render: (f) => <b>{f.nome}</b> },
            { rotulo: 'Telefone', render: (f) => f.telefone },
            { rotulo: 'CNPJ', render: (f) => f.cnpj },
            { rotulo: 'Observações', render: (f) => f.observacoes },
          ]}
          campos={[
            { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
            { nome: 'telefone', rotulo: 'Telefone' },
            { nome: 'cnpj', rotulo: 'CNPJ' },
            { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
            { nome: 'observacoes', rotulo: 'Observações', tipo: 'area' },
          ]}
        />
      )}

      {mov && <Movimentar insumo={mov.insumo} tipoInicial={mov.tipo} onFechar={() => setMov(null)} onSalvo={() => setVersao((v) => v + 1)} />}
    </Pagina>
  )
}
