import { useState, type FormEvent, type ReactNode } from 'react'
import { ImagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useConsulta } from '../lib/dados'
import { enviarImagem } from '../lib/imagens'
import { mensagemErro, supabase } from '../lib/supabase'
import { Alternar, AreaTexto, Botao, Campo, Carregando, Entrada, Erro, Modal, Selecao, Tabela, Vazio, cx, useAviso } from './ui'

export interface CampoCrud {
  nome: string
  rotulo: string
  tipo?: 'texto' | 'numero' | 'moeda' | 'booleano' | 'selecao' | 'area' | 'data' | 'hora' | 'imagem'
  opcoes?: { valor: string; rotulo: string }[]
  obrigatorio?: boolean
  padrao?: unknown
  dica?: string
  inteira?: boolean // ocupa a linha toda do formulário
}

export interface ColunaCrud<T> {
  rotulo: string
  render: (linha: T) => ReactNode
  classe?: string
}

interface Props<T> {
  tabela: string
  nome: string // singular, minúsculo: "bairro"
  feminino?: boolean
  colunas: ColunaCrud<T>[]
  campos: CampoCrud[]
  ordem?: string
  crescente?: boolean
  select?: string
  filtrar?: (consulta: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  texto?: (linha: T) => string // habilita a busca
  aoMudar?: () => void
  acoes?: (linha: T, recarregar: () => void) => ReactNode
  topo?: ReactNode
  preparar?: (valores: Record<string, unknown>) => Record<string, unknown>
  deps?: unknown[]
}

type Linha = { id: string } & Record<string, unknown>

/** Listagem com criar, editar e excluir para os cadastros simples do painel. */
export function Crud<T extends { id: string }>({
  tabela, nome, feminino, colunas, campos, ordem = 'nome', crescente = true, select = '*', filtrar, texto, aoMudar, acoes, topo, preparar, deps = [],
}: Props<T>) {
  const aviso = useAviso()
  const g = feminino
    ? { novo: 'Nova', nenhum: 'Nenhuma', este: 'esta', cadastrado: 'cadastrada' }
    : { novo: 'Novo', nenhum: 'Nenhum', este: 'este', cadastrado: 'cadastrado' }
  const { dados, carregando, erro, recarregar } = useConsulta<T[]>(() => {
    const q = supabase.from(tabela).select(select).order(ordem, { ascending: crescente }).limit(1000)
    return (filtrar ? filtrar(q) : q) as PromiseLike<{ data: T[] | null; error: { message: string } | null }>
  }, deps)
  const [editando, setEditando] = useState<Record<string, unknown> | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [busca, setBusca] = useState('')

  const novo = () => setEditando(Object.fromEntries(campos.map((c) => [c.nome, c.padrao ?? (c.tipo === 'booleano' ? true : '')])))

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!editando) return
    setSalvando(true)
    let valores: Record<string, unknown> = {}
    for (const c of campos) {
      const v = editando[c.nome]
      if (c.tipo === 'numero' || c.tipo === 'moeda') valores[c.nome] = v === '' || v == null ? null : Number(String(v).replace(',', '.'))
      else if (c.tipo === 'booleano') valores[c.nome] = Boolean(v)
      else valores[c.nome] = typeof v === 'string' ? v.trim() || null : (v ?? null)
    }
    if (preparar) valores = preparar(valores)
    const id = editando.id as string | undefined
    const { error } = id ? await supabase.from(tabela).update(valores).eq('id', id) : await supabase.from(tabela).insert(valores)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso(id ? 'Alterações salvas' : `${nome.replace(/^./, (c) => c.toUpperCase())} ${g.cadastrado}`)
    setEditando(null)
    recarregar()
    aoMudar?.()
  }

  async function excluir(linha: Linha) {
    if (!confirm(`Excluir ${g.este} ${nome}? Esta ação não pode ser desfeita.`)) return
    const { error } = await supabase.from(tabela).delete().eq('id', linha.id)
    if (error) return aviso.erro(mensagemErro(error))
    recarregar()
    aoMudar?.()
  }

  const termo = busca.trim().toLowerCase()
  const linhas = (dados ?? []).filter((l) => !termo || !texto || texto(l).toLowerCase().includes(termo))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {texto && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-stone-400" />
            <Entrada type="search" aria-label={`Buscar ${nome}`} placeholder="Buscar…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        )}
        {topo}
        <Botao className="ml-auto" onClick={novo}>
          <Plus className="size-4" /> {g.novo} {nome}
        </Botao>
      </div>

      {erro && <Erro>{erro}</Erro>}
      {carregando ? (
        <Carregando />
      ) : linhas.length === 0 ? (
        <Vazio titulo={termo ? 'Nada encontrado' : `${g.nenhum} ${nome} ${g.cadastrado}`} texto={termo ? undefined : `Use o botão “${g.novo} ${nome}” para começar.`} />
      ) : (
        <Tabela colunas={[...colunas.map((c) => c.rotulo), '']}>
          {linhas.map((l) => (
            <tr key={l.id} className="hover:bg-stone-50">
              {colunas.map((c, i) => (
                <td key={i} className={cx(c.classe)}>
                  {c.render(l)}
                </td>
              ))}
              <td className="text-right whitespace-nowrap">
                {acoes?.(l, recarregar)}
                <Botao variante="sutil" tamanho="p" aria-label="Editar" onClick={() => setEditando({ ...(l as unknown as Linha) })}>
                  <Pencil className="size-4" />
                </Botao>
                <Botao variante="sutil" tamanho="p" aria-label="Excluir" onClick={() => excluir(l as unknown as Linha)}>
                  <Trash2 className="size-4 text-red-600" />
                </Botao>
              </td>
            </tr>
          ))}
        </Tabela>
      )}

      <Modal aberto={editando != null} titulo={editando?.id ? `Editar ${nome}` : `${g.novo} ${nome}`} onFechar={() => setEditando(null)}>
        {editando && (
          <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
            {campos.map((c) => {
              const valor = editando[c.nome]
              const mudar = (v: unknown) => setEditando((e) => ({ ...e, [c.nome]: v }))
              const classe = cx((c.inteira || c.tipo === 'area') && 'sm:col-span-2')
              if (c.tipo === 'booleano') {
                return (
                  <div key={c.nome} className={cx('flex items-end pb-2', classe)}>
                    <Alternar ativo={Boolean(valor)} onChange={mudar} rotulo={c.rotulo} />
                  </div>
                )
              }
              if (c.tipo === 'imagem') {
                return (
                  <div key={c.nome} className="flex items-center gap-3 sm:col-span-2">
                    {valor ? <img src={String(valor)} alt="" className="h-16 w-28 rounded-lg object-cover" /> : null}
                    <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50">
                      <ImagePlus className="size-4" /> {valor ? 'Trocar imagem' : c.rotulo}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const arquivo = e.target.files?.[0]
                          if (arquivo) enviarImagem(arquivo).then(mudar, (erro) => aviso.erro(mensagemErro(erro)))
                        }}
                      />
                    </label>
                    {valor ? (
                      <Botao variante="sutil" onClick={() => mudar(null)}>
                        Remover
                      </Botao>
                    ) : null}
                    {c.dica && <span className="text-xs text-stone-500">{c.dica}</span>}
                  </div>
                )
              }
              return (
                <Campo key={c.nome} rotulo={c.rotulo} dica={c.dica} className={classe}>
                  {c.tipo === 'selecao' ? (
                    <Selecao required={c.obrigatorio} value={String(valor ?? '')} onChange={(e) => mudar(e.target.value)}>
                      <option value="">{c.obrigatorio ? 'Selecione…' : '—'}</option>
                      {c.opcoes?.map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.rotulo}
                        </option>
                      ))}
                    </Selecao>
                  ) : c.tipo === 'area' ? (
                    <AreaTexto required={c.obrigatorio} value={String(valor ?? '')} onChange={(e) => mudar(e.target.value)} />
                  ) : (
                    <Entrada
                      required={c.obrigatorio}
                      type={c.tipo === 'data' ? 'date' : c.tipo === 'hora' ? 'time' : c.tipo === 'numero' || c.tipo === 'moeda' ? 'number' : 'text'}
                      step={c.tipo === 'moeda' ? '0.01' : c.tipo === 'numero' ? 'any' : undefined}
                      min={c.tipo === 'moeda' ? 0 : undefined}
                      inputMode={c.tipo === 'numero' || c.tipo === 'moeda' ? 'decimal' : undefined}
                      value={String(valor ?? '')}
                      onChange={(e) => mudar(e.target.value)}
                    />
                  )}
                </Campo>
              )
            })}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Botao variante="secundario" onClick={() => setEditando(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" carregando={salvando}>
                Salvar
              </Botao>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
