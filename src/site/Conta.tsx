import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LogOut, MapPin, Plus, Trash2 } from 'lucide-react'
import { Botao, Campo, Carregando, Entrada, Erro, Modal, Selecao, Selo, Vazio, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { entrarCom, useConta } from '../lib/conta'
import { useConsulta } from '../lib/dados'
import { STATUS, brl, dataHora, enderecoTexto, soDigitos } from '../lib/formato'
import { localizarEndereco } from '../lib/geo'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { StatusPedido } from '../lib/tipos'

interface MeuPedido {
  numero: number
  codigo: string
  status: StatusPedido
  total: number
  criado_em: string
  itens: { nome: string; quantidade: number }[]
}

/** Entrada do cliente com Google ou Facebook. */
export function Entrar() {
  const { config } = useLoja()
  const { sessao, carregando } = useAuth()
  if (carregando) return <Carregando />
  if (sessao) return <Navigate to="/conta" replace />
  const nenhum = config && !config.login_google && !config.login_facebook
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="font-display text-4xl font-bold">Entrar</h1>
      <p className="mt-2 text-stone-600">Guarde seus endereços e acompanhe todos os seus pedidos em um só lugar.</p>
      <div className="mt-8 space-y-3">
        {config?.login_google && (
          <Botao variante="secundario" tamanho="g" className="w-full" onClick={() => entrarCom('google')}>
            Continuar com Google
          </Botao>
        )}
        {config?.login_facebook && (
          <Botao variante="secundario" tamanho="g" className="w-full" onClick={() => entrarCom('facebook')}>
            Continuar com Facebook
          </Botao>
        )}
        {nenhum && <Vazio titulo="Entrada com conta indisponível" texto="Você pode fazer seu pedido normalmente, sem cadastro." />}
      </div>
      <p className="mt-8 text-sm text-stone-500">
        Prefere não criar conta?{' '}
        <Link to="/cardapio" className="font-semibold text-molho-700 hover:underline">
          Peça sem cadastro
        </Link>
        .
      </p>
    </div>
  )
}

const enderecoVazio = { cep: '', logradouro: '', numero: '', complemento: '', bairro_id: '', bairro: '', referencia: '', cidade: '', uf: '' }

export default function Conta() {
  const { sair } = useAuth()
  const { config, catalogo } = useLoja()
  const { conta, carregando, erro, recarregar, logado } = useConta()
  const aviso = useAviso()
  const [dados, setDados] = useState({ nome: '', telefone: '', cpf: '', nascimento: '' })
  const [salvando, setSalvando] = useState(false)
  const [novo, setNovo] = useState<typeof enderecoVazio | null>(null)
  const { dados: pedidos } = useConsulta<MeuPedido[]>(() => (logado ? supabase.rpc('meus_pedidos') : Promise.resolve({ data: [], error: null })), [logado])

  useEffect(() => {
    if (conta) setDados({ nome: conta.nome ?? '', telefone: conta.telefone ?? '', cpf: conta.cpf ?? '', nascimento: conta.nascimento ?? '' })
  }, [conta])

  if (carregando) return <Carregando />
  if (!logado) return <Navigate to="/entrar" replace />
  if (erro || !conta) return <div className="mx-auto max-w-md px-4 py-16"><Erro>{erro || 'Não foi possível carregar sua conta.'}</Erro></div>

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const { error } = await supabase
      .from('clientes')
      .update({ nome: dados.nome.trim(), telefone: soDigitos(dados.telefone) || null, cpf: soDigitos(dados.cpf) || null, nascimento: dados.nascimento || null })
      .eq('id', conta!.id)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Dados salvos')
    recarregar()
  }

  async function buscarCep() {
    const cep = soDigitos(novo?.cep)
    if (cep.length !== 8 || !novo) return
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json())
      if (r.erro) return
      const achado = catalogo.bairros.find((b) => b.nome.toLowerCase() === String(r.bairro ?? '').toLowerCase())
      setNovo((v) => v && { ...v, logradouro: v.logradouro || r.logradouro || '', bairro: v.bairro || r.bairro || '', bairro_id: v.bairro_id || achado?.id || '', cidade: r.localidade ?? '', uf: r.uf ?? '' })
    } catch {
      /* o CEP é só um atalho */
    }
  }

  async function salvarEndereco(e: FormEvent) {
    e.preventDefault()
    if (!novo) return
    setSalvando(true)
    const bairro = catalogo.bairros.find((b) => b.id === novo.bairro_id)
    const local = { ...novo, cidade: novo.cidade || config?.cidade || '', uf: novo.uf || config?.uf || '' }
    const ponto = await localizarEndereco(local)
    const { error } = await supabase.from('enderecos').insert({
      cliente_id: conta!.id, cep: novo.cep || null, logradouro: novo.logradouro.trim(), numero: novo.numero.trim(), complemento: novo.complemento.trim() || null,
      bairro_id: novo.bairro_id || null, bairro: bairro?.nome ?? (novo.bairro.trim() || null), referencia: novo.referencia.trim() || null,
      cidade: local.cidade || null, uf: local.uf || null, lat: ponto?.lat ?? null, lng: ponto?.lng ?? null,
    })
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    setNovo(null)
    recarregar()
  }

  async function removerEndereco(id: string) {
    const { error } = await supabase.from('enderecos').delete().eq('id', id)
    if (error) return aviso.erro(mensagemErro(error))
    recarregar()
  }

  const secao = 'rounded-2xl border border-massa-200 bg-white p-5'
  const titulo = 'mb-4 font-display text-xl font-semibold'
  const campoEnd = (nome: keyof typeof enderecoVazio) => ({
    value: novo?.[nome] ?? '',
    onChange: (e: { target: { value: string } }) => setNovo((v) => v && { ...v, [nome]: e.target.value }),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold">Minha conta</h1>
          <p className="text-stone-600">{conta.email}</p>
        </div>
        <Botao variante="secundario" onClick={sair}>
          <LogOut className="size-4" /> Sair
        </Botao>
      </div>

      <section className={secao}>
        <h2 className={titulo}>Meus pedidos</h2>
        {!pedidos?.length ? (
          <p className="text-sm text-stone-500">
            Você ainda não fez pedidos com esta conta.{' '}
            <Link to="/cardapio" className="font-semibold text-molho-700 hover:underline">
              Ver cardápio
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {pedidos.map((p) => (
              <li key={p.codigo}>
                <Link to={`/pedido?c=${p.codigo}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm hover:bg-massa-50">
                  <span className="font-bold">#{p.numero}</span>
                  <span className="min-w-0 flex-1 truncate text-stone-600">{p.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ')}</span>
                  <Selo className={STATUS[p.status].cor}>{STATUS[p.status].rotulo}</Selo>
                  <span className="text-stone-500 tabular-nums">{dataHora(p.criado_em)}</span>
                  <span className="font-semibold tabular-nums">{brl(p.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={secao}>
        <h2 className={titulo}>Meus endereços</h2>
        {conta.enderecos.length === 0 && <p className="mb-3 text-sm text-stone-500">Nenhum endereço salvo ainda.</p>}
        <ul className="mb-4 divide-y divide-stone-100">
          {conta.enderecos.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
              <MapPin className="size-4 shrink-0 text-stone-400" />
              <span className="flex-1">
                {enderecoTexto(e)}
                {e.referencia && <span className="block text-xs text-stone-500">Ref.: {e.referencia}</span>}
              </span>
              <Botao variante="sutil" tamanho="p" aria-label="Remover endereço" onClick={() => removerEndereco(e.id!)}>
                <Trash2 className="size-4 text-red-600" />
              </Botao>
            </li>
          ))}
        </ul>
        <Botao variante="secundario" onClick={() => setNovo(enderecoVazio)}>
          <Plus className="size-4" /> Adicionar endereço
        </Botao>
      </section>

      <section className={secao}>
        <h2 className={titulo}>Meus dados</h2>
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome">
            <Entrada required className="h-11" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </Campo>
          <Campo rotulo="WhatsApp / telefone com DDD">
            <Entrada className="h-11" type="tel" inputMode="tel" placeholder="(11) 91234-5678" value={dados.telefone} onChange={(e) => setDados({ ...dados, telefone: e.target.value })} />
          </Campo>
          <Campo rotulo="CPF (para a nota fiscal)">
            <Entrada className="h-11" inputMode="numeric" maxLength={14} value={dados.cpf} onChange={(e) => setDados({ ...dados, cpf: e.target.value })} />
          </Campo>
          <Campo rotulo="Data de nascimento">
            <Entrada className="h-11" type="date" value={dados.nascimento} onChange={(e) => setDados({ ...dados, nascimento: e.target.value })} />
          </Campo>
          <div className="sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Salvar dados
            </Botao>
          </div>
        </form>
      </section>

      <Modal aberto={novo != null} titulo="Novo endereço" onFechar={() => setNovo(null)}>
        <form onSubmit={salvarEndereco} className="grid gap-4 sm:grid-cols-6">
          <Campo rotulo="CEP" className="sm:col-span-2">
            <Entrada className="h-11" inputMode="numeric" maxLength={9} {...campoEnd('cep')} onBlur={buscarCep} />
          </Campo>
          <Campo rotulo="Rua / avenida" className="sm:col-span-4">
            <Entrada required className="h-11" {...campoEnd('logradouro')} />
          </Campo>
          <Campo rotulo="Número" className="sm:col-span-2">
            <Entrada required className="h-11" {...campoEnd('numero')} />
          </Campo>
          <Campo rotulo="Complemento" className="sm:col-span-4">
            <Entrada className="h-11" {...campoEnd('complemento')} />
          </Campo>
          <Campo rotulo="Bairro" className="sm:col-span-3">
            {config?.modo_entrega === 'distancia' ? (
              <Entrada className="h-11" {...campoEnd('bairro')} />
            ) : (
              <Selecao required className="h-11" {...campoEnd('bairro_id')}>
                <option value="">Selecione…</option>
                {catalogo.bairros.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </Selecao>
            )}
          </Campo>
          <Campo rotulo="Ponto de referência" className="sm:col-span-3">
            <Entrada className="h-11" {...campoEnd('referencia')} />
          </Campo>
          <div className="flex justify-end gap-2 sm:col-span-6">
            <Botao variante="secundario" onClick={() => setNovo(null)}>
              Cancelar
            </Botao>
            <Botao type="submit" carregando={salvando}>
              Salvar endereço
            </Botao>
          </div>
        </form>
      </Modal>
    </div>
  )
}
