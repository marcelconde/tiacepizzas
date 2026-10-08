import { useMemo, useState, type FormEvent } from 'react'
import { Search, UserCheck } from 'lucide-react'
import { MontarItem } from '../components/MontarItem'
import { Alternar, AreaTexto, Botao, Campo, Cartao, Contador, Entrada, Selecao, cx, useAviso } from '../components/ui'
import { itensParaPedido, subtotalDe } from '../lib/carrinho'
import { ORIGEM, PAGAMENTO, brl, soDigitos } from '../lib/formato'
import { precoInicial, useLoja } from '../lib/loja'
import { aposConfirmar } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Endereco, FormaPagamento, ItemCarrinho, OrigemPedido, Produto, TipoPedido } from '../lib/tipos'
import { Pagina, useAdmin } from './AdminLayout'

const enderecoVazio = { cep: '', logradouro: '', numero: '', complemento: '', bairro_id: '', bairro: '', referencia: '' }

export default function Pdv() {
  const { catalogo, config } = useLoja()
  const { fiscal, sincronizar } = useAdmin()
  const aviso = useAviso()

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [montando, setMontando] = useState<Produto | null>(null)
  const [itens, setItens] = useState<ItemCarrinho[]>([])

  const [tipo, setTipo] = useState<TipoPedido>('balcao')
  const [origem, setOrigem] = useState<OrigemPedido>('balcao')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [clienteAchado, setClienteAchado] = useState(false)
  const [salvos, setSalvos] = useState<Endereco[]>([])
  const [end, setEnd] = useState(enderecoVazio)
  const [taxa, setTaxa] = useState('')
  const [desconto, setDesconto] = useState('')
  const [pagamento, setPagamento] = useState<FormaPagamento>('dinheiro')
  const [troco, setTroco] = useState('')
  const [pago, setPago] = useState(true)
  const [cpfNota, setCpfNota] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [enviando, setEnviando] = useState(false)

  const produtos = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return catalogo.produtos.filter((p) => p.disponivel && (!categoria || p.categoria_id === categoria) && (!termo || p.nome.toLowerCase().includes(termo)))
  }, [catalogo.produtos, busca, categoria])

  const numero = (s: string) => Number(s.replace(',', '.')) || 0
  const subtotal = subtotalDe(itens)
  const bairro = catalogo.bairros.find((b) => b.id === end.bairro_id)
  const taxaFinal = tipo === 'entrega' ? (taxa !== '' ? numero(taxa) : Number(bairro?.taxa_entrega ?? 0)) : 0
  const total = Math.max(0, subtotal + taxaFinal - numero(desconto))

  function mudarTipo(t: TipoPedido) {
    setTipo(t)
    if (t === 'balcao') {
      setOrigem('balcao')
      setPago(true)
    } else {
      if (origem === 'balcao') setOrigem('telefone')
      setPago(false)
    }
  }

  async function buscarCliente() {
    const tel = soDigitos(telefone)
    setClienteAchado(false)
    setSalvos([])
    if (tel.length < 10) return
    const { data } = await supabase.from('clientes').select('id, nome, cpf, enderecos(*)').eq('telefone', tel).maybeSingle()
    if (!data) return
    setClienteAchado(true)
    setNome(data.nome)
    if (data.cpf && !cpfNota) setCpfNota(data.cpf)
    const lista = (data.enderecos ?? []) as Endereco[]
    setSalvos(lista)
    if (lista.length && !end.logradouro) usarEndereco(lista[0])
  }

  function usarEndereco(e: Endereco) {
    setEnd({
      cep: e.cep ?? '', logradouro: e.logradouro, numero: e.numero ?? '', complemento: e.complemento ?? '',
      bairro_id: e.bairro_id ?? '', bairro: e.bairro ?? '', referencia: e.referencia ?? '',
    })
  }

  function limpar() {
    setItens([])
    setNome('')
    setTelefone('')
    setClienteAchado(false)
    setSalvos([])
    setEnd(enderecoVazio)
    setTaxa('')
    setDesconto('')
    setTroco('')
    setCpfNota('')
    setObservacoes('')
  }

  async function lancar(e: FormEvent) {
    e.preventDefault()
    if (!itens.length || !config) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('criar_pedido', {
      p: {
        painel: true,
        tipo,
        origem,
        cliente: { nome: nome.trim() || 'Cliente balcão', telefone },
        endereco: tipo === 'entrega' ? { ...end, bairro: bairro?.nome ?? end.bairro } : null,
        itens: itensParaPedido(itens),
        forma_pagamento: pagamento,
        troco_para: pagamento === 'dinheiro' && troco ? numero(troco) : null,
        taxa_entrega: tipo === 'entrega' && taxa !== '' ? numero(taxa) : null,
        desconto: numero(desconto) || null,
        pago,
        cpf_nota: cpfNota,
        observacoes,
        status: 'confirmado',
      },
    })
    if (error) {
      setEnviando(false)
      return aviso.erro(mensagemErro(error))
    }
    aviso.sucesso(`Pedido #${data.numero} lançado`)
    limpar()
    sincronizar()
    try {
      const avisos = await aposConfirmar(data.id, config, fiscal)
      avisos.forEach((a) => aviso.erro(a))
      if (pago) {
        const { count } = await supabase.from('caixas').select('id', { count: 'exact', head: true }).is('fechado_em', null)
        if (!count) aviso.erro('Nenhum caixa aberto: o recebimento ficou só no pedido. Abra o caixa para controlar o dinheiro.')
      }
    } catch (err) {
      aviso.erro(mensagemErro(err))
    }
    setEnviando(false)
  }

  const chip = (ativo: boolean) =>
    cx('rounded-full border px-3 py-1 text-sm font-semibold whitespace-nowrap', ativo ? 'border-molho-600 bg-molho-600 text-white' : 'border-stone-300 bg-white text-forno-700 hover:bg-stone-50')

  return (
    <Pagina titulo="Novo pedido" descricao="Para vendas no balcão e pedidos por telefone ou WhatsApp.">
      <form onSubmit={lancar} className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone-400" />
            <Entrada type="search" aria-label="Buscar produto" placeholder="Buscar produto" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="sem-barra mt-3 flex gap-2 overflow-x-auto pb-1">
            <button type="button" className={chip(categoria === '')} onClick={() => setCategoria('')}>
              Tudo
            </button>
            {catalogo.categorias.map((c) => (
              <button key={c.id} type="button" className={chip(categoria === c.id)} onClick={() => setCategoria(c.id)}>
                {c.nome}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {produtos.map((p) => {
              const usaTamanhos = Boolean(catalogo.categorias.find((c) => c.id === p.categoria_id)?.usa_tamanhos)
              return (
                <button key={p.id} type="button" onClick={() => setMontando(p)} className="rounded-xl border border-stone-200 bg-white p-3 text-left text-sm hover:border-molho-400 hover:shadow-sm">
                  <span className="block font-semibold">{p.nome}</span>
                  <span className="text-stone-500 tabular-nums">
                    {usaTamanhos && 'a partir de '}
                    {brl(precoInicial(catalogo, p, usaTamanhos)?.promo)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <Cartao className="space-y-4 p-4 lg:sticky lg:top-4 lg:self-start">
          <div className="flex gap-2">
            {(['balcao', 'retirada', 'entrega'] as TipoPedido[]).map((t) => (
              <button key={t} type="button" className={cx(chip(tipo === t), 'flex-1')} onClick={() => mudarTipo(t)}>
                {t === 'balcao' ? 'Balcão' : t === 'retirada' ? 'Retirada' : 'Entrega'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Telefone">
              <Entrada type="tel" inputMode="tel" required={tipo !== 'balcao'} value={telefone} onChange={(e) => setTelefone(e.target.value)} onBlur={buscarCliente} />
            </Campo>
            <Campo rotulo="Nome">
              <Entrada required={tipo !== 'balcao'} value={nome} onChange={(e) => setNome(e.target.value)} />
            </Campo>
          </div>
          {clienteAchado && (
            <p className="-mt-2 flex items-center gap-1.5 text-xs font-semibold text-manjericao-700">
              <UserCheck className="size-4" /> Cliente já cadastrado
            </p>
          )}
          {tipo !== 'balcao' && (
            <Campo rotulo="Canal do pedido">
              <Selecao value={origem} onChange={(e) => setOrigem(e.target.value as OrigemPedido)}>
                {(['telefone', 'whatsapp', 'ifood', 'balcao'] as OrigemPedido[]).map((o) => (
                  <option key={o} value={o}>
                    {ORIGEM[o]}
                  </option>
                ))}
              </Selecao>
            </Campo>
          )}

          {tipo === 'entrega' && (
            <div className="space-y-3 rounded-lg bg-stone-50 p-3">
              {salvos.length > 1 && (
                <Selecao aria-label="Endereços salvos" value="" onChange={(e) => e.target.value && usarEndereco(salvos[Number(e.target.value)])}>
                  <option value="">Usar outro endereço salvo…</option>
                  {salvos.map((s, i) => (
                    <option key={i} value={i}>
                      {s.logradouro}, {s.numero} — {s.bairro}
                    </option>
                  ))}
                </Selecao>
              )}
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <Entrada required aria-label="Rua" placeholder="Rua / avenida" value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} />
                <Entrada required aria-label="Número" placeholder="Nº" value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Entrada aria-label="Complemento" placeholder="Complemento" value={end.complemento} onChange={(e) => setEnd({ ...end, complemento: e.target.value })} />
                <Entrada aria-label="Referência" placeholder="Referência" value={end.referencia} onChange={(e) => setEnd({ ...end, referencia: e.target.value })} />
              </div>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                {config?.modo_entrega === 'distancia' ? (
                  // por distância: a atendente escolhe a faixa conforme o endereço informado ao telefone
                  <Selecao required aria-label="Faixa de distância" value={taxa} onChange={(e) => setTaxa(e.target.value)}>
                    <option value="">Distância…</option>
                    {catalogo.faixas.map((f) => (
                      <option key={f.id} value={String(f.taxa)}>
                        até {String(f.ate_km).replace('.', ',')} km — {brl(f.taxa)}
                      </option>
                    ))}
                  </Selecao>
                ) : (
                  <Selecao required aria-label="Bairro" value={end.bairro_id} onChange={(e) => { setEnd({ ...end, bairro_id: e.target.value }); setTaxa('') }}>
                    <option value="">Bairro…</option>
                    {catalogo.bairros.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nome} — {brl(b.taxa_entrega)}
                      </option>
                    ))}
                  </Selecao>
                )}
                <Entrada aria-label="Taxa de entrega" inputMode="decimal" placeholder={bairro ? String(bairro.taxa_entrega) : 'Taxa'} value={taxa} onChange={(e) => setTaxa(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            {itens.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300 py-6 text-center text-sm text-stone-500">Toque nos produtos para adicionar.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {itens.map((i) => (
                  <li key={i.uid} className="flex items-center gap-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{i.nome}</p>
                      {(i.adicionais.length > 0 || i.observacoes) && (
                        <p className="truncate text-xs text-stone-500">{[...i.adicionais.map((a) => a.nome), i.observacoes].filter(Boolean).join(' · ')}</p>
                      )}
                      <p className="tabular-nums">{brl(i.preco_unitario * i.quantidade)}</p>
                    </div>
                    <Contador
                      valor={i.quantidade}
                      onChange={(q) => setItens((l) => (q <= 0 ? l.filter((x) => x.uid !== i.uid) : l.map((x) => (x.uid === i.uid ? { ...x, quantidade: q } : x))))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Pagamento">
              <Selecao value={pagamento} onChange={(e) => setPagamento(e.target.value as FormaPagamento)}>
                {Object.entries(PAGAMENTO).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Desconto (R$)">
              <Entrada inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
            </Campo>
            {pagamento === 'dinheiro' && (
              <Campo rotulo="Troco para">
                <Entrada inputMode="decimal" value={troco} onChange={(e) => setTroco(e.target.value)} />
              </Campo>
            )}
            <Campo rotulo="CPF na nota">
              <Entrada inputMode="numeric" maxLength={14} value={cpfNota} onChange={(e) => setCpfNota(e.target.value)} />
            </Campo>
          </div>
          <AreaTexto aria-label="Observações" placeholder="Observações do pedido" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          <Alternar ativo={pago} onChange={setPago} rotulo="Já foi pago" />

          <dl className="space-y-1 border-t border-stone-200 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{brl(subtotal)}</dd>
            </div>
            {tipo === 'entrega' && (
              <div className="flex justify-between">
                <dt>Entrega</dt>
                <dd className="tabular-nums">{brl(taxaFinal)}</dd>
              </div>
            )}
            {numero(desconto) > 0 && (
              <div className="flex justify-between">
                <dt>Desconto</dt>
                <dd className="tabular-nums">− {brl(numero(desconto))}</dd>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{brl(total)}</dd>
            </div>
            {pagamento === 'dinheiro' && numero(troco) > total && (
              <div className="flex justify-between font-semibold text-molho-700">
                <dt>Troco</dt>
                <dd className="tabular-nums">{brl(numero(troco) - total)}</dd>
              </div>
            )}
          </dl>
          <Botao type="submit" tamanho="g" className="w-full" disabled={!itens.length} carregando={enviando}>
            Lançar pedido
          </Botao>
        </Cartao>
      </form>

      <MontarItem produto={montando} onFechar={() => setMontando(null)} onAdicionar={(item) => setItens((l) => [...l, item])} />
    </Pagina>
  )
}
