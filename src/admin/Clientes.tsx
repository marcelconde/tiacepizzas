import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Download, MessageCircle, Plus, Search, Trash2 } from 'lucide-react'
import { AreaTexto, Botao, Campo, Carregando, Entrada, Erro, Modal, Selecao, Tabela, Vazio, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { baixarCsv, brl, dataCurta, enderecoTexto, soDigitos, telefone } from '../lib/formato'
import { consultarCep } from '../lib/geo'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Cliente, Endereco } from '../lib/tipos'
import { Pagina } from './AdminLayout'
import { ComprasDoCliente } from './Analises'
import { DetalhePedido } from './DetalhePedido'

const DIA = 86_400_000
const SEGMENTOS = {
  todos: { rotulo: 'Todos os clientes', filtro: (_: Cliente) => true },
  novos: { rotulo: 'Novos (últimos 30 dias)', filtro: (c: Cliente) => Date.now() - new Date(c.criado_em).getTime() < 30 * DIA },
  fieis: { rotulo: 'Fiéis (5 pedidos ou mais)', filtro: (c: Cliente) => Number(c.total_pedidos) >= 5 },
  sumidos: {
    rotulo: 'Sumidos (sem pedir há 45 dias)',
    filtro: (c: Cliente) => Boolean(c.ultimo_pedido_em) && Date.now() - new Date(c.ultimo_pedido_em!).getTime() > 45 * DIA,
  },
}

// ------------------------------------------------------------------ endereço do cliente
const enderecoVazio = { cep: '', logradouro: '', numero: '', complemento: '', bairro_id: '', bairro: '', referencia: '', cidade: '', uf: '' }
type EnderecoForm = typeof enderecoVazio
const temEndereco = (e: EnderecoForm) => Object.entries(e).some(([k, v]) => k !== 'cidade' && k !== 'uf' && v.trim() !== '')

/** Campos de um endereço. O CEP completo preenche rua, bairro e cidade; o resto é digitado. */
function CamposEndereco({ valor, mudar }: { valor: EnderecoForm; mudar: Dispatch<SetStateAction<EnderecoForm>> }) {
  const { catalogo, config } = useLoja()
  const [cepAviso, setCepAviso] = useState('')
  const cepBuscado = useRef('')
  const campoNumero = useRef<HTMLInputElement>(null)
  const porBairro = config?.modo_entrega === 'bairro'
  const campo = (nome: keyof EnderecoForm) => ({ value: valor[nome], onChange: (e: { target: { value: string } }) => mudar((v) => ({ ...v, [nome]: e.target.value })) })

  async function mudarCep(texto: string) {
    mudar((v) => ({ ...v, cep: texto }))
    const cep = soDigitos(texto)
    if (cep.length !== 8 || cep === cepBuscado.current) return
    cepBuscado.current = cep
    setCepAviso('')
    const r = await consultarCep(cep).catch(() => undefined)
    if (cepBuscado.current !== cep) return
    if (r === undefined) return void (cepBuscado.current = '') // sem resposta do serviço: digita-se à mão
    if (!r) return setCepAviso('CEP não encontrado: confira os números ou digite o endereço.')
    const achado = catalogo.bairros.find((b) => b.nome.toLowerCase() === r.bairro.toLowerCase())
    mudar((v) => ({ ...v, logradouro: r.logradouro || v.logradouro, bairro: r.bairro || v.bairro, bairro_id: achado?.id ?? v.bairro_id, cidade: r.cidade || v.cidade, uf: r.uf || v.uf }))
    campoNumero.current?.focus()
  }

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Campo rotulo="CEP" className="sm:col-span-2" dica={cepAviso || 'O CEP preenche a rua.'}>
        <Entrada inputMode="numeric" maxLength={9} autoComplete="off" value={valor.cep} onChange={(e) => mudarCep(e.target.value)} />
      </Campo>
      <Campo rotulo="Rua / avenida" className="sm:col-span-4">
        <Entrada autoComplete="off" {...campo('logradouro')} />
      </Campo>
      <Campo rotulo="Número" className="sm:col-span-2">
        <Entrada ref={campoNumero} autoComplete="off" {...campo('numero')} />
      </Campo>
      <Campo rotulo="Complemento" className="sm:col-span-4">
        <Entrada autoComplete="off" placeholder="Apartamento, bloco, casa dos fundos…" {...campo('complemento')} />
      </Campo>
      <Campo rotulo="Bairro" className="sm:col-span-3">
        {porBairro ? (
          <Selecao value={valor.bairro_id} onChange={(e) => mudar((v) => ({ ...v, bairro_id: e.target.value, bairro: catalogo.bairros.find((b) => b.id === e.target.value)?.nome ?? '' }))}>
            <option value="">Escolha o bairro…</option>
            {catalogo.bairros.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </Selecao>
        ) : (
          <Entrada autoComplete="off" {...campo('bairro')} />
        )}
      </Campo>
      <Campo rotulo="Referência" className="sm:col-span-3">
        <Entrada autoComplete="off" placeholder="Perto de…, portão azul…" {...campo('referencia')} />
      </Campo>
    </div>
  )
}

function FichaCliente({ cliente, onFechar, onSalvo }: { cliente: Partial<Cliente>; onFechar: () => void; onSalvo: () => void }) {
  const aviso = useAviso()
  const { config } = useLoja()
  const [c, setC] = useState(cliente)
  const [endereco, setEndereco] = useState(enderecoVazio) // endereço digitado junto com o cliente novo
  const [outroEndereco, setOutroEndereco] = useState<EnderecoForm | null>(null) // endereço a mais de quem já é cliente
  const [salvando, setSalvando] = useState(false)
  const [pedidoAberto, setPedidoAberto] = useState<string | null>(null)
  const [versaoCompras, setVersaoCompras] = useState(0)
  const novo = !cliente.id

  const { dados: enderecos, recarregar: recarregarEnderecos } = useConsulta<Endereco[]>(
    () => (novo ? Promise.resolve({ data: [], error: null }) : supabase.from('enderecos').select('*').eq('cliente_id', cliente.id!).order('criado_em')),
    [cliente.id],
  )

  /** Endereço pronto para gravar; devolve o que falta quando está incompleto (a entrega exige rua e número). */
  function paraGravar(e: EnderecoForm, clienteId: string) {
    if (!e.logradouro.trim() || !e.numero.trim()) return 'Para guardar o endereço, informe a rua e o número.'
    return {
      cliente_id: clienteId, cep: e.cep.trim() || null, logradouro: e.logradouro.trim(), numero: e.numero.trim(), complemento: e.complemento.trim() || null,
      bairro_id: e.bairro_id || null, bairro: e.bairro.trim() || null, referencia: e.referencia.trim() || null,
      cidade: e.cidade || config?.cidade || null, uf: e.uf || config?.uf || null,
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const comEndereco = novo && temEndereco(endereco)
    if (comEndereco && typeof paraGravar(endereco, '') === 'string') return aviso.erro(paraGravar(endereco, '') as string)
    setSalvando(true)
    const valores = {
      nome: c.nome?.trim(),
      telefone: soDigitos(c.telefone) || null,
      email: c.email?.trim() || null,
      cpf: soDigitos(c.cpf) || null,
      nascimento: c.nascimento || null,
      observacoes: c.observacoes?.trim() || null,
    }
    // cliente novo: o cadastro volta com o id, para o endereço ser guardado junto
    const r = novo ? await supabase.from('clientes').insert(valores).select('id').single() : await supabase.from('clientes').update(valores).eq('id', cliente.id!)
    let erroEndereco = null
    if (!r.error && comEndereco) erroEndereco = (await supabase.from('enderecos').insert(paraGravar(endereco, (r.data as { id: string }).id) as object)).error
    setSalvando(false)
    if (r.error) return aviso.erro(mensagemErro(r.error))
    if (erroEndereco) aviso.erro(`O cliente foi salvo, mas o endereço não: ${mensagemErro(erroEndereco)}`)
    else aviso.sucesso('Cliente salvo')
    onSalvo()
    onFechar()
  }

  async function salvarOutroEndereco(e: FormEvent) {
    e.preventDefault()
    const dados = paraGravar(outroEndereco!, cliente.id!)
    if (typeof dados === 'string') return aviso.erro(dados)
    setSalvando(true)
    const { error } = await supabase.from('enderecos').insert(dados)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Endereço guardado')
    setOutroEndereco(null)
    recarregarEnderecos()
  }

  async function removerEndereco(id: string) {
    const { error } = await supabase.from('enderecos').delete().eq('id', id)
    if (error) return aviso.erro(mensagemErro(error))
    recarregarEnderecos()
  }

  const campo = (nome: keyof Cliente) => ({
    value: String(c[nome] ?? ''),
    onChange: (e: { target: { value: string } }) => setC((v) => ({ ...v, [nome]: e.target.value })),
  })

  return (
    <>
      <Modal aberto titulo={novo ? 'Novo cliente' : cliente.nome} onFechar={onFechar} largura="max-w-2xl">
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome">
            <Entrada required {...campo('nome')} />
          </Campo>
          <Campo rotulo="Telefone com DDD">
            <Entrada type="tel" minLength={10} {...campo('telefone')} />
          </Campo>
          <Campo rotulo="E-mail">
            <Entrada type="email" {...campo('email')} />
          </Campo>
          <Campo rotulo="CPF">
            <Entrada inputMode="numeric" maxLength={14} {...campo('cpf')} />
          </Campo>
          <Campo rotulo="Nascimento">
            <Entrada type="date" {...campo('nascimento')} />
          </Campo>
          <Campo rotulo="Observações" className="sm:col-span-2">
            <AreaTexto placeholder="Preferências, alergias, portão azul…" {...campo('observacoes')} />
          </Campo>
          {novo && (
            <fieldset className="sm:col-span-2">
              <legend className="font-semibold">Endereço de entrega (opcional)</legend>
              <p className="mb-3 text-xs text-stone-500">Com o endereço guardado, em Novo pedido basta digitar o nome ou o telefone do cliente: os dados entram sozinhos.</p>
              <CamposEndereco valor={endereco} mudar={setEndereco} />
            </fieldset>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            {c.telefone && !novo && (
              <a href={`https://wa.me/55${soDigitos(c.telefone)}`} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1.5 text-sm font-semibold text-manjericao-700 hover:underline">
                <MessageCircle className="size-4" /> Abrir WhatsApp
              </a>
            )}
            <Botao variante="secundario" onClick={onFechar}>
              Fechar
            </Botao>
            <Botao type="submit" carregando={salvando}>
              Salvar
            </Botao>
          </div>
        </form>

        {!novo && (
          <>
            <h3 className="mt-6 mb-2 font-semibold">Endereços</h3>
            {enderecos?.length ? (
              <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 text-sm">
                {enderecos.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {enderecoTexto(e)}
                      {e.referencia && <span className="block text-xs text-stone-500">Ref.: {e.referencia}</span>}
                    </span>
                    <Botao variante="sutil" tamanho="p" aria-label="Remover endereço" onClick={() => removerEndereco(e.id!)}>
                      <Trash2 className="size-4 text-red-600" />
                    </Botao>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Nenhum endereço salvo. Eles são guardados automaticamente a cada entrega, ou você pode cadastrar um agora.</p>
            )}
            {outroEndereco ? (
              <form onSubmit={salvarOutroEndereco} className="mt-3 rounded-xl border border-stone-200 p-3">
                <CamposEndereco valor={outroEndereco} mudar={setOutroEndereco as Dispatch<SetStateAction<EnderecoForm>>} />
                <div className="mt-3 flex justify-end gap-2">
                  <Botao variante="secundario" onClick={() => setOutroEndereco(null)}>
                    Cancelar
                  </Botao>
                  <Botao type="submit" carregando={salvando}>
                    Guardar endereço
                  </Botao>
                </div>
              </form>
            ) : (
              <Botao variante="secundario" tamanho="p" className="mt-3" onClick={() => setOutroEndereco(enderecoVazio)}>
                <Plus className="size-4" /> Adicionar endereço
              </Botao>
            )}

            <h3 className="mt-6 mb-2 font-semibold">Compras</h3>
            <ComprasDoCliente key={versaoCompras} clienteId={cliente.id!} onAbrirPedido={setPedidoAberto} />
          </>
        )}
      </Modal>
      <DetalhePedido pedidoId={pedidoAberto} onFechar={() => setPedidoAberto(null)} onMudou={() => setVersaoCompras((v) => v + 1)} />
    </>
  )
}

export default function Clientes() {
  const [busca, setBusca] = useState('')
  const [segmento, setSegmento] = useState<keyof typeof SEGMENTOS>('todos')
  const [ficha, setFicha] = useState<Partial<Cliente> | null>(null)
  const { dados, carregando, erro, recarregar } = useConsulta<Cliente[]>(
    () => supabase.from('clientes_resumo').select('*').order('total_gasto', { ascending: false }).limit(5000),
    [],
  )

  // "#1234" ou só o número do pedido: encontra o cliente daquele pedido
  const [doPedido, setDoPedido] = useState<string | null>(null)
  useEffect(() => {
    const n = /^#?\d{4,6}$/.test(busca.trim()) ? Number(soDigitos(busca)) : 0
    if (!n) return setDoPedido(null)
    let vivo = true
    supabase.from('pedidos').select('cliente_id').eq('numero', n).maybeSingle().then(({ data }) => vivo && setDoPedido(data?.cliente_id ?? null))
    return () => {
      vivo = false
    }
  }, [busca])

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const digitos = soDigitos(busca)
    return (dados ?? [])
      .filter(SEGMENTOS[segmento].filtro)
      .filter(
        (c) =>
          !termo || c.id === doPedido || c.nome.toLowerCase().includes(termo) || (c.email ?? '').toLowerCase().includes(termo) ||
          (digitos.length > 2 && (c.telefone ?? '').includes(digitos)),
      )
  }, [dados, busca, segmento, doPedido])

  const exportar = () =>
    baixarCsv(
      'clientes',
      linhas.map((c) => ({
        nome: c.nome, telefone: telefone(c.telefone), email: c.email ?? '', pedidos: Number(c.total_pedidos), total_gasto: Number(c.total_gasto),
        ultimo_pedido: dataCurta(c.ultimo_pedido_em), cliente_desde: dataCurta(c.criado_em),
      })),
    )

  return (
    <Pagina
      titulo="Clientes"
      descricao="Quem compra, quanto compra e quando comprou pela última vez."
      acoes={
        <>
          <Botao variante="secundario" disabled={!linhas.length} onClick={exportar}>
            <Download className="size-4" /> Exportar
          </Botao>
          <Botao onClick={() => setFicha({})}>
            <Plus className="size-4" /> Novo cliente
          </Botao>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone-400" />
          <Entrada type="search" aria-label="Buscar cliente" placeholder="Nome, telefone, e-mail ou nº do pedido" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Selecao aria-label="Segmento" className="w-auto" value={segmento} onChange={(e) => setSegmento(e.target.value as keyof typeof SEGMENTOS)}>
          {Object.entries(SEGMENTOS).map(([id, s]) => (
            <option key={id} value={id}>
              {s.rotulo}
            </option>
          ))}
        </Selecao>
        <span className="self-center text-sm text-stone-500">{linhas.length} cliente(s)</span>
      </div>

      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : linhas.length === 0 ? (
        <Vazio titulo="Nenhum cliente encontrado" texto="Os clientes são cadastrados automaticamente a cada pedido com telefone." />
      ) : (
        <Tabela colunas={['Cliente', 'Telefone', 'Pedidos', 'Total gasto', 'Ticket médio', 'Último pedido', 'Cliente desde']}>
          {linhas.slice(0, 300).map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setFicha(c)}>
              <td className="font-semibold">
                {c.nome}
                {c.usuario_id && <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900">conta</span>}
                {c.email && <span className="block text-xs font-normal text-stone-500">{c.email}</span>}
              </td>
              <td className="whitespace-nowrap tabular-nums">{telefone(c.telefone)}</td>
              <td className="tabular-nums">{c.total_pedidos}</td>
              <td className="tabular-nums">{brl(c.total_gasto)}</td>
              <td className="tabular-nums">{Number(c.total_pedidos) > 0 ? brl(Number(c.total_gasto) / Number(c.total_pedidos)) : '—'}</td>
              <td className="tabular-nums">{dataCurta(c.ultimo_pedido_em) || '—'}</td>
              <td className="tabular-nums">{dataCurta(c.criado_em)}</td>
            </tr>
          ))}
        </Tabela>
      )}
      {linhas.length > 300 && <p className="mt-2 text-sm text-stone-500">Mostrando os 300 primeiros. Use a busca para encontrar os demais.</p>}

      {ficha && <FichaCliente key={ficha.id ?? 'novo'} cliente={ficha} onFechar={() => setFicha(null)} onSalvo={recarregar} />}
    </Pagina>
  )
}
