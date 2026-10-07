import { useMemo, useState, type FormEvent } from 'react'
import { Download, MessageCircle, Plus, Search, Trash2 } from 'lucide-react'
import { AreaTexto, Botao, Campo, Carregando, Entrada, Erro, Modal, Selecao, Selo, Tabela, Vazio, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { STATUS, baixarCsv, brl, dataCurta, dataHora, enderecoTexto, soDigitos, telefone } from '../lib/formato'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Cliente, Endereco, Pedido } from '../lib/tipos'
import { Pagina } from './AdminLayout'
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

function FichaCliente({ cliente, onFechar, onSalvo }: { cliente: Partial<Cliente>; onFechar: () => void; onSalvo: () => void }) {
  const aviso = useAviso()
  const [c, setC] = useState(cliente)
  const [salvando, setSalvando] = useState(false)
  const [pedidoAberto, setPedidoAberto] = useState<string | null>(null)
  const novo = !cliente.id

  const { dados: pedidos, recarregar: recarregarPedidos } = useConsulta<Pedido[]>(
    () => (novo ? Promise.resolve({ data: [], error: null }) : supabase.from('pedidos').select('*').eq('cliente_id', cliente.id!).order('criado_em', { ascending: false }).limit(50)),
    [cliente.id],
  )
  const { dados: enderecos, recarregar: recarregarEnderecos } = useConsulta<Endereco[]>(
    () => (novo ? Promise.resolve({ data: [], error: null }) : supabase.from('enderecos').select('*').eq('cliente_id', cliente.id!).order('criado_em')),
    [cliente.id],
  )

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const valores = {
      nome: c.nome?.trim(),
      telefone: soDigitos(c.telefone),
      email: c.email?.trim() || null,
      cpf: soDigitos(c.cpf) || null,
      nascimento: c.nascimento || null,
      observacoes: c.observacoes?.trim() || null,
    }
    const { error } = novo ? await supabase.from('clientes').insert(valores) : await supabase.from('clientes').update(valores).eq('id', cliente.id!)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Cliente salvo')
    onSalvo()
    onFechar()
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
            <Entrada required type="tel" minLength={10} {...campo('telefone')} />
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
              <p className="text-sm text-stone-500">Nenhum endereço salvo — eles são guardados automaticamente a cada entrega.</p>
            )}

            <h3 className="mt-6 mb-2 font-semibold">Histórico de pedidos</h3>
            {pedidos?.length ? (
              <Tabela colunas={['Nº', 'Data', 'Status', 'Total']}>
                {pedidos.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setPedidoAberto(p.id)}>
                    <td className="font-semibold">#{p.numero}</td>
                    <td className="tabular-nums">{dataHora(p.criado_em)}</td>
                    <td>
                      <Selo className={STATUS[p.status].cor}>{STATUS[p.status].rotulo}</Selo>
                    </td>
                    <td className="tabular-nums">{brl(p.total)}</td>
                  </tr>
                ))}
              </Tabela>
            ) : (
              <p className="text-sm text-stone-500">Ainda não fez pedidos.</p>
            )}
          </>
        )}
      </Modal>
      <DetalhePedido pedidoId={pedidoAberto} onFechar={() => setPedidoAberto(null)} onMudou={recarregarPedidos} />
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

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const digitos = soDigitos(busca)
    return (dados ?? [])
      .filter(SEGMENTOS[segmento].filtro)
      .filter((c) => !termo || c.nome.toLowerCase().includes(termo) || (digitos.length > 2 && c.telefone.includes(digitos)))
  }, [dados, busca, segmento])

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
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone-400" />
          <Entrada type="search" aria-label="Buscar cliente" placeholder="Nome ou telefone" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
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
        <Tabela colunas={['Cliente', 'Telefone', 'Pedidos', 'Total gasto', 'Último pedido', 'Cliente desde']}>
          {linhas.slice(0, 300).map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setFicha(c)}>
              <td className="font-semibold">{c.nome}</td>
              <td className="whitespace-nowrap tabular-nums">{telefone(c.telefone)}</td>
              <td className="tabular-nums">{c.total_pedidos}</td>
              <td className="tabular-nums">{brl(c.total_gasto)}</td>
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
