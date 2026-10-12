import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bike, ChefHat, Plus, Trash2, UserRound, type LucideIcon } from 'lucide-react'
import { AreaTexto, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selecao, Selo, Tabela, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { exportar } from '../lib/exportar'
import { PAGAMENTO, brl, dataCurta, isoDia, num } from '../lib/formato'
import { mensagemErro, supabase } from '../lib/supabase'
import type { FormaPagamento } from '../lib/tipos'
import { Pagina } from './AdminLayout'
import { BotoesExportar } from './Analises'
import { usePeriodo, useRelatorio } from './Painel'

export type TipoFavorecido = 'motoboy' | 'cozinha' | 'outro'
const FAVORECIDO: Record<TipoFavorecido, { rotulo: string; curto: string; icone: LucideIcon; cor: string }> = {
  motoboy: { rotulo: 'Motoboy', curto: 'Motoboy', icone: Bike, cor: 'bg-sky-100 text-sky-900' },
  cozinha: { rotulo: 'Funcionário da cozinha', curto: 'Cozinha', icone: ChefHat, cor: 'bg-amber-100 text-amber-900' },
  outro: { rotulo: 'Outro funcionário', curto: 'Outro', icone: UserRound, cor: 'bg-stone-100 text-stone-700' },
}

/** Uma linha do acerto: quanto o motoboy tem a receber no período, quanto já foi pago e quanto falta. */
export interface AcertoEntregador {
  id: string
  nome: string
  ativo: boolean
  diaria: number
  repasse: 'taxa' | 'fixo'
  valor_por_entrega: number
  entregas: number
  dias: number
  taxas: number
  diarias: number
  por_entregas: number
  a_receber: number
  pago: number
  falta: number
}

interface Pagamento {
  id: string
  valor: number
  data: string
  forma_pagamento: FormaPagamento | null
  observacao: string | null
  favorecido_tipo: TipoFavorecido
  favorecido: string
  entregador_id: string | null
  caixa_movimento_id: string | null
}

/** Como o motoboy é pago, em uma frase. */
export const regraDoMotoboy = (e: { diaria: number; repasse: 'taxa' | 'fixo'; valor_por_entrega: number }) =>
  [Number(e.diaria) > 0 && `diária de ${brl(e.diaria)}`, e.repasse === 'taxa' ? 'a taxa de cada entrega' : `${brl(e.valor_por_entrega)} por entrega`].filter(Boolean).join(' + ')

export const useAcerto = (inicio: string, fim: string) =>
  useConsulta<AcertoEntregador[]>(() => supabase.rpc('acerto_entregadores', { p_inicio: inicio, p_fim: fim }), [inicio, fim])

export interface PagamentoInicial {
  tipo?: TipoFavorecido
  entregador?: string
  valor?: number
  data?: string
}

type Origem = 'caixa' | 'dinheiro' | 'pix'

/** Registra um pagamento a um motoboy ou funcionário. Vira uma saída do dia na hora. */
export function FormPagamento({ inicial, aoRegistrar }: { inicial?: PagamentoInicial; aoRegistrar: () => void }) {
  const aviso = useAviso()
  const [tipo, setTipo] = useState<TipoFavorecido>(inicial?.tipo ?? 'motoboy')
  const [entregador, setEntregador] = useState(inicial?.entregador ?? '')
  const [nome, setNome] = useState('')
  const [valor, setValor] = useState(inicial?.valor ? String(inicial.valor).replace('.', ',') : '')
  const [data, setData] = useState(inicial?.data ?? isoDia())
  const [origem, setOrigem] = useState<Origem>('dinheiro')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const escolheuOrigem = useRef(false)

  const { dados: acerto, recarregar: recarregarAcerto } = useAcerto(data, data)
  const { dados: caixas } = useConsulta<{ id: string }[]>(() => supabase.from('caixas').select('id').is('fechado_em', null).limit(1), [])
  const { dados: equipe } = useConsulta<{ nome: string; papel: string }[]>(() => supabase.from('perfis').select('nome, papel').eq('ativo', true), [])
  const { dados: anteriores } = useConsulta<{ favorecido: string; favorecido_tipo: TipoFavorecido }[]>(
    () => supabase.from('despesas').select('favorecido, favorecido_tipo').not('favorecido_tipo', 'is', null).order('data', { ascending: false }).limit(300),
    [],
  )
  const caixaAberto = Boolean(caixas?.length)
  // com o caixa aberto, o mais comum é o dinheiro sair dele
  useEffect(() => {
    if (caixaAberto && !escolheuOrigem.current) setOrigem('caixa')
  }, [caixaAberto])

  const motoboys = (acerto ?? []).filter((e) => e.ativo || e.id === entregador)
  const escolhido = motoboys.find((e) => e.id === entregador)
  const sugestoes = [
    ...new Set([
      ...(anteriores ?? []).filter((a) => a.favorecido_tipo === tipo).map((a) => a.favorecido),
      ...(equipe ?? []).filter((p) => (tipo === 'cozinha' ? p.papel === 'cozinha' : p.papel !== 'cozinha' && p.papel !== 'motoboy')).map((p) => p.nome),
    ]),
  ]
  const hoje = data === isoDia()

  function escolherMotoboy(id: string) {
    setEntregador(id)
    const e = motoboys.find((x) => x.id === id)
    // já deixa preenchido o que falta pagar a ele nesta data
    if (e && !valor.trim() && Number(e.falta) > 0) setValor(String(e.falta).replace('.', ','))
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const v = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!(v > 0)) return aviso.erro('Informe o valor do pagamento.')
    setSalvando(true)
    const { data: r, error } = await supabase.rpc('registrar_pagamento', {
      p_tipo: tipo,
      p_valor: v,
      p_entregador: tipo === 'motoboy' ? entregador || null : null,
      p_nome: tipo === 'motoboy' ? null : nome,
      p_data: data,
      p_forma: origem === 'pix' ? 'pix' : 'dinheiro',
      p_do_caixa: origem === 'caixa',
      p_observacao: observacao,
    })
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso(`Pagamento de ${brl(v)} para ${(r as { nome: string }).nome} registrado. Já entrou nas saídas ${hoje ? 'de hoje' : `do dia ${dataCurta(data)}`}.`)
    setValor('')
    setObservacao('')
    recarregarAcerto()
    aoRegistrar()
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-forno-800">Para quem é o pagamento?</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(FAVORECIDO) as TipoFavorecido[]).map((t) => {
            const Icone = FAVORECIDO[t].icone
            return (
              <button
                key={t}
                type="button"
                aria-pressed={tipo === t}
                onClick={() => setTipo(t)}
                className={cx('flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-center text-sm font-semibold', tipo === t ? 'border-molho-500 bg-molho-50 text-molho-800' : 'border-stone-200 hover:border-stone-300')}
              >
                <Icone className="size-5" />
                {FAVORECIDO[t].rotulo}
              </button>
            )
          })}
        </div>
      </fieldset>

      {tipo === 'motoboy' ? (
        <Campo rotulo="Qual motoboy?">
          <Selecao required value={entregador} onChange={(e) => escolherMotoboy(e.target.value)}>
            <option value="">Selecione…</option>
            {motoboys.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      ) : (
        <Campo rotulo="Nome de quem recebeu">
          <Entrada required maxLength={80} list="pagamento-nomes" value={nome} onChange={(e) => setNome(e.target.value)} />
          <datalist id="pagamento-nomes">
            {sugestoes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Campo>
      )}

      {tipo === 'motoboy' && escolhido && (
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          <p>
            <b>{escolhido.nome}</b> recebe {regraDoMotoboy(escolhido)}.
          </p>
          <p className="mt-1">
            {hoje ? 'Hoje' : `Em ${dataCurta(data)}`}:{' '}
            {escolhido.entregas > 0 ? (
              <>
                {brl(escolhido.diarias)} de diária + {brl(escolhido.por_entregas)} de {escolhido.entregas} entrega{escolhido.entregas > 1 ? 's' : ''} = <b>{brl(escolhido.a_receber)}</b>.
              </>
            ) : (
              'nenhuma entrega concluída ainda.'
            )}
            {Number(escolhido.pago) > 0 && <> Já pago: {brl(escolhido.pago)}.</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Number(escolhido.falta) > 0 && (
              <Botao variante="secundario" tamanho="p" onClick={() => setValor(String(escolhido.falta).replace('.', ','))}>
                Usar o que falta: {brl(escolhido.falta)}
              </Botao>
            )}
            {escolhido.entregas === 0 && Number(escolhido.diaria) > 0 && Number(escolhido.pago) === 0 && (
              <Botao variante="secundario" tamanho="p" onClick={() => setValor(String(escolhido.diaria).replace('.', ','))}>
                Usar só a diária: {brl(escolhido.diaria)}
              </Botao>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Valor pago (R$)">
          <Entrada required inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Campo>
        <Campo rotulo="Data">
          <Entrada required type="date" max={isoDia()} value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
      </div>

      <Campo rotulo="De onde saiu o dinheiro?" dica={origem === 'caixa' ? 'A retirada (sangria) é lançada no caixa junto com o pagamento.' : undefined}>
        <Selecao
          value={origem}
          onChange={(e) => {
            escolheuOrigem.current = true
            setOrigem(e.target.value as Origem)
          }}
        >
          <option value="caixa">Dinheiro do caixa{caixaAberto ? '' : ' (o caixa está fechado)'}</option>
          <option value="dinheiro">Dinheiro, fora do caixa</option>
          <option value="pix">Pix</option>
        </Selecao>
      </Campo>

      <Campo rotulo="Observação (opcional)">
        <AreaTexto rows={2} maxLength={300} placeholder="Ex.: diária de sábado, adiantamento…" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </Campo>

      <Botao type="submit" tamanho="g" className="w-full" carregando={salvando}>
        Confirmar pagamento
      </Botao>
      <p className="text-center text-xs text-stone-500">Ao confirmar, o valor entra nas saídas do dia e é descontado do líquido.</p>
    </form>
  )
}

/** Quanto cada motoboy tem a receber, quanto já foi pago e quanto falta. Com `aoPagar`, mostra o botão de pagar. */
export function TabelaAcerto({ acerto, umDia, aoPagar }: { acerto: AcertoEntregador[]; umDia: boolean; aoPagar?: (e: AcertoEntregador) => void }) {
  return (
    <>
      <Tabela colunas={['Motoboy', 'Entregas', 'Diária', 'Pelas entregas', 'A receber', 'Já pago', 'Falta pagar', ...(aoPagar ? [''] : [])]}>
        {acerto.map((e) => (
          <tr key={e.id}>
            <td>
              <b>{e.nome}</b>
              <span className="block text-xs text-stone-500">{regraDoMotoboy(e)}</span>
            </td>
            <td className="tabular-nums">
              {num(e.entregas)}
              {!umDia && e.dias > 0 && <span className="block text-xs text-stone-500">em {e.dias} dia{e.dias > 1 ? 's' : ''}</span>}
            </td>
            <td className="tabular-nums">{brl(e.diarias)}</td>
            <td className="tabular-nums">{brl(e.por_entregas)}</td>
            <td className="font-semibold tabular-nums">{brl(e.a_receber)}</td>
            <td className="tabular-nums">{brl(e.pago)}</td>
            <td className={cx('font-semibold tabular-nums', Number(e.falta) > 0 ? 'text-molho-700' : 'text-manjericao-700')}>{Number(e.falta) > 0 ? brl(e.falta) : Number(e.a_receber) > 0 ? 'Pago' : '—'}</td>
            {aoPagar && (
              <td className="text-right">
                <Botao variante="secundario" tamanho="p" onClick={() => aoPagar(e)}>
                  Pagar
                </Botao>
              </td>
            )}
          </tr>
        ))}
      </Tabela>
      <p className="mt-2 text-xs text-stone-500">
        Contam as entregas já concluídas. A diária entra em cada dia em que o motoboy fez entrega; se ele trabalhou e não saiu nenhuma, pague a diária pelo botão “Pagar”. A regra de cada um fica em Entregas → Entregadores.
      </p>
    </>
  )
}

export default function Pagamentos() {
  const aviso = useAviso()
  const { inicio, fim, seletor, texto } = usePeriodo('hoje')
  const [novo, setNovo] = useState<PagamentoInicial | null>(null)
  const { dados: r, recarregar: recarregarRelatorio } = useRelatorio(inicio, fim)
  const { dados: acerto, recarregar: recarregarAcerto } = useAcerto(inicio, fim)
  const { dados, carregando, erro, recarregar } = useConsulta<Pagamento[]>(
    () =>
      supabase
        .from('despesas')
        .select('*')
        .not('favorecido_tipo', 'is', null)
        .gte('data', inicio)
        .lte('data', fim)
        .order('data', { ascending: false })
        .order('criado_em', { ascending: false })
        .limit(5000),
    [inicio, fim],
  )
  const lista = dados ?? []
  const total = lista.reduce((s, p) => s + Number(p.valor), 0)
  const soma = (t: TipoFavorecido) => lista.filter((p) => p.favorecido_tipo === t).reduce((s, p) => s + Number(p.valor), 0)
  const faturamento = Number(r?.resumo.faturamento ?? 0)
  const saidas = Number(r?.resumo.despesas ?? 0)
  const umDia = inicio === fim
  const hoje = umDia && inicio === isoDia()
  const origem = (p: Pagamento) => (p.caixa_movimento_id ? 'Dinheiro do caixa' : p.forma_pagamento ? PAGAMENTO[p.forma_pagamento] : '—')
  const motoboys = (acerto ?? []).filter((e) => e.ativo || e.entregas > 0 || Number(e.pago) > 0)

  function atualizar() {
    recarregar()
    recarregarAcerto()
    recarregarRelatorio()
  }

  async function apagar(p: Pagamento) {
    if (!confirm(`Apagar o pagamento de ${brl(p.valor)} para ${p.favorecido}?${p.caixa_movimento_id ? ' O dinheiro volta para o caixa.' : ''}`)) return
    const { error } = await supabase.from('despesas').delete().eq('id', p.id)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Pagamento apagado')
    atualizar()
  }

  function baixar(formato: 'pdf' | 'xlsx' | 'csv') {
    exportar(formato, `pagamentos_${inicio}_a_${fim}`, 'Pagamentos à equipe', texto, [
      { titulo: 'Pagamentos', colunas: ['Data', 'Para quem', 'Tipo', 'Saiu de', 'Observação', 'Valor (R$)'], linhas: lista.map((p) => [dataCurta(p.data), p.favorecido, FAVORECIDO[p.favorecido_tipo].curto, origem(p), p.observacao ?? '', Number(p.valor)]) },
      { titulo: 'Motoboys', colunas: ['Motoboy', 'Dias', 'Entregas', 'Diárias (R$)', 'Pelas entregas (R$)', 'A receber (R$)', 'Já pago (R$)', 'Falta (R$)'], linhas: motoboys.map((e) => [e.nome, e.dias, e.entregas, Number(e.diarias), Number(e.por_entregas), Number(e.a_receber), Number(e.pago), Number(e.falta)]) },
    ])
  }

  return (
    <Pagina
      titulo="Pagamentos"
      descricao="O que foi pago a motoboys e funcionários. Cada pagamento já sai do líquido do dia."
      acoes={
        <>
          <BotoesExportar onExportar={baixar} desativado={!lista.length && !motoboys.length} />
          <Botao onClick={() => setNovo({ data: fim })}>
            <Plus className="size-4" /> Novo pagamento
          </Botao>
        </>
      }
    >
      <div className="mb-4">{seletor}</div>
      {erro && <Erro>{erro}</Erro>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Cartao className="p-4">
          <p className="text-sm text-stone-500">Vendas {hoje ? 'de hoje' : 'do período'}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(faturamento)}</p>
          <p className="mt-1 text-xs text-stone-500">pedidos válidos</p>
        </Cartao>
        <Cartao className="p-4">
          <p className="text-sm text-stone-500">Saídas {hoje ? 'de hoje' : 'do período'}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(saidas)}</p>
          <p className="mt-1 text-xs text-stone-500">
            {brl(total)} em pagamentos à equipe{saidas - total > 0.004 ? ` + ${brl(saidas - total)} de outras despesas` : ''}
          </p>
        </Cartao>
        <Cartao className={cx('p-4', faturamento - saidas < 0 && 'border-red-200 bg-red-50')}>
          <p className="text-sm text-stone-500">Líquido {hoje ? 'de hoje' : 'do período'}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(faturamento - saidas)}</p>
          <p className="mt-1 text-xs text-stone-500">vendas menos saídas</p>
        </Cartao>
      </div>

      <h2 className="mb-2 font-display text-lg font-semibold">Motoboys: quanto cada um tem a receber</h2>
      {motoboys.length === 0 ? (
        <Cartao className="mb-6 p-4 text-sm text-stone-600">Nenhum motoboy cadastrado. Cadastre em Entregas → Entregadores.</Cartao>
      ) : (
        <div className="mb-6">
          <TabelaAcerto acerto={motoboys} umDia={umDia} aoPagar={(e) => setNovo({ tipo: 'motoboy', entregador: e.id, valor: Number(e.falta) > 0 ? Number(e.falta) : undefined, data: fim })} />
        </div>
      )}

      <h2 className="mb-2 font-display text-lg font-semibold">Pagamentos feitos</h2>
      {carregando && !dados ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <Vazio titulo={`Nenhum pagamento ${hoje ? 'hoje' : 'no período'}`} texto="Toque em “Novo pagamento” para registrar o que foi pago a um motoboy ou funcionário." />
      ) : (
        <>
          <Tabela colunas={['Data', 'Para quem', 'Valor', 'Saiu de', 'Observação', '']}>
            {lista.map((p) => (
              <tr key={p.id}>
                <td className="tabular-nums">{dataCurta(p.data)}</td>
                <td>
                  <b>{p.favorecido}</b> <Selo className={FAVORECIDO[p.favorecido_tipo].cor}>{FAVORECIDO[p.favorecido_tipo].curto}</Selo>
                </td>
                <td className="font-semibold tabular-nums">{brl(p.valor)}</td>
                <td>{origem(p)}</td>
                <td className="max-w-xs text-stone-600">{p.observacao ?? '—'}</td>
                <td className="text-right">
                  <Botao variante="sutil" tamanho="p" aria-label={`Apagar pagamento de ${p.favorecido}`} onClick={() => apagar(p)}>
                    <Trash2 className="size-4 text-red-600" />
                  </Botao>
                </td>
              </tr>
            ))}
          </Tabela>
          <p className="mt-2 text-sm text-stone-600">
            Total pago: <b>{brl(total)}</b> · motoboys {brl(soma('motoboy'))} · cozinha {brl(soma('cozinha'))} · outros {brl(soma('outro'))}
          </p>
        </>
      )}

      <Modal aberto={novo != null} titulo="Novo pagamento" onFechar={() => setNovo(null)} largura="max-w-lg">
        {novo && (
          <FormPagamento
            inicial={novo}
            aoRegistrar={() => {
              setNovo(null)
              atualizar()
            }}
          />
        )}
      </Modal>
    </Pagina>
  )
}
