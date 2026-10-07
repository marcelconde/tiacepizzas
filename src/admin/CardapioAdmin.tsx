import { useEffect, useState, type FormEvent } from 'react'
import { ImagePlus, Pencil, Plus, Scale, Star, Trash2 } from 'lucide-react'
import { Crud } from '../components/Crud'
import { Abas, Alternar, AreaTexto, Botao, Campo, Carregando, Entrada, Erro, Modal, Selecao, Vazio, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { brl } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Adicional, Categoria, Insumo, Produto, Tamanho } from '../lib/tipos'
import { Pagina } from './AdminLayout'

// ------------------------------------------------------------------ ficha técnica
interface LinhaFicha {
  tamanho_id: string
  insumo_id: string
  quantidade: string
}

export function FichaTecnica({ alvo, onFechar }: { alvo: { produto_id?: string; adicional_id?: string; nome: string; usaTamanhos: boolean } | null; onFechar: () => void }) {
  const aviso = useAviso()
  const [linhas, setLinhas] = useState<LinhaFicha[] | null>(null)
  const [salvando, setSalvando] = useState(false)
  const coluna = alvo?.produto_id ? 'produto_id' : 'adicional_id'
  const id = alvo?.produto_id ?? alvo?.adicional_id

  const { dados: insumos } = useConsulta<Insumo[]>(() => supabase.from('insumos').select('*').eq('ativo', true).order('nome'), [])
  const { dados: tamanhos } = useConsulta<Tamanho[]>(() => supabase.from('tamanhos').select('*').order('ordem'), [])
  const { dados: salvas, carregando } = useConsulta<{ tamanho_id: string | null; insumo_id: string; quantidade: number }[]>(
    () => (id ? supabase.from('fichas_tecnicas').select('tamanho_id, insumo_id, quantidade').eq(coluna, id) : Promise.resolve({ data: null, error: null })),
    [id],
  )
  useEffect(() => {
    if (salvas) setLinhas(salvas.map((l) => ({ tamanho_id: l.tamanho_id ?? '', insumo_id: l.insumo_id, quantidade: String(l.quantidade) })))
  }, [salvas])

  if (!alvo || !id) return null
  const mudar = (i: number, campo: keyof LinhaFicha, v: string) => setLinhas((l) => l!.map((x, j) => (j === i ? { ...x, [campo]: v } : x)))

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const novas = (linhas ?? [])
      .filter((l) => l.insumo_id && Number(l.quantidade.replace(',', '.')) > 0)
      .map((l) => ({ [coluna]: id, tamanho_id: l.tamanho_id || null, insumo_id: l.insumo_id, quantidade: Number(l.quantidade.replace(',', '.')) }))
    const apagar = await supabase.from('fichas_tecnicas').delete().eq(coluna, id!)
    const inserir = apagar.error || !novas.length ? apagar : await supabase.from('fichas_tecnicas').insert(novas)
    setSalvando(false)
    if (inserir.error) return aviso.erro(mensagemErro(inserir.error))
    aviso.sucesso('Ficha técnica salva')
    onFechar()
  }

  return (
    <Modal aberto titulo={`Ficha técnica — ${alvo.nome}`} onFechar={onFechar} largura="max-w-2xl">
      <p className="mb-4 text-sm text-stone-600">
        Informe quanto de cada insumo vai em uma unidade. A cada pedido confirmado o estoque baixa sozinho (pizza meio a meio consome metade de cada sabor).
      </p>
      {carregando || !linhas ? (
        <Carregando />
      ) : !insumos?.length ? (
        <Vazio titulo="Cadastre os insumos primeiro" texto="Vá em Estoque e cadastre os ingredientes para montar a ficha técnica." />
      ) : (
        <form onSubmit={salvar} className="space-y-2">
          {linhas.map((l, i) => {
            const unidade = insumos.find((x) => x.id === l.insumo_id)?.unidade
            return (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[9rem_1fr_7rem_auto]">
                {alvo.usaTamanhos && (
                  <Selecao aria-label="Tamanho" value={l.tamanho_id} onChange={(e) => mudar(i, 'tamanho_id', e.target.value)} className="max-sm:col-span-2">
                    <option value="">Todos os tamanhos</option>
                    {tamanhos?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </Selecao>
                )}
                <Selecao aria-label="Insumo" required value={l.insumo_id} onChange={(e) => mudar(i, 'insumo_id', e.target.value)} className={alvo.usaTamanhos ? '' : 'sm:col-span-2'}>
                  <option value="">Insumo…</option>
                  {insumos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome} ({x.unidade})
                    </option>
                  ))}
                </Selecao>
                <Entrada aria-label={`Quantidade${unidade ? ` em ${unidade}` : ''}`} required inputMode="decimal" placeholder={unidade ? `Qtd (${unidade})` : 'Qtd'} value={l.quantidade} onChange={(e) => mudar(i, 'quantidade', e.target.value)} />
                <Botao variante="sutil" aria-label="Remover linha" onClick={() => setLinhas((x) => x!.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4 text-red-600" />
                </Botao>
              </div>
            )
          })}
          <div className="flex justify-between pt-2">
            <Botao variante="secundario" onClick={() => setLinhas((l) => [...(l ?? []), { tamanho_id: '', insumo_id: '', quantidade: '' }])}>
              <Plus className="size-4" /> Adicionar insumo
            </Botao>
            <Botao type="submit" carregando={salvando}>
              Salvar ficha
            </Botao>
          </div>
        </form>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ produtos
type Rascunho = Partial<Produto> & { precos: Record<string, string> }

function FormProduto({ produto, categorias, tamanhos, onFechar, onSalvo }: { produto: Rascunho; categorias: Categoria[]; tamanhos: Tamanho[]; onFechar: () => void; onSalvo: () => void }) {
  const aviso = useAviso()
  const [p, setP] = useState(produto)
  const [salvando, setSalvando] = useState(false)
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const categoria = categorias.find((c) => c.id === p.categoria_id)
  const numero = (s: unknown) => (s === '' || s == null ? null : Number(String(s).replace(',', '.')))

  async function enviarFoto(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > 3 * 1024 * 1024) return aviso.erro('A foto deve ter no máximo 3 MB.')
    setEnviandoFoto(true)
    const caminho = `${crypto.randomUUID()}.${arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`
    const { error } = await supabase.storage.from('produtos').upload(caminho, arquivo, { cacheControl: '31536000' })
    setEnviandoFoto(false)
    if (error) return aviso.erro(mensagemErro(error))
    setP((v) => ({ ...v, imagem_url: supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl }))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const valores = {
      categoria_id: p.categoria_id,
      nome: p.nome?.trim(),
      descricao: p.descricao?.trim() || null,
      imagem_url: p.imagem_url || null,
      preco: categoria?.usa_tamanhos ? null : numero(p.preco),
      disponivel: p.disponivel ?? true,
      destaque: p.destaque ?? false,
      ativo: p.ativo ?? true,
      ordem: numero(p.ordem) ?? 0,
      ncm: p.ncm?.trim() || null,
      cfop: p.cfop?.trim() || null,
      csosn: p.csosn?.trim() || null,
    }
    const r = p.id
      ? await supabase.from('produtos').update(valores).eq('id', p.id).select('id').single()
      : await supabase.from('produtos').insert(valores).select('id').single()
    let erro = r.error
    if (!erro && categoria?.usa_tamanhos) {
      const id = r.data!.id as string
      const precos = tamanhos.map((t) => ({ produto_id: id, tamanho_id: t.id, preco: numero(p.precos[t.id]) }))
      const comPreco = precos.filter((x) => x.preco != null)
      const semPreco = precos.filter((x) => x.preco == null).map((x) => x.tamanho_id)
      if (comPreco.length) erro = (await supabase.from('produto_precos').upsert(comPreco)).error
      if (!erro && semPreco.length) erro = (await supabase.from('produto_precos').delete().eq('produto_id', id).in('tamanho_id', semPreco)).error
    }
    setSalvando(false)
    if (erro) return aviso.erro(mensagemErro(erro))
    aviso.sucesso('Produto salvo')
    onSalvo()
    onFechar()
  }

  return (
    <Modal aberto titulo={p.id ? 'Editar produto' : 'Novo produto'} onFechar={onFechar} largura="max-w-2xl">
      <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Nome">
          <Entrada required value={p.nome ?? ''} onChange={(e) => setP({ ...p, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Categoria">
          <Selecao required value={p.categoria_id ?? ''} onChange={(e) => setP({ ...p, categoria_id: e.target.value })}>
            <option value="">Selecione…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Descrição / ingredientes" className="sm:col-span-2">
          <AreaTexto value={p.descricao ?? ''} onChange={(e) => setP({ ...p, descricao: e.target.value })} />
        </Campo>

        {categoria?.usa_tamanhos ? (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-forno-800">Preço por tamanho (deixe em branco o tamanho que não vende)</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {tamanhos.map((t) => (
                <Campo key={t.id} rotulo={t.nome}>
                  <Entrada type="number" step="0.01" min="0" inputMode="decimal" value={p.precos[t.id] ?? ''} onChange={(e) => setP({ ...p, precos: { ...p.precos, [t.id]: e.target.value } })} />
                </Campo>
              ))}
            </div>
          </fieldset>
        ) : (
          <Campo rotulo="Preço (R$)">
            <Entrada required type="number" step="0.01" min="0" inputMode="decimal" value={p.preco ?? ''} onChange={(e) => setP({ ...p, preco: e.target.value as unknown as number })} />
          </Campo>
        )}

        <Campo rotulo="Ordem no cardápio" dica="Números menores aparecem primeiro.">
          <Entrada type="number" value={p.ordem ?? 0} onChange={(e) => setP({ ...p, ordem: e.target.value as unknown as number })} />
        </Campo>
        <div className="flex items-center gap-3 sm:col-span-2">
          {p.imagem_url && <img src={p.imagem_url} alt="" className="size-16 rounded-lg object-cover" />}
          <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50">
            <ImagePlus className="size-4" /> {enviandoFoto ? 'Enviando…' : p.imagem_url ? 'Trocar foto' : 'Adicionar foto'}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => enviarFoto(e.target.files?.[0])} />
          </label>
          {p.imagem_url && (
            <Botao variante="sutil" onClick={() => setP({ ...p, imagem_url: null })}>
              Remover
            </Botao>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
          <Alternar ativo={p.disponivel ?? true} onChange={(v) => setP({ ...p, disponivel: v })} rotulo="Disponível hoje" />
          <Alternar ativo={p.destaque ?? false} onChange={(v) => setP({ ...p, destaque: v })} rotulo="Destaque na capa" />
          <Alternar ativo={p.ativo ?? true} onChange={(v) => setP({ ...p, ativo: v })} rotulo="Aparece no cardápio" />
        </div>

        <details className="rounded-lg border border-stone-200 px-3 py-2 sm:col-span-2">
          <summary className="text-sm font-semibold">Dados fiscais (opcional)</summary>
          <p className="mt-2 text-xs text-stone-500">Em branco, vale o padrão definido na tela Fiscal. Confirme os códigos com a contabilidade.</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Campo rotulo="NCM">
              <Entrada maxLength={8} value={p.ncm ?? ''} onChange={(e) => setP({ ...p, ncm: e.target.value })} />
            </Campo>
            <Campo rotulo="CFOP">
              <Entrada maxLength={4} value={p.cfop ?? ''} onChange={(e) => setP({ ...p, cfop: e.target.value })} />
            </Campo>
            <Campo rotulo="CSOSN">
              <Entrada maxLength={3} value={p.csosn ?? ''} onChange={(e) => setP({ ...p, csosn: e.target.value })} />
            </Campo>
          </div>
        </details>

        <div className="flex justify-end gap-2 sm:col-span-2">
          <Botao variante="secundario" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" carregando={salvando}>
            Salvar
          </Botao>
        </div>
      </form>
    </Modal>
  )
}

function Produtos() {
  const { recarregar: recarregarLoja } = useLoja()
  const aviso = useAviso()
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const [ficha, setFicha] = useState<{ produto_id: string; nome: string; usaTamanhos: boolean } | null>(null)
  const { dados: produtos, carregando, erro, recarregar } = useConsulta<Produto[]>(
    () => supabase.from('produtos').select('*, produto_precos(tamanho_id, preco)').order('ordem').order('nome'),
    [],
  )
  const { dados: categorias } = useConsulta<Categoria[]>(() => supabase.from('categorias').select('*').order('ordem'), [])
  const { dados: tamanhos } = useConsulta<Tamanho[]>(() => supabase.from('tamanhos').select('*').eq('ativo', true).order('ordem'), [])

  const mudou = () => {
    recarregar()
    recarregarLoja()
  }
  const abrir = (p?: Produto, categoriaId?: string) =>
    setEditando({
      ...(p ?? { categoria_id: categoriaId }),
      precos: Object.fromEntries((p?.produto_precos ?? []).map((x) => [x.tamanho_id, String(x.preco)])),
    })

  async function alternarDisponivel(p: Produto) {
    const { error } = await supabase.from('produtos').update({ disponivel: !p.disponivel }).eq('id', p.id)
    if (error) return aviso.erro(mensagemErro(error))
    mudou()
  }
  async function excluir(p: Produto) {
    if (!confirm(`Excluir "${p.nome}"? Os pedidos antigos continuam no histórico.`)) return
    const { error } = await supabase.from('produtos').delete().eq('id', p.id)
    if (error) return aviso.erro(mensagemErro(error))
    mudou()
  }

  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !produtos) return <Carregando />
  if (!categorias?.length) return <Vazio titulo="Comece pelas categorias" texto="Crie ao menos uma categoria (ex.: Pizzas Tradicionais) na aba Categorias." />

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Botao onClick={() => abrir()}>
          <Plus className="size-4" /> Novo produto
        </Botao>
      </div>
      <div className="space-y-6">
        {categorias.map((c) => {
          const lista = (produtos ?? []).filter((p) => p.categoria_id === c.id)
          return (
            <section key={c.id}>
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                {c.nome} <span className="text-sm font-normal text-stone-500">({lista.length})</span>
                <button type="button" className="text-sm font-semibold text-molho-700 hover:underline" onClick={() => abrir(undefined, c.id)}>
                  + adicionar
                </button>
              </h2>
              <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                {lista.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm ${p.ativo ? '' : 'opacity-50'}`}>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="flex items-center gap-1.5 font-semibold">
                        {p.nome}
                        {p.destaque && <Star className="size-3.5 fill-queijo-400 text-queijo-500" aria-label="Destaque" />}
                        {!p.ativo && <span className="text-xs font-normal">(oculto)</span>}
                      </p>
                      <p className="truncate text-stone-500">{p.descricao}</p>
                    </div>
                    <p className="text-stone-700 tabular-nums">
                      {c.usa_tamanhos
                        ? (tamanhos ?? [])
                            .map((t) => p.produto_precos.find((x) => x.tamanho_id === t.id))
                            .filter(Boolean)
                            .map((x) => brl(x!.preco).replace('R$', '').trim())
                            .join(' · ') || 'sem preço'
                        : brl(p.preco)}
                    </p>
                    <Alternar ativo={p.disponivel} onChange={() => alternarDisponivel(p)} rotulo="Disponível" />
                    <div className="flex">
                      <Botao variante="sutil" tamanho="p" title="Ficha técnica" aria-label="Ficha técnica" onClick={() => setFicha({ produto_id: p.id, nome: p.nome, usaTamanhos: c.usa_tamanhos })}>
                        <Scale className="size-4" />
                      </Botao>
                      <Botao variante="sutil" tamanho="p" aria-label="Editar" onClick={() => abrir(p)}>
                        <Pencil className="size-4" />
                      </Botao>
                      <Botao variante="sutil" tamanho="p" aria-label="Excluir" onClick={() => excluir(p)}>
                        <Trash2 className="size-4 text-red-600" />
                      </Botao>
                    </div>
                  </li>
                ))}
                {lista.length === 0 && <li className="px-3 py-4 text-sm text-stone-500">Nenhum produto nesta categoria.</li>}
              </ul>
            </section>
          )
        })}
      </div>
      {editando && <FormProduto produto={editando} categorias={categorias} tamanhos={tamanhos ?? []} onFechar={() => setEditando(null)} onSalvo={mudou} />}
      <FichaTecnica key={ficha?.produto_id} alvo={ficha} onFechar={() => setFicha(null)} />
    </>
  )
}

// ------------------------------------------------------------------ página
const simNao = (v: boolean) => (v ? 'Sim' : 'Não')

export default function CardapioAdmin() {
  const [aba, setAba] = useState<'produtos' | 'categorias' | 'tamanhos' | 'adicionais'>('produtos')
  const { recarregar } = useLoja()
  const [ficha, setFicha] = useState<{ adicional_id: string; nome: string; usaTamanhos: boolean } | null>(null)

  return (
    <Pagina titulo="Cardápio" descricao="Produtos, preços e o que está disponível hoje.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'produtos', rotulo: 'Produtos' },
            { id: 'categorias', rotulo: 'Categorias' },
            { id: 'tamanhos', rotulo: 'Tamanhos de pizza' },
            { id: 'adicionais', rotulo: 'Bordas e adicionais' },
          ]}
        />
      </div>

      {aba === 'produtos' && <Produtos />}

      {aba === 'categorias' && (
        <Crud<Categoria>
          tabela="categorias"
          nome="categoria"
          feminino
          ordem="ordem"
          aoMudar={recarregar}
          colunas={[
            { rotulo: 'Nome', render: (c) => <b>{c.nome}</b> },
            { rotulo: 'Tipo', render: (c) => (c.usa_tamanhos ? 'Pizza (tamanhos, meio a meio, bordas)' : 'Produto simples') },
            { rotulo: 'Ordem', render: (c) => c.ordem },
            { rotulo: 'Ativa', render: (c) => simNao(c.ativo) },
          ]}
          campos={[
            { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
            { nome: 'ordem', rotulo: 'Ordem', tipo: 'numero', padrao: 0 },
            { nome: 'descricao', rotulo: 'Descrição', inteira: true },
            { nome: 'usa_tamanhos', rotulo: 'É pizza (preço por tamanho)', tipo: 'booleano', padrao: false },
            { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano' },
          ]}
        />
      )}

      {aba === 'tamanhos' && (
        <Crud<Tamanho>
          tabela="tamanhos"
          nome="tamanho"
          ordem="ordem"
          aoMudar={recarregar}
          colunas={[
            { rotulo: 'Nome', render: (t) => <b>{t.nome}</b> },
            { rotulo: 'Descrição', render: (t) => t.descricao },
            { rotulo: 'Máx. de sabores', render: (t) => t.max_sabores },
            { rotulo: 'Ativo', render: (t) => simNao(t.ativo) },
          ]}
          campos={[
            { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
            { nome: 'descricao', rotulo: 'Descrição', dica: 'Ex.: 8 fatias' },
            { nome: 'fatias', rotulo: 'Fatias', tipo: 'numero' },
            { nome: 'max_sabores', rotulo: 'Máximo de sabores (1 a 4)', tipo: 'numero', padrao: 1, obrigatorio: true },
            { nome: 'ordem', rotulo: 'Ordem', tipo: 'numero', padrao: 0 },
            { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
          ]}
        />
      )}

      {aba === 'adicionais' && (
        <>
          <Crud<Adicional>
            tabela="adicionais"
            nome="adicional"
            ordem="tipo"
            aoMudar={recarregar}
            colunas={[
              { rotulo: 'Nome', render: (a) => <b>{a.nome}</b> },
              { rotulo: 'Tipo', render: (a) => (a.tipo === 'borda' ? 'Borda recheada' : 'Adicional') },
              { rotulo: 'Preço', render: (a) => brl(a.preco) },
              { rotulo: 'Ativo', render: (a) => simNao(a.ativo) },
            ]}
            campos={[
              { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
              { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, padrao: 'extra', opcoes: [{ valor: 'borda', rotulo: 'Borda recheada' }, { valor: 'extra', rotulo: 'Adicional' }] },
              { nome: 'preco', rotulo: 'Preço (R$)', tipo: 'moeda', obrigatorio: true },
              { nome: 'ordem', rotulo: 'Ordem', tipo: 'numero', padrao: 0 },
              { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
            ]}
            acoes={(a) => (
              <Botao variante="sutil" tamanho="p" title="Ficha técnica" aria-label="Ficha técnica" onClick={() => setFicha({ adicional_id: a.id, nome: a.nome, usaTamanhos: true })}>
                <Scale className="size-4" />
              </Botao>
            )}
          />
          <FichaTecnica key={ficha?.adicional_id} alvo={ficha} onFechar={() => setFicha(null)} />
        </>
      )}
    </Pagina>
  )
}
