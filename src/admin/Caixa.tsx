import { useState, type FormEvent } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Lock, Unlock } from 'lucide-react'
import { AreaTexto, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selo, Tabela, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { PAGAMENTO, brl, dataHora } from '../lib/formato'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Caixa as TCaixa, FormaPagamento } from '../lib/tipos'
import { Pagina, usePedidosAoVivo } from './AdminLayout'

interface Resumo {
  abertura: number
  vendas: number
  qtd_vendas: number
  suprimentos: number
  sangrias: number
  esperado_dinheiro: number
  por_forma: Partial<Record<FormaPagamento, number>>
}

interface MovCaixa {
  id: string
  tipo: 'venda' | 'suprimento' | 'sangria' | 'estorno'
  forma_pagamento: FormaPagamento
  valor: number
  descricao: string | null
  criado_em: string
}

const TIPO_MOV = {
  venda: { rotulo: 'Venda', cor: 'bg-emerald-100 text-emerald-900' },
  suprimento: { rotulo: 'Suprimento', cor: 'bg-sky-100 text-sky-900' },
  sangria: { rotulo: 'Sangria', cor: 'bg-amber-100 text-amber-900' },
  estorno: { rotulo: 'Estorno', cor: 'bg-red-100 text-red-900' },
}

const numero = (s: string) => Number(s.replace(',', '.')) || 0

function Detalhes({ caixa, versao }: { caixa: TCaixa; versao: number }) {
  const { dados: resumo } = useConsulta<Resumo>(() => supabase.rpc('resumo_caixa', { p_caixa: caixa.id }), [caixa.id, versao])
  const { dados: movs } = useConsulta<MovCaixa[]>(
    () => supabase.from('caixa_movimentos').select('*').eq('caixa_id', caixa.id).order('criado_em', { ascending: false }),
    [caixa.id, versao],
  )
  if (!resumo) return <Carregando />

  const cartoes = [
    { rotulo: 'Troco inicial', valor: brl(resumo.abertura) },
    { rotulo: `Vendas recebidas (${resumo.qtd_vendas})`, valor: brl(resumo.vendas) },
    { rotulo: 'Suprimentos', valor: brl(resumo.suprimentos) },
    { rotulo: 'Sangrias', valor: brl(resumo.sangrias) },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cartoes.map((c) => (
          <Cartao key={c.rotulo} className="p-4">
            <p className="text-sm text-stone-500">{c.rotulo}</p>
            <p className="mt-1 text-xl font-semibold">{c.valor}</p>
          </Cartao>
        ))}
        <div className="col-span-2 rounded-xl bg-forno-800 p-4 text-white lg:col-span-1">
          <p className="text-sm text-massa-300">Dinheiro na gaveta</p>
          <p className="mt-1 text-xl font-semibold">{brl(caixa.fechado_em ? caixa.valor_esperado : resumo.esperado_dinheiro)}</p>
        </div>
      </div>

      <Cartao className="p-4">
        <h3 className="font-semibold">Recebido por forma de pagamento</h3>
        <dl className="mt-2 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PAGAMENTO) as FormaPagamento[]).map((f) => (
            <div key={f} className="flex justify-between border-b border-stone-100 py-1">
              <dt>{PAGAMENTO[f]}</dt>
              <dd className="font-semibold tabular-nums">{brl(resumo.por_forma[f] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      </Cartao>

      {!movs?.length ? (
        <Vazio titulo="Nenhum movimento ainda" texto="As vendas entram aqui quando o pedido é marcado como pago." />
      ) : (
        <Tabela colunas={['Hora', 'Movimento', 'Descrição', 'Forma', 'Valor']}>
          {movs.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap tabular-nums">{dataHora(m.criado_em)}</td>
              <td>
                <Selo className={TIPO_MOV[m.tipo].cor}>{TIPO_MOV[m.tipo].rotulo}</Selo>
              </td>
              <td>{m.descricao}</td>
              <td>{PAGAMENTO[m.forma_pagamento]}</td>
              <td className={cx('font-semibold tabular-nums', Number(m.valor) < 0 && 'text-red-700')}>{brl(m.valor)}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </div>
  )
}

export default function Caixa() {
  const aviso = useAviso()
  const [versao, setVersao] = useState(0)
  const [abertura, setAbertura] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [mov, setMov] = useState<'suprimento' | 'sangria' | null>(null)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [fechando, setFechando] = useState(false)
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const [antigo, setAntigo] = useState<TCaixa | null>(null)

  const { dados: caixas, carregando, erro, recarregar } = useConsulta<TCaixa[]>(
    () => supabase.from('caixas').select('*').order('aberto_em', { ascending: false }).limit(60),
    [],
  )
  const aberto = caixas?.find((c) => !c.fechado_em) ?? null
  const { dados: resumo } = useConsulta<Resumo | null>(
    () => (aberto ? supabase.rpc('resumo_caixa', { p_caixa: aberto.id }) : Promise.resolve({ data: null, error: null })),
    [aberto?.id, versao, fechando],
  )
  const atualizar = () => {
    recarregar()
    setVersao((v) => v + 1)
  }
  usePedidosAoVivo(atualizar)

  async function executar(fn: () => PromiseLike<{ error: { message: string } | null }>, sucesso: string) {
    setOcupado(true)
    const { error } = await fn()
    setOcupado(false)
    if (error) {
      aviso.erro(mensagemErro(error))
      return false
    }
    aviso.sucesso(sucesso)
    atualizar()
    return true
  }

  async function abrir(e: FormEvent) {
    e.preventDefault()
    if (await executar(() => supabase.rpc('abrir_caixa', { p_valor: numero(abertura) }), 'Caixa aberto')) setAbertura('')
  }

  async function movimentar(e: FormEvent) {
    e.preventDefault()
    const v = numero(valor)
    if (v <= 0 || !aberto || !mov) return
    const ok = await executar(
      () => supabase.from('caixa_movimentos').insert({ caixa_id: aberto.id, tipo: mov, valor: mov === 'sangria' ? -v : v, descricao: descricao.trim() || null }),
      mov === 'sangria' ? 'Sangria registrada' : 'Suprimento registrado',
    )
    if (ok) {
      setMov(null)
      setValor('')
      setDescricao('')
    }
  }

  async function fechar(e: FormEvent) {
    e.preventDefault()
    if (await executar(() => supabase.rpc('fechar_caixa', { p_valor: numero(contado), p_obs: obs }), 'Caixa fechado')) {
      setFechando(false)
      setContado('')
      setObs('')
    }
  }

  const diferenca = resumo ? numero(contado) - Number(resumo.esperado_dinheiro) : 0
  const fechados = (caixas ?? []).filter((c) => c.fechado_em)

  return (
    <Pagina
      titulo="Caixa"
      descricao="Abertura, recebimentos, sangrias e fechamento com conferência."
      acoes={
        aberto && (
          <>
            <Botao variante="secundario" onClick={() => setMov('suprimento')}>
              <ArrowDownCircle className="size-4" /> Suprimento
            </Botao>
            <Botao variante="secundario" onClick={() => setMov('sangria')}>
              <ArrowUpCircle className="size-4" /> Sangria
            </Botao>
            <Botao onClick={() => setFechando(true)}>
              <Lock className="size-4" /> Fechar caixa
            </Botao>
          </>
        )
      }
    >
      {erro && <Erro>{erro}</Erro>}
      {carregando && !caixas ? (
        <Carregando />
      ) : aberto ? (
        <>
          <p className="mb-3 text-sm text-stone-600">
            <Selo className="mr-2 bg-emerald-100 text-emerald-900">Aberto</Selo>
            desde {dataHora(aberto.aberto_em)}
          </p>
          <Detalhes caixa={aberto} versao={versao} />
        </>
      ) : (
        <Cartao className="max-w-md p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <Unlock className="size-5" /> Abrir o caixa
          </h2>
          <p className="mt-1 text-sm text-stone-600">Conte o dinheiro que está na gaveta para troco e informe abaixo.</p>
          <form onSubmit={abrir} className="mt-4 flex items-end gap-2">
            <Campo rotulo="Troco inicial (R$)" className="flex-1">
              <Entrada inputMode="decimal" placeholder="0,00" value={abertura} onChange={(e) => setAbertura(e.target.value)} />
            </Campo>
            <Botao type="submit" carregando={ocupado}>
              Abrir caixa
            </Botao>
          </form>
        </Cartao>
      )}

      {fechados.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-semibold">Caixas anteriores</h2>
          <Tabela colunas={['Abertura', 'Fechamento', 'Troco inicial', 'Esperado', 'Contado', 'Diferença']}>
            {fechados.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setAntigo(c)}>
                <td className="whitespace-nowrap tabular-nums">{dataHora(c.aberto_em)}</td>
                <td className="whitespace-nowrap tabular-nums">{dataHora(c.fechado_em)}</td>
                <td className="tabular-nums">{brl(c.valor_abertura)}</td>
                <td className="tabular-nums">{brl(c.valor_esperado)}</td>
                <td className="tabular-nums">{brl(c.valor_informado)}</td>
                <td className={cx('font-semibold tabular-nums', Number(c.diferenca) < 0 ? 'text-red-700' : Number(c.diferenca) > 0 ? 'text-sky-700' : '')}>
                  {Number(c.diferenca) === 0 ? 'Bateu' : `${Number(c.diferenca) > 0 ? 'Sobrou ' : 'Faltou '}${brl(Math.abs(Number(c.diferenca)))}`}
                </td>
              </tr>
            ))}
          </Tabela>
        </section>
      )}

      <Modal aberto={mov != null} titulo={mov === 'sangria' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar dinheiro)'} onFechar={() => setMov(null)} largura="max-w-sm">
        <form onSubmit={movimentar} className="space-y-4">
          <Campo rotulo="Valor (R$)">
            <Entrada required autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </Campo>
          <Campo rotulo="Motivo">
            <Entrada required placeholder={mov === 'sangria' ? 'Ex.: pagamento do gás, depósito…' : 'Ex.: reforço de troco'} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </Campo>
          <Botao type="submit" className="w-full" carregando={ocupado}>
            Registrar
          </Botao>
        </form>
      </Modal>

      <Modal aberto={fechando} titulo="Fechar caixa" onFechar={() => setFechando(false)} largura="max-w-sm">
        <form onSubmit={fechar} className="space-y-4">
          <p className="text-sm text-stone-600">
            Pelo sistema, deve haver <b className="text-forno-900">{brl(resumo?.esperado_dinheiro)}</b> em dinheiro na gaveta. Conte e informe o valor real.
          </p>
          <Campo rotulo="Dinheiro contado (R$)">
            <Entrada required autoFocus inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} />
          </Campo>
          {contado !== '' && (
            <p className={cx('text-sm font-semibold', diferenca < 0 ? 'text-red-700' : diferenca > 0 ? 'text-sky-700' : 'text-emerald-700')}>
              {diferenca === 0 ? 'O caixa bateu.' : diferenca > 0 ? `Sobrando ${brl(diferenca)}` : `Faltando ${brl(-diferenca)}`}
            </p>
          )}
          <Campo rotulo="Observações (opcional)">
            <AreaTexto value={obs} onChange={(e) => setObs(e.target.value)} />
          </Campo>
          <Botao type="submit" className="w-full" carregando={ocupado}>
            Confirmar fechamento
          </Botao>
        </form>
      </Modal>

      <Modal aberto={antigo != null} titulo={antigo ? `Caixa de ${dataHora(antigo.aberto_em)}` : ''} onFechar={() => setAntigo(null)} largura="max-w-4xl">
        {antigo && (
          <>
            {antigo.observacoes && <p className="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm">Obs.: {antigo.observacoes}</p>}
            <Detalhes caixa={antigo} versao={0} />
          </>
        )}
      </Modal>
    </Pagina>
  )
}
