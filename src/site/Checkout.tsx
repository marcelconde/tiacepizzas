import { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bike, MapPin, MessageCircle, Store } from 'lucide-react'
import { AreaTexto, Botao, Campo, Entrada, Erro, Selecao, Vazio, cx } from '../components/ui'
import { itensParaPedido, useCarrinho } from '../lib/carrinho'
import { entrarCom, useConta } from '../lib/conta'
import { PAGAMENTO, brl, enderecoTexto, soDigitos } from '../lib/formato'
import { localizarEndereco, type Ponto } from '../lib/geo'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Endereco, FormaPagamento } from '../lib/tipos'
import { linkWhatsApp } from './SiteLayout'

const Mapa = lazy(() => import('../components/Mapa'))
const CHAVE_CLIENTE = 'tiace.cliente'
const CHAVE_PEDIDOS = 'tiace.pedidos'

export interface PedidoSalvo {
  codigo: string
  numero: number
  criado_em: string
}

export function pedidosSalvos(): PedidoSalvo[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_PEDIDOS) ?? '[]')
  } catch {
    return []
  }
}

const inicial = { nome: '', telefone: '', cep: '', logradouro: '', numero: '', complemento: '', bairro_id: '', bairro: '', referencia: '', cidade: '', uf: '' }

function dadosSalvos(): typeof inicial {
  try {
    return { ...inicial, ...JSON.parse(localStorage.getItem(CHAVE_CLIENTE) ?? '{}') }
  } catch {
    return inicial
  }
}

interface Entrega {
  dentro: boolean
  distancia_km?: number
  taxa?: number
  mensagem?: string
}

const formas: FormaPagamento[] = ['pix', 'credito', 'debito', 'dinheiro']

export default function Checkout() {
  const { itens, subtotal, limpar } = useCarrinho()
  const { config, catalogo, aberta } = useLoja()
  const { conta, logado } = useConta()
  const navegar = useNavigate()
  const chave = useRef(crypto.randomUUID()) // reenviar este mesmo pedido não o duplica

  const [tipo, setTipo] = useState<'entrega' | 'retirada'>('entrega')
  const [d, setD] = useState(dadosSalvos)
  const [ponto, setPonto] = useState<Ponto | null>(null)
  const [entrega, setEntrega] = useState<Entrega | null>(null)
  const [localizando, setLocalizando] = useState(false)
  const [pagamento, setPagamento] = useState<FormaPagamento>('pix')
  const [troco, setTroco] = useState('')
  const [cpfNota, setCpfNota] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [cupom, setCupom] = useState('')
  const [cupomAplicado, setCupomAplicado] = useState<{ codigo: string; desconto: number } | null>(null)
  const [cupomErro, setCupomErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const porDistancia = config?.modo_entrega === 'distancia'
  const loja = config?.loja_lat != null && config.loja_lng != null ? { lat: Number(config.loja_lat), lng: Number(config.loja_lng) } : null
  const campo = (nome: keyof typeof inicial) => ({
    value: d[nome],
    onChange: (e: { target: { value: string } }) => setD((v) => ({ ...v, [nome]: e.target.value })),
  })

  const bairro = catalogo.bairros.find((b) => b.id === d.bairro_id)
  const taxa = tipo !== 'entrega' ? 0 : porDistancia ? Number(entrega?.taxa ?? 0) : Number(bairro?.taxa_entrega ?? 0)
  const desconto = Math.min(cupomAplicado?.desconto ?? 0, subtotal)
  const total = subtotal + taxa - desconto
  const minimo = Number(config?.pedido_minimo ?? 0)
  const fechada = aberta === false || config?.aceita_pedidos_online === false
  const precisaEntrar = Boolean(config?.exigir_login) && !logado
  const foraDaArea = tipo === 'entrega' && porDistancia && entrega != null && !entrega.dentro

  // o desconto depende do subtotal: se a sacola mudar, o cupom precisa ser validado de novo
  useEffect(() => {
    setCupomAplicado(null)
  }, [subtotal])

  // quem tem conta começa com os próprios dados
  useEffect(() => {
    if (!conta) return
    setD((v) => ({ ...v, nome: v.nome || conta.nome, telefone: v.telefone || (conta.telefone ?? '') }))
    if (conta.cpf) setCpfNota((c) => c || conta.cpf!)
  }, [conta])

  async function calcular(p: Ponto) {
    setPonto(p)
    const { data, error } = await supabase.rpc('calcular_entrega', { p_lat: p.lat, p_lng: p.lng })
    setEntrega(error ? { dentro: false, mensagem: mensagemErro(error) } : (data as Entrega))
  }

  async function localizar(dados = d) {
    if (!porDistancia || !dados.logradouro.trim() || !dados.numero.trim()) return
    setLocalizando(true)
    const p = await localizarEndereco({ ...dados, cidade: dados.cidade || config?.cidade, uf: dados.uf || config?.uf })
    setLocalizando(false)
    if (p) await calcular(p)
    else {
      setPonto(null)
      setEntrega({ dentro: false, mensagem: 'Não encontramos este endereço no mapa. Confira a rua e o número ou marque o local no mapa.' })
    }
  }

  async function buscarCep() {
    const cep = soDigitos(d.cep)
    if (cep.length !== 8) return
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json())
      if (r.erro) return
      const achado = catalogo.bairros.find((b) => b.nome.toLowerCase() === String(r.bairro ?? '').toLowerCase())
      const novo = { ...d, logradouro: d.logradouro || r.logradouro || '', cidade: r.localidade ?? '', uf: r.uf ?? '', bairro: d.bairro || r.bairro || '', bairro_id: d.bairro_id || achado?.id || '' }
      setD(novo)
      localizar(novo)
    } catch {
      /* CEP é só um atalho: sem resposta, a pessoa preenche à mão */
    }
  }

  function usarEndereco(e: Endereco) {
    const novo = {
      ...d, cep: e.cep ?? '', logradouro: e.logradouro, numero: e.numero ?? '', complemento: e.complemento ?? '',
      bairro_id: e.bairro_id ?? '', bairro: e.bairro ?? '', referencia: e.referencia ?? '', cidade: e.cidade ?? '', uf: e.uf ?? '',
    }
    setD(novo)
    if (!porDistancia) return
    if (e.lat != null && e.lng != null) calcular({ lat: Number(e.lat), lng: Number(e.lng) })
    else localizar(novo)
  }

  async function aplicarCupom() {
    setCupomErro('')
    if (!cupom.trim()) return
    const { data, error } = await supabase.rpc('validar_cupom', { p_codigo: cupom, p_subtotal: subtotal })
    if (error) return setCupomErro(mensagemErro(error))
    if (!data.valido) return setCupomErro(data.mensagem)
    setCupomAplicado({ codigo: data.codigo, desconto: Number(data.desconto) })
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    if (tipo === 'entrega' && porDistancia && !entrega?.dentro) return setErro(entrega?.mensagem ?? 'Localize o endereço no mapa para calcular a entrega.')
    setEnviando(true)
    const { data, error } = await supabase.rpc('criar_pedido', {
      p: {
        chave: chave.current,
        tipo,
        cliente: { nome: d.nome, telefone: d.telefone },
        endereco:
          tipo === 'entrega'
            ? {
                cep: d.cep, logradouro: d.logradouro, numero: d.numero, complemento: d.complemento, bairro_id: porDistancia ? '' : d.bairro_id,
                bairro: bairro?.nome ?? d.bairro, referencia: d.referencia, cidade: d.cidade || config?.cidade, uf: d.uf || config?.uf,
                lat: ponto?.lat, lng: ponto?.lng,
              }
            : null,
        itens: itensParaPedido(itens),
        forma_pagamento: pagamento,
        troco_para: pagamento === 'dinheiro' && troco ? Number(troco.replace(',', '.')) : null,
        cupom: cupomAplicado?.codigo ?? null,
        cpf_nota: cpfNota,
        observacoes,
      },
    })
    setEnviando(false)
    if (error) return setErro(mensagemErro(error))

    try {
      localStorage.setItem(CHAVE_CLIENTE, JSON.stringify(d))
      const salvo: PedidoSalvo = { codigo: data.codigo, numero: data.numero, criado_em: new Date().toISOString() }
      localStorage.setItem(CHAVE_PEDIDOS, JSON.stringify([salvo, ...pedidosSalvos().filter((p) => p.codigo !== salvo.codigo)].slice(0, 10)))
    } catch {
      /* sem armazenamento local o pedido segue normalmente */
    }
    limpar()
    navegar(`/pedido?c=${data.codigo}`, { replace: true })
  }

  if (itens.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Vazio titulo="Sua sacola está vazia" texto="Escolha suas pizzas no cardápio para finalizar o pedido.">
          <Link to="/cardapio" className="font-semibold text-molho-700 underline">
            Ir para o cardápio
          </Link>
        </Vazio>
      </div>
    )
  }

  const escolha = (ativo: boolean) =>
    cx(
      'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors',
      ativo ? 'border-molho-500 bg-molho-50 text-molho-800' : 'border-stone-200 bg-white text-forno-700 hover:border-stone-300',
    )
  const secao = 'rounded-2xl border border-massa-200 bg-white p-5'
  const titulo = 'mb-4 font-display text-xl font-semibold'
  const alto = 'h-11'
  const whats = linkWhatsApp(config?.whatsapp, 'Olá! Preciso de ajuda para finalizar meu pedido.')
  const marcadores = [
    ...(loja ? [{ id: 'loja', ponto: loja, tipo: 'loja' as const, rotulo: config?.nome_loja }] : []),
    ...(ponto ? [{ id: 'cliente', ponto, tipo: 'cliente' as const, rotulo: 'Arraste para ajustar o local da entrega', aoArrastar: calcular }] : []),
  ]

  return (
    <form onSubmit={enviar} className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <h1 className="font-display text-4xl font-bold">Finalizar pedido</h1>
        {fechada && <Erro>Estamos fechados no momento. Assim que abrirmos, é só enviar o pedido — sua sacola fica guardada.</Erro>}

        {!logado && (config?.login_google || config?.login_facebook) && (
          <section className={secao}>
            <h2 className={titulo}>{precisaEntrar ? 'Entre para pedir' : 'Já tem conta?'}</h2>
            <p className="-mt-2 mb-4 text-sm text-stone-600">Com a conta você guarda seus endereços e vê todos os seus pedidos.{!precisaEntrar && ' Se preferir, é só preencher os dados abaixo.'}</p>
            <div className="flex flex-wrap gap-3">
              {config.login_google && (
                <Botao variante="secundario" tamanho="g" onClick={() => entrarCom('google', '/checkout')}>
                  Entrar com Google
                </Botao>
              )}
              {config.login_facebook && (
                <Botao variante="secundario" tamanho="g" onClick={() => entrarCom('facebook', '/checkout')}>
                  Entrar com Facebook
                </Botao>
              )}
            </div>
          </section>
        )}

        {!precisaEntrar && (
          <>
            <section className={secao}>
              <h2 className={titulo}>Como você quer receber?</h2>
              <div className="flex gap-3">
                <button type="button" className={escolha(tipo === 'entrega')} onClick={() => setTipo('entrega')}>
                  <Bike className="size-5" /> Entrega
                </button>
                <button type="button" className={escolha(tipo === 'retirada')} onClick={() => setTipo('retirada')}>
                  <Store className="size-5" /> Retirar na loja
                </button>
              </div>
              {tipo === 'retirada' && config?.logradouro && (
                <p className="mt-3 text-sm text-stone-600">
                  Retire em {config.logradouro}, {config.numero} — {config.bairro}. Fica pronto em cerca de {config.tempo_preparo_min} min.
                </p>
              )}
            </section>

            <section className={secao}>
              <h2 className={titulo}>Seus dados</h2>
              {logado && conta && (
                <p className="-mt-2 mb-4 text-sm text-stone-600">
                  Pedindo com a sua conta ·{' '}
                  <Link to="/conta" className="font-semibold text-molho-700 hover:underline">
                    Minha conta
                  </Link>
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome">
                  <Entrada required className={alto} autoComplete="name" maxLength={80} {...campo('nome')} />
                </Campo>
                <Campo rotulo="WhatsApp / telefone com DDD">
                  <Entrada required className={alto} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(11) 91234-5678" minLength={10} maxLength={16} {...campo('telefone')} />
                </Campo>
              </div>
            </section>

            {tipo === 'entrega' && (
              <section className={secao}>
                <h2 className={titulo}>Endereço de entrega</h2>
                {conta && conta.enderecos.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {conta.enderecos.map((e) => (
                      <button key={e.id} type="button" onClick={() => usarEndereco(e)} className={cx(escolha(d.logradouro === e.logradouro && d.numero === (e.numero ?? '')), 'flex-none justify-start text-left')}>
                        <MapPin className="size-4 shrink-0" /> {enderecoTexto(e)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-6">
                  <Campo rotulo="CEP" className="sm:col-span-2">
                    <Entrada className={alto} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} {...campo('cep')} onBlur={buscarCep} />
                  </Campo>
                  <Campo rotulo="Rua / avenida" className="sm:col-span-4">
                    <Entrada required className={alto} autoComplete="address-line1" maxLength={120} {...campo('logradouro')} onBlur={() => localizar()} />
                  </Campo>
                  <Campo rotulo="Número" className="sm:col-span-2">
                    <Entrada required className={alto} maxLength={10} {...campo('numero')} onBlur={() => localizar()} />
                  </Campo>
                  <Campo rotulo="Complemento" className="sm:col-span-4">
                    <Entrada className={alto} placeholder="Apto, bloco, casa…" maxLength={60} {...campo('complemento')} />
                  </Campo>
                  <Campo rotulo="Bairro" className="sm:col-span-3">
                    {porDistancia ? (
                      <Entrada className={alto} maxLength={60} {...campo('bairro')} />
                    ) : (
                      <Selecao required className={alto} {...campo('bairro_id')}>
                        <option value="">Selecione…</option>
                        {catalogo.bairros.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.nome} — {Number(b.taxa_entrega) > 0 ? brl(b.taxa_entrega) : 'entrega grátis'}
                          </option>
                        ))}
                      </Selecao>
                    )}
                  </Campo>
                  <Campo rotulo="Ponto de referência" className="sm:col-span-3">
                    <Entrada className={alto} maxLength={120} {...campo('referencia')} />
                  </Campo>
                </div>

                {porDistancia && (
                  <div className="mt-4 space-y-3">
                    {entrega?.dentro && (
                      <p className="rounded-lg bg-manjericao-100 px-3 py-2 text-sm font-semibold text-manjericao-700">
                        Entregamos aí! Distância de {String(entrega.distancia_km).replace('.', ',')} km · taxa de {Number(entrega.taxa) > 0 ? brl(entrega.taxa) : 'entrega grátis'}.
                      </p>
                    )}
                    {entrega && !entrega.dentro && <Erro>{entrega.mensagem}</Erro>}
                    {marcadores.length > 0 && ponto && (
                      <Suspense fallback={null}>
                        <Mapa marcadores={marcadores} className="h-56" />
                        <p className="text-xs text-stone-500">O pino marca o local da entrega. Se estiver no lugar errado, arraste-o para a sua casa.</p>
                      </Suspense>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Botao variante="secundario" carregando={localizando} onClick={() => localizar()}>
                        <MapPin className="size-4" /> Localizar endereço no mapa
                      </Botao>
                      {!ponto && loja && (
                        <Botao variante="sutil" onClick={() => calcular(loja)}>
                          Marcar manualmente
                        </Botao>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className={secao}>
              <h2 className={titulo}>Pagamento {tipo === 'entrega' ? 'na entrega' : 'na retirada'}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {formas.map((f) => (
                  <button key={f} type="button" className={escolha(pagamento === f)} onClick={() => setPagamento(f)}>
                    {PAGAMENTO[f].replace('Cartão de ', '').replace(/^./, (c) => c.toUpperCase())}
                  </button>
                ))}
              </div>
              {pagamento === 'dinheiro' && (
                <Campo rotulo="Troco para quanto?" dica="Deixe em branco se não precisar de troco." className="mt-4 max-w-xs">
                  <Entrada className={alto} inputMode="decimal" placeholder="Ex.: 100" value={troco} onChange={(e) => setTroco(e.target.value)} />
                </Campo>
              )}
              {pagamento === 'pix' && <p className="mt-3 text-sm text-stone-600">A chave Pix aparece na tela de acompanhamento assim que você enviar o pedido.</p>}
              {(pagamento === 'credito' || pagamento === 'debito') && <p className="mt-3 text-sm text-stone-600">Levamos a maquininha até você.</p>}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Campo rotulo="CPF na nota (opcional)">
                  <Entrada className={alto} inputMode="numeric" maxLength={14} placeholder="000.000.000-00" value={cpfNota} onChange={(e) => setCpfNota(e.target.value)} />
                </Campo>
              </div>
              <Campo rotulo="Observações do pedido (opcional)" className="mt-4">
                <AreaTexto maxLength={500} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
              </Campo>
            </section>
          </>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <section className={secao}>
          <h2 className={titulo}>Resumo</h2>
          <ul className="space-y-3 text-sm">
            {itens.map((i) => (
              <li key={i.uid} className="flex justify-between gap-3">
                <span>
                  <b>{i.quantidade}x</b> {i.nome}
                  {i.adicionais.length > 0 && <span className="block text-stone-500">+ {i.adicionais.map((a) => a.nome).join(', ')}</span>}
                </span>
                <span className="tabular-nums">{brl(i.preco_unitario * i.quantidade)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex gap-2">
            <Entrada aria-label="Cupom de desconto" placeholder="Cupom de desconto" className={alto} value={cupom} onChange={(e) => setCupom(e.target.value.toUpperCase())} />
            <Botao variante="secundario" className={alto} onClick={aplicarCupom}>
              Aplicar
            </Botao>
          </div>
          {cupomErro && <p className="mt-1 text-sm text-red-700">{cupomErro}</p>}

          <dl className="mt-4 space-y-1.5 border-t border-stone-200 pt-4 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{brl(subtotal)}</dd>
            </div>
            {tipo === 'entrega' && (
              <div className="flex justify-between">
                <dt>Entrega</dt>
                <dd className="tabular-nums">
                  {porDistancia ? (entrega?.dentro ? (taxa > 0 ? brl(taxa) : 'Grátis') : 'Informe o endereço') : bairro ? (taxa > 0 ? brl(taxa) : 'Grátis') : 'Escolha o bairro'}
                </dd>
              </div>
            )}
            {desconto > 0 && (
              <div className="flex justify-between text-manjericao-700">
                <dt>Cupom {cupomAplicado?.codigo}</dt>
                <dd className="tabular-nums">− {brl(desconto)}</dd>
              </div>
            )}
            <div className="flex justify-between pt-2 text-lg font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{brl(total)}</dd>
            </div>
          </dl>

          {subtotal < minimo && <p className="mt-3 text-sm text-molho-700">O pedido mínimo é de {brl(minimo)}.</p>}
          {erro && (
            <div className="mt-3">
              <Erro>{erro}</Erro>
            </div>
          )}
          <Botao type="submit" tamanho="g" className="mt-4 w-full" carregando={enviando} disabled={fechada || subtotal < minimo || precisaEntrar || foraDaArea}>
            Enviar pedido
          </Botao>
          <div className="mt-3 flex justify-between text-sm font-semibold">
            <Link to="/cardapio" className="text-forno-600 hover:underline">
              Adicionar mais itens
            </Link>
            {whats && (
              <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-manjericao-700 hover:underline">
                <MessageCircle className="size-4" /> Ajuda
              </a>
            )}
          </div>
        </section>
      </aside>
    </form>
  )
}
