import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Search, UserCheck } from 'lucide-react'
import { MontarItem } from '../components/MontarItem'
import { Alternar, AreaTexto, Botao, Campo, Cartao, Contador, Entrada, Selecao, cx, useAviso } from '../components/ui'
import { itensParaPedido, subtotalDe } from '../lib/carrinho'
import { ORIGEM, PAGAMENTO, brl, haQuanto, soDigitos, telefone as formatarTelefone } from '../lib/formato'
import { consultarCep, distanciaPelasRuas, localizarEndereco, type Ponto } from '../lib/geo'
import { precoInicial, useLoja } from '../lib/loja'
import { aposConfirmar } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Endereco, FormaPagamento, ItemCarrinho, OrigemPedido, Produto, TipoPedido } from '../lib/tipos'
import { Pagina, useAdmin } from './AdminLayout'

const enderecoVazio = { cep: '', logradouro: '', numero: '', complemento: '', bairro_id: '', bairro: '', referencia: '', cidade: '', uf: '' }

/** Cliente como aparece na busca. Conta do site e cadastro por telefone da mesma pessoa viram uma linha só. */
interface ClienteBusca {
  ids: string[]
  nome: string
  telefone: string
  cpf: string | null
  pedidos: number
  ultimo: string | null
}
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

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
  const [clientes, setClientes] = useState<ClienteBusca[]>([])
  const [sugerir, setSugerir] = useState<'telefone' | 'nome' | null>(null) // campo em que a atendente está digitando
  const [salvos, setSalvos] = useState<Endereco[]>([])
  const [cepAviso, setCepAviso] = useState('')
  const cepBuscado = useRef('')
  const campoNumero = useRef<HTMLInputElement>(null)
  const [end, setEnd] = useState(enderecoVazio)
  const [taxa, setTaxa] = useState('')
  // ponto do endereço no mapa e o trajeto pelas ruas até ele (vai junto com o pedido; o banco confere)
  const [ponto, setPonto] = useState<(Ponto & { rota_km: number | null }) | null>(null)
  const [distancia, setDistancia] = useState('')
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

  /** Entrega por distância: acha o endereço no mapa e já escolhe a faixa (a atendente pode trocar à mão). */
  async function calcularEntrega(sabido?: Ponto | null, e = end) {
    if (config?.modo_entrega !== 'distancia' || !e.logradouro.trim() || !e.numero.trim()) return
    setDistancia('Calculando…')
    const loja = config.loja_lat != null && config.loja_lng != null ? { lat: Number(config.loja_lat), lng: Number(config.loja_lng) } : null
    const p = sabido ?? (await localizarEndereco({ logradouro: e.logradouro, numero: e.numero, bairro: e.bairro, cep: e.cep, cidade: e.cidade || config.cidade, uf: e.uf || config.uf }, loja))
    if (!p) {
      setPonto(null)
      return setDistancia('Endereço não encontrado no mapa: escolha a distância.')
    }
    const km = loja ? await distanciaPelasRuas(loja, p) : null
    const { data, error } = await supabase.rpc('calcular_entrega', { p_lat: p.lat, p_lng: p.lng, p_rota_km: km })
    if (error || !data?.dentro) {
      setPonto(null)
      return setDistancia(error ? mensagemErro(error) : (data?.mensagem ?? 'Fora da área de entrega.'))
    }
    setPonto({ ...p, rota_km: km })
    setTaxa(String(data.taxa))
    setDistancia(`${data.por_rota ? '' : 'cerca de '}${String(data.distancia_km).replace('.', ',')} km da loja${data.por_rota ? ', pelas ruas' : ''}`)
  }

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

  // quem já comprou: a lista vem uma vez (e de novo depois de cada pedido) e a busca acontece aqui mesmo, sem esperar a rede
  const carregarClientes = useCallback(async () => {
    const { data } = await supabase.from('clientes_resumo').select('id, nome, telefone, cpf, total_pedidos, ultimo_pedido_em').order('total_pedidos', { ascending: false }).limit(5000)
    const grupos = new Map<string, ClienteBusca>()
    for (const c of (data ?? []) as { id: string; nome: string; telefone: string | null; cpf: string | null; total_pedidos: number; ultimo_pedido_em: string | null }[]) {
      const tel = soDigitos(c.telefone)
      const chave = tel.length >= 10 ? tel : c.id
      const g = grupos.get(chave)
      if (!g) grupos.set(chave, { ids: [c.id], nome: c.nome, telefone: tel, cpf: c.cpf, pedidos: Number(c.total_pedidos), ultimo: c.ultimo_pedido_em })
      else {
        g.ids.push(c.id)
        g.cpf ??= c.cpf
        g.pedidos += Number(c.total_pedidos)
        if (c.ultimo_pedido_em && (!g.ultimo || c.ultimo_pedido_em > g.ultimo)) g.ultimo = c.ultimo_pedido_em
      }
    }
    setClientes([...grupos.values()])
  }, [])
  useEffect(() => {
    carregarClientes()
  }, [carregarClientes])

  const sugestoes = useMemo(() => {
    if (!sugerir || clienteAchado) return []
    const termo = sugerir === 'telefone' ? soDigitos(telefone) : semAcento(nome.trim())
    if (termo.length < 3) return []
    return clientes.filter((c) => (sugerir === 'telefone' ? c.telefone.includes(termo) : semAcento(c.nome).includes(termo))).slice(0, 6)
  }, [sugerir, clienteAchado, telefone, nome, clientes])

  /** Puxa os dados de quem já comprou: nome, telefone, CPF e os endereços (o mais novo já entra no pedido). */
  async function usarCliente(c: ClienteBusca, trocarEndereco = true) {
    setSugerir(null)
    setClienteAchado(true)
    setNome(c.nome)
    if (c.telefone) setTelefone(c.telefone)
    if (c.cpf && !cpfNota) setCpfNota(c.cpf)
    const { data } = await supabase.from('enderecos').select('*').in('cliente_id', c.ids).order('criado_em', { ascending: false })
    const vistos = new Set<string>()
    const lista = ((data ?? []) as Endereco[]).filter((e) => {
      const chave = `${e.logradouro}|${e.numero ?? ''}`.toLowerCase()
      return vistos.has(chave) ? false : Boolean(vistos.add(chave))
    })
    setSalvos(lista)
    if (lista.length && (trocarEndereco || !end.logradouro)) usarEndereco(lista[0])
  }

  /** Telefone digitado inteiro, sem tocar na sugestão: se for de alguém já cadastrado, puxa os dados do mesmo jeito. */
  function conferirTelefone() {
    setSugerir(null)
    const tel = soDigitos(telefone)
    if (clienteAchado || tel.length < 10) return
    const c = clientes.find((x) => x.telefone === tel)
    if (c) usarCliente(c, false)
  }

  /** CEP completo: preenche rua e bairro. Se a rua mudou, número, complemento e referência eram de outro endereço. */
  async function mudarCep(valor: string) {
    setEnd((v) => ({ ...v, cep: valor }))
    const cep = soDigitos(valor)
    if (cep.length !== 8 || cep === cepBuscado.current) return
    cepBuscado.current = cep
    setCepAviso('')
    const r = await consultarCep(cep).catch(() => undefined)
    if (cepBuscado.current !== cep) return
    if (r === undefined) return void (cepBuscado.current = '') // sem resposta do serviço: a atendente digita à mão
    if (!r) return setCepAviso('CEP não encontrado: confira os números ou digite o endereço.')
    const achado = catalogo.bairros.find((b) => b.nome.toLowerCase() === r.bairro.toLowerCase())
    setEnd((v) => {
      const rua = r.logradouro || v.logradouro
      const mudou = Boolean(v.logradouro.trim()) && rua.trim().toLowerCase() !== v.logradouro.trim().toLowerCase()
      return {
        ...v, logradouro: rua, cidade: r.cidade || v.cidade, uf: r.uf || v.uf,
        bairro: r.bairro || (mudou ? '' : v.bairro), bairro_id: achado?.id ?? (mudou ? '' : v.bairro_id),
        ...(mudou ? { numero: '', complemento: '', referencia: '' } : {}),
      }
    })
    setPonto(null)
    setDistancia('')
    if (config?.modo_entrega === 'distancia') setTaxa('')
    campoNumero.current?.focus()
  }

  function usarEndereco(e: Endereco) {
    const novo = {
      cep: e.cep ?? '', logradouro: e.logradouro, numero: e.numero ?? '', complemento: e.complemento ?? '',
      bairro_id: e.bairro_id ?? '', bairro: e.bairro ?? '', referencia: e.referencia ?? '', cidade: e.cidade ?? '', uf: e.uf ?? '',
    }
    cepBuscado.current = soDigitos(novo.cep)
    setCepAviso('')
    setEnd(novo)
    setPonto(null)
    setDistancia('')
    // endereço salvo com o ponto no mapa dispensa a busca
    calcularEntrega(e.lat != null && e.lng != null ? { lat: Number(e.lat), lng: Number(e.lng) } : null, novo)
  }

  function limpar() {
    setItens([])
    setNome('')
    setTelefone('')
    setClienteAchado(false)
    setSalvos([])
    setEnd(enderecoVazio)
    cepBuscado.current = ''
    setCepAviso('')
    setPonto(null)
    setDistancia('')
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
        endereco: tipo === 'entrega' ? { ...end, bairro: bairro?.nome ?? end.bairro, lat: ponto?.lat, lng: ponto?.lng, rota_km: ponto?.rota_km } : null,
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
    carregarClientes() // quem acabou de comprar já aparece na próxima busca
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

          <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setSugerir(null)}>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Telefone">
                <Entrada
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  required={tipo !== 'balcao'}
                  value={telefone}
                  onFocus={() => setSugerir('telefone')}
                  onChange={(e) => {
                    setTelefone(e.target.value)
                    setSugerir('telefone')
                    if (clienteAchado) {
                      // outro telefone é outra pessoa: os endereços salvos não valem mais
                      setClienteAchado(false)
                      setSalvos([])
                    }
                  }}
                  onBlur={conferirTelefone}
                />
              </Campo>
              <Campo rotulo="Nome">
                <Entrada autoComplete="off" required={tipo !== 'balcao'} value={nome} onFocus={() => setSugerir('nome')} onChange={(e) => { setNome(e.target.value); setSugerir('nome') }} onBlur={() => setSugerir(null)} />
              </Campo>
            </div>
            {sugestoes.length > 0 && (
              <ul role="listbox" aria-label="Clientes encontrados" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                {sugestoes.map((c) => (
                  <li key={c.ids[0]}>
                    {/* onMouseDown: o toque não tira o foco do campo antes de a escolha ser registrada */}
                    <button type="button" role="option" aria-selected={false} className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-50" onMouseDown={(e) => e.preventDefault()} onClick={() => usarCliente(c)}>
                      <span className="font-semibold">{c.nome}</span>
                      {c.telefone && <span className="text-stone-600"> · {formatarTelefone(c.telefone)}</span>}
                      <span className="block text-xs text-stone-500">
                        {c.pedidos > 0 ? `${c.pedidos} pedido${c.pedidos > 1 ? 's' : ''}${c.ultimo ? ` · último há ${haQuanto(c.ultimo)}` : ''}` : 'Ainda sem pedidos'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {clienteAchado ? (
            <p className="-mt-2 flex items-center gap-1.5 text-xs font-semibold text-manjericao-700">
              <UserCheck className="size-4" /> Cliente já cadastrado{salvos.length > 0 && tipo !== 'entrega' ? ` · ${salvos.length} endereço${salvos.length > 1 ? 's' : ''} guardado${salvos.length > 1 ? 's' : ''}` : ''}
            </p>
          ) : (
            <p className="-mt-2 text-xs text-stone-500">Já é cliente? Digite o telefone ou o nome e toque em quem aparecer.</p>
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
              <div className="grid grid-cols-[7.5rem_1fr] gap-2">
                <Entrada aria-label="CEP" placeholder="CEP" inputMode="numeric" autoComplete="off" maxLength={9} value={end.cep} onChange={(e) => mudarCep(e.target.value)} />
                <p className="self-center text-xs text-stone-500">{cepAviso || 'Digite o CEP para preencher a rua.'}</p>
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <Entrada required aria-label="Rua" placeholder="Rua / avenida" autoComplete="off" value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} onBlur={() => calcularEntrega()} />
                <Entrada ref={campoNumero} required aria-label="Número" placeholder="Nº" autoComplete="off" value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} onBlur={() => calcularEntrega()} />
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
              {config?.modo_entrega === 'distancia' && (end.bairro || end.cidade) && <p className="text-xs text-stone-600">{[end.bairro, [end.cidade, end.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ')}</p>}
              {config?.modo_entrega === 'distancia' && <p className="text-xs text-stone-600">{distancia || 'A taxa é calculada pela distância assim que a rua e o número são preenchidos.'}</p>}
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
