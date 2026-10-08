import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { Banners as VerBanners } from '../components/Banners'
import { Crud } from '../components/Crud'
import { Abas, Alternar, AreaTexto, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selecao, Selo, Tabela, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { DIAS_SEMANA, brl, dataCurta } from '../lib/formato'
import { enviarImagem } from '../lib/imagens'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Banner, Categoria, PosicaoBanner, Produto, Promocao, SecaoId, SiteConteudo, Tamanho, Tamanho3 } from '../lib/tipos'
import { Pagina } from './AdminLayout'

const SECOES: Record<SecaoId, { nome: string; descricao: string }> = {
  hero: { nome: 'Capa', descricao: 'Título grande, frase de apresentação e botões' },
  banners: { nome: 'Banners', descricao: 'Banners cadastrados na posição “meio da página inicial”' },
  promocoes: { nome: 'Promoções', descricao: 'Produtos com promoção valendo agora' },
  destaques: { nome: 'Destaques', descricao: 'Produtos marcados como “destaque na capa” no cardápio' },
  como_funciona: { nome: 'Como funciona', descricao: 'Os três passos explicando o pedido' },
}
const TAMANHOS: { valor: Tamanho3; rotulo: string }[] = [
  { valor: 'pequeno', rotulo: 'Pequeno' },
  { valor: 'medio', rotulo: 'Médio' },
  { valor: 'grande', rotulo: 'Grande' },
]
const POSICOES: Record<PosicaoBanner, string> = {
  inicio_topo: 'Página inicial — no topo',
  inicio_meio: 'Página inicial — no meio',
  cardapio_topo: 'Cardápio — no topo',
  cardapio_entre_categorias: 'Cardápio — antes de uma categoria',
  cardapio_produtos: 'Cardápio — entre os produtos de uma categoria',
  cardapio_fim: 'Cardápio — no fim',
}

function Imagem({ url, onChange, rotulo }: { url: string | null; onChange: (url: string | null) => void; rotulo: string }) {
  const aviso = useAviso()
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3">
      {url && <img src={url} alt="" className="h-16 max-w-40 rounded-lg border border-stone-200 object-contain" />}
      <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50">
        <ImagePlus className="size-4" /> {enviando ? 'Enviando…' : url ? 'Trocar' : rotulo}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const arquivo = e.target.files?.[0]
            if (!arquivo) return
            setEnviando(true)
            enviarImagem(arquivo)
              .then(onChange, (erro) => aviso.erro(mensagemErro(erro)))
              .finally(() => setEnviando(false))
          }}
        />
      </label>
      {url && (
        <Botao variante="sutil" onClick={() => onChange(null)}>
          Remover
        </Botao>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ página inicial e tela do produto
function Aparencia({ so }: { so: 'inicio' | 'produto' }) {
  const { conteudo, recarregar } = useLoja()
  const aviso = useAviso()
  const [c, setC] = useState<SiteConteudo | null>(conteudo)
  const [salvando, setSalvando] = useState(false)
  useEffect(() => {
    setC(conteudo)
  }, [conteudo])
  if (!c) return <Carregando />

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const { error } = await supabase.from('site_conteudo').update({ dados: c }).eq('id', 1)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Site atualizado')
    recarregar()
  }
  const mover = (i: number, d: number) =>
    setC((v) => {
      if (!v) return v
      const secoes = [...v.secoes]
      ;[secoes[i], secoes[i + d]] = [secoes[i + d], secoes[i]]
      return { ...v, secoes }
    })
  const secao = (i: number, valores: Partial<SiteConteudo['secoes'][number]>) => setC((v) => v && { ...v, secoes: v.secoes.map((s, j) => (j === i ? { ...s, ...valores } : s)) })

  if (so === 'produto') {
    const itens: [keyof SiteConteudo['produto'], string, string][] = [
      ['foto', 'Foto', 'A foto cadastrada no produto'],
      ['descricao', 'Descrição', 'O texto curto do cardápio'],
      ['ingredientes', 'Ingredientes', 'A lista de ingredientes'],
      ['nutricional', 'Informações nutricionais', 'Tabela com calorias, carboidratos, alergênicos…'],
      ['complementos', 'Complementos', 'Bordas recheadas e adicionais'],
      ['observacoes', 'Observações', 'Campo para o cliente escrever (ex.: sem cebola)'],
    ]
    return (
      <form onSubmit={salvar}>
        <Cartao className="max-w-2xl space-y-4 p-5">
          <p className="text-sm text-stone-600">Escolha o que o cliente vê ao tocar em um produto. Nome, tamanho, preço e promoções aparecem sempre.</p>
          {itens.map(([chave, nome, descricao]) => (
            <div key={chave} className="flex items-center justify-between gap-4 border-b border-stone-100 pb-3 last:border-0">
              <div>
                <p className="font-semibold">{nome}</p>
                <p className="text-sm text-stone-500">{descricao}</p>
              </div>
              <Alternar ativo={c.produto[chave]} onChange={(v) => setC({ ...c, produto: { ...c.produto, [chave]: v } })} rotulo={c.produto[chave] ? 'Visível' : 'Oculto'} />
            </div>
          ))}
          <div className="flex justify-end">
            <Botao type="submit" carregando={salvando}>
              Salvar
            </Botao>
          </div>
        </Cartao>
      </form>
    )
  }

  return (
    <form onSubmit={salvar} className="grid gap-4 xl:grid-cols-2">
      <Cartao className="space-y-4 p-5">
        <h2 className="font-display text-lg font-semibold">Logo e capa</h2>
        <Campo rotulo="Logo" dica="Em branco, o site usa a marca padrão da Tia Cê.">
          <Imagem url={c.logo_url} onChange={(logo_url) => setC({ ...c, logo_url })} rotulo="Enviar logo" />
        </Campo>
        <Campo rotulo="Título da capa">
          <Entrada required value={c.hero.titulo} onChange={(e) => setC({ ...c, hero: { ...c.hero, titulo: e.target.value } })} />
        </Campo>
        <Campo rotulo="Trecho do título em destaque" dica="Aparece em amarelo. Precisa estar escrito igual no título.">
          <Entrada value={c.hero.destaque} onChange={(e) => setC({ ...c, hero: { ...c.hero, destaque: e.target.value } })} />
        </Campo>
        <Campo rotulo="Frase de apresentação">
          <AreaTexto value={c.hero.subtitulo} onChange={(e) => setC({ ...c, hero: { ...c.hero, subtitulo: e.target.value } })} />
        </Campo>
        <Campo rotulo="Imagem da capa" dica="Em branco, aparece a pizza ilustrada.">
          <Imagem url={c.hero.imagem_url} onChange={(imagem_url) => setC({ ...c, hero: { ...c.hero, imagem_url } })} rotulo="Enviar imagem" />
        </Campo>
      </Cartao>

      <Cartao className="space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Seções da página inicial</h2>
        <p className="text-sm text-stone-600">Ligue, desligue, mude a ordem e o tamanho de cada parte.</p>
        <ul className="space-y-2">
          {c.secoes.map((s, i) => (
            <li key={s.id} className={cx('flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 p-3', !s.ativo && 'bg-stone-50 text-stone-500')}>
              <div className="flex flex-col">
                <button type="button" aria-label={`Subir ${SECOES[s.id].nome}`} disabled={i === 0} onClick={() => mover(i, -1)} className="rounded p-0.5 hover:bg-stone-100 disabled:opacity-25">
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" aria-label={`Descer ${SECOES[s.id].nome}`} disabled={i === c.secoes.length - 1} onClick={() => mover(i, 1)} className="rounded p-0.5 hover:bg-stone-100 disabled:opacity-25">
                  <ArrowDown className="size-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{SECOES[s.id].nome}</p>
                <p className="text-xs text-stone-500">{SECOES[s.id].descricao}</p>
              </div>
              <Selecao aria-label={`Tamanho de ${SECOES[s.id].nome}`} className="w-auto" value={s.tamanho} onChange={(e) => secao(i, { tamanho: e.target.value as Tamanho3 })}>
                {TAMANHOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </option>
                ))}
              </Selecao>
              <Alternar ativo={s.ativo} onChange={(v) => secao(i, { ativo: v })} rotulo={s.ativo ? 'Ligada' : 'Desligada'} />
            </li>
          ))}
        </ul>
      </Cartao>

      <Cartao className="space-y-4 p-5 xl:col-span-2">
        <h2 className="font-display text-lg font-semibold">Textos</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Título da seção de destaques">
            <Entrada value={c.destaques_titulo} onChange={(e) => setC({ ...c, destaques_titulo: e.target.value })} />
          </Campo>
          <Campo rotulo="Título da seção de promoções">
            <Entrada value={c.promocoes_titulo} onChange={(e) => setC({ ...c, promocoes_titulo: e.target.value })} />
          </Campo>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {c.passos.map((p, i) => (
            <div key={i} className="space-y-2 rounded-lg bg-stone-50 p-3">
              <Campo rotulo={`Passo ${i + 1} — título`}>
                <Entrada value={p.titulo} onChange={(e) => setC({ ...c, passos: c.passos.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) })} />
              </Campo>
              <Campo rotulo="Texto">
                <AreaTexto rows={3} value={p.texto} onChange={(e) => setC({ ...c, passos: c.passos.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })} />
              </Campo>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3">
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-molho-700 hover:underline">
            Ver o site <ExternalLink className="size-3.5" />
          </a>
          <Botao type="submit" carregando={salvando}>
            Salvar página inicial
          </Botao>
        </div>
      </Cartao>
    </form>
  )
}

// ------------------------------------------------------------------ promoções
type Rascunho = Omit<Promocao, 'id' | 'produtos' | 'valor'> & { id?: string; valor: string; produtos: string[] }
type PromocaoSalva = Promocao & { promocao_produtos: { produto_id: string }[]; ativo: boolean }

const novaPromocao: Rascunho = {
  nome: '', descricao: '', tipo: 'percentual', valor: '', tamanho_id: null, selo: 'Em promoção', destaque: true, imagem_url: null,
  data_inicio: null, data_fim: null, hora_inicio: null, hora_fim: null, dias_semana: null, ativo: true, produtos: [],
}

function quando(p: Promocao) {
  const partes = [
    p.data_inicio || p.data_fim ? `${p.data_inicio ? dataCurta(p.data_inicio) : 'já'} até ${p.data_fim ? dataCurta(p.data_fim) : 'sem data final'}` : 'Sem data final',
    p.dias_semana?.length ? p.dias_semana.map((d) => DIAS_SEMANA[d].slice(0, 3)).join(', ') : 'todos os dias',
    p.hora_inicio || p.hora_fim ? `${(p.hora_inicio ?? '00:00').slice(0, 5)}–${(p.hora_fim ?? '23:59').slice(0, 5)}` : 'o dia todo',
  ]
  return partes.join(' · ')
}

function Promocoes() {
  const aviso = useAviso()
  const { recarregar: recarregarLoja, catalogo } = useLoja()
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const [salvando, setSalvando] = useState(false)
  const { dados, carregando, erro, recarregar } = useConsulta<PromocaoSalva[]>(() => supabase.from('promocoes').select('*, promocao_produtos(produto_id)').order('criado_em', { ascending: false }), [])
  const { dados: produtos } = useConsulta<(Produto & { categorias: Categoria })[]>(() => supabase.from('produtos').select('*, categorias(nome)').eq('ativo', true).order('nome'), [])
  const { dados: tamanhos } = useConsulta<Tamanho[]>(() => supabase.from('tamanhos').select('*').eq('ativo', true).order('ordem'), [])
  const vigentes = new Set(catalogo.promocoes.map((p) => p.id))
  const mudou = () => {
    recarregar()
    recarregarLoja()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!editando) return
    if (!editando.produtos.length) return aviso.erro('Escolha ao menos um produto para a promoção.')
    setSalvando(true)
    const { id, produtos: escolhidos } = editando
    const valores = {
      nome: editando.nome.trim(), selo: editando.selo.trim(), tipo: editando.tipo, destaque: editando.destaque, imagem_url: editando.imagem_url, ativo: editando.ativo ?? true,
      valor: Number(String(editando.valor).replace(',', '.')), descricao: editando.descricao?.trim() || null, tamanho_id: editando.tamanho_id || null,
      data_inicio: editando.data_inicio || null, data_fim: editando.data_fim || null, hora_inicio: editando.hora_inicio || null, hora_fim: editando.hora_fim || null,
      dias_semana: editando.dias_semana?.length ? editando.dias_semana : null,
    }
    const r = id ? await supabase.from('promocoes').update(valores).eq('id', id).select('id').single() : await supabase.from('promocoes').insert(valores).select('id').single()
    let falha = r.error
    if (!falha) {
      const pid = r.data!.id as string
      falha = (await supabase.from('promocao_produtos').delete().eq('promocao_id', pid)).error
      if (!falha) falha = (await supabase.from('promocao_produtos').insert(escolhidos.map((produto_id) => ({ promocao_id: pid, produto_id })))).error
    }
    setSalvando(false)
    if (falha) return aviso.erro(mensagemErro(falha))
    aviso.sucesso('Promoção salva')
    setEditando(null)
    mudou()
  }

  async function alternar(p: PromocaoSalva) {
    const { error } = await supabase.from('promocoes').update({ ativo: !p.ativo }).eq('id', p.id)
    if (error) return aviso.erro(mensagemErro(error))
    mudou()
  }
  async function excluir(p: PromocaoSalva) {
    if (!confirm(`Excluir a promoção "${p.nome}"?`)) return
    const { error } = await supabase.from('promocoes').delete().eq('id', p.id)
    if (error) return aviso.erro(mensagemErro(error))
    mudou()
  }

  const marcar = (produtoId: string) => setEditando((v) => v && { ...v, produtos: v.produtos.includes(produtoId) ? v.produtos.filter((x) => x !== produtoId) : [...v.produtos, produtoId] })
  const dia = (d: number) => setEditando((v) => v && { ...v, dias_semana: (v.dias_semana ?? []).includes(d) ? (v.dias_semana ?? []).filter((x) => x !== d) : [...(v.dias_semana ?? []), d].sort() })
  const desconto = (p: Promocao) => (p.tipo === 'percentual' ? `${Number(p.valor)}% de desconto` : p.tipo === 'valor' ? `${brl(p.valor)} de desconto` : `Por ${brl(p.valor)}`)

  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !dados) return <Carregando />
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">A promoção aparece como selo no produto, na tela de detalhes e na faixa de promoções da página inicial.</p>
        <Botao onClick={() => setEditando(novaPromocao)}>
          <Plus className="size-4" /> Nova promoção
        </Botao>
      </div>
      {!dados?.length ? (
        <Vazio titulo="Nenhuma promoção cadastrada" texto="Crie uma promoção para dar desconto em um ou mais produtos, com datas, horários e dias da semana." />
      ) : (
        <Tabela colunas={['Promoção', 'Desconto', 'Produtos', 'Quando vale', 'Situação', '']}>
          {dados.map((p) => (
            <tr key={p.id} className={p.ativo ? '' : 'text-stone-400'}>
              <td>
                <b>{p.nome}</b>
                <span className="block text-xs text-stone-500">Selo: {p.selo}</span>
              </td>
              <td>{desconto(p)}</td>
              <td className="max-w-56">
                {p.promocao_produtos.length} produto(s)
                <span className="block truncate text-xs text-stone-500">{p.promocao_produtos.map((x) => produtos?.find((y) => y.id === x.produto_id)?.nome).filter(Boolean).join(', ')}</span>
              </td>
              <td className="text-xs">{quando(p)}</td>
              <td>
                {vigentes.has(p.id) ? <Selo className="bg-emerald-100 text-emerald-900">Valendo agora</Selo> : p.ativo ? <Selo className="bg-stone-100 text-stone-700">Fora do período</Selo> : <Selo className="bg-stone-200 text-stone-600">Desligada</Selo>}
              </td>
              <td className="text-right whitespace-nowrap">
                <Alternar ativo={p.ativo} onChange={() => alternar(p)} rotulo="" />
                <Botao variante="sutil" tamanho="p" aria-label="Editar" onClick={() => setEditando({ ...p, valor: String(p.valor), produtos: p.promocao_produtos.map((x) => x.produto_id) })}>
                  <Pencil className="size-4" />
                </Botao>
                <Botao variante="sutil" tamanho="p" aria-label="Excluir" onClick={() => excluir(p)}>
                  <Trash2 className="size-4 text-red-600" />
                </Botao>
              </td>
            </tr>
          ))}
        </Tabela>
      )}

      <Modal aberto={editando != null} titulo={editando?.id ? 'Editar promoção' : 'Nova promoção'} onFechar={() => setEditando(null)} largura="max-w-2xl">
        {editando && (
          <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome da promoção">
              <Entrada required placeholder="Ex.: Terça da Calabresa" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
            </Campo>
            <Campo rotulo="Selo no produto">
              <Entrada required maxLength={20} value={editando.selo} onChange={(e) => setEditando({ ...editando, selo: e.target.value })} />
            </Campo>
            <Campo rotulo="Descrição (opcional)" className="sm:col-span-2">
              <Entrada value={editando.descricao ?? ''} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} />
            </Campo>
            <Campo rotulo="Tipo de desconto">
              <Selecao value={editando.tipo} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as Promocao['tipo'] })}>
                <option value="percentual">Percentual (%)</option>
                <option value="valor">Valor em reais de desconto</option>
                <option value="preco">Preço promocional fixo</option>
              </Selecao>
            </Campo>
            <Campo rotulo={editando.tipo === 'percentual' ? 'Desconto (%)' : editando.tipo === 'valor' ? 'Desconto (R$)' : 'Preço promocional (R$)'}>
              <Entrada required type="number" step="0.01" min="0.01" value={editando.valor} onChange={(e) => setEditando({ ...editando, valor: e.target.value })} />
            </Campo>
            <Campo rotulo="Vale para qual tamanho de pizza?" dica="Preço fixo normalmente vale para um tamanho só.">
              <Selecao value={editando.tamanho_id ?? ''} onChange={(e) => setEditando({ ...editando, tamanho_id: e.target.value || null })}>
                <option value="">Todos os tamanhos</option>
                {tamanhos?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <div className="flex items-end gap-6 pb-2">
              <Alternar ativo={editando.destaque} onChange={(v) => setEditando({ ...editando, destaque: v })} rotulo="Mostrar na página inicial" />
            </div>

            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-forno-800">Produtos participantes ({editando.produtos.length})</legend>
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-stone-200 p-2 sm:grid-cols-2">
                {produtos?.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-stone-50">
                    <input type="checkbox" className="size-4 accent-molho-600" checked={editando.produtos.includes(p.id)} onChange={() => marcar(p.id)} />
                    {p.nome} <span className="text-xs text-stone-400">{p.categorias?.nome}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Campo rotulo="Data inicial (opcional)">
              <Entrada type="date" value={editando.data_inicio ?? ''} onChange={(e) => setEditando({ ...editando, data_inicio: e.target.value || null })} />
            </Campo>
            <Campo rotulo="Data final (opcional)">
              <Entrada type="date" value={editando.data_fim ?? ''} onChange={(e) => setEditando({ ...editando, data_fim: e.target.value || null })} />
            </Campo>
            <Campo rotulo="Horário — das (opcional)">
              <Entrada type="time" value={(editando.hora_inicio ?? '').slice(0, 5)} onChange={(e) => setEditando({ ...editando, hora_inicio: e.target.value || null })} />
            </Campo>
            <Campo rotulo="Horário — até (opcional)">
              <Entrada type="time" value={(editando.hora_fim ?? '').slice(0, 5)} onChange={(e) => setEditando({ ...editando, hora_fim: e.target.value || null })} />
            </Campo>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-forno-800">Dias da semana (nenhum marcado = todos)</legend>
              <div className="flex flex-wrap gap-2">
                {DIAS_SEMANA.map((nome, d) => {
                  const ativo = (editando.dias_semana ?? []).includes(d)
                  return (
                    <button key={d} type="button" aria-pressed={ativo} onClick={() => dia(d)} className={cx('rounded-full border px-3 py-1.5 text-sm font-semibold', ativo ? 'border-molho-600 bg-molho-600 text-white' : 'border-stone-300 bg-white')}>
                      {nome.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Botao variante="secundario" onClick={() => setEditando(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" carregando={salvando}>
                Salvar promoção
              </Botao>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}

// ------------------------------------------------------------------ página
interface Cupom {
  id: string
  codigo: string
  tipo: 'percentual' | 'valor'
  valor: number
  pedido_minimo: number
  validade: string | null
  usos_max: number | null
  usos: number
  ativo: boolean
}

export default function Conteudo() {
  const [aba, setAba] = useState<'inicio' | 'banners' | 'promocoes' | 'cupons' | 'produto'>('inicio')
  const { recarregar, catalogo } = useLoja()
  const { dados: categorias } = useConsulta<Categoria[]>(() => supabase.from('categorias').select('*').order('ordem'), [])
  const nomeCategoria = (id: string | null) => categorias?.find((c) => c.id === id)?.nome

  return (
    <Pagina titulo="Site e promoções" descricao="Tudo o que o cliente vê: página inicial, banners, promoções, cupons e a tela do produto.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'inicio', rotulo: 'Página inicial' },
            { id: 'banners', rotulo: 'Banners' },
            { id: 'promocoes', rotulo: 'Promoções' },
            { id: 'cupons', rotulo: 'Cupons' },
            { id: 'produto', rotulo: 'Tela do produto' },
          ]}
        />
      </div>

      {aba === 'inicio' && <Aparencia so="inicio" />}
      {aba === 'produto' && <Aparencia so="produto" />}
      {aba === 'promocoes' && <Promocoes />}

      {aba === 'banners' && (
        <>
          {catalogo.banners.length > 0 && (
            <details className="mb-4 rounded-xl border border-stone-200 bg-white p-4">
              <summary className="text-sm font-semibold">Pré-visualizar os banners ativos</summary>
              <VerBanners itens={catalogo.banners} className="mt-3" />
            </details>
          )}
          <Crud<Banner>
            tabela="banners"
            nome="banner"
            ordem="ordem"
            aoMudar={recarregar}
            preparar={(v) => ({ ...v, ordem: v.ordem ?? 0 })}
            colunas={[
              { rotulo: 'Banner', render: (b) => (<><b>{b.titulo}</b><span className="block text-xs text-stone-500">{b.subtitulo}</span></>) },
              { rotulo: 'Onde aparece', render: (b) => (<>{POSICOES[b.posicao]}{b.categoria_id && <span className="block text-xs text-stone-500">{nomeCategoria(b.categoria_id)}</span>}</>) },
              { rotulo: 'Tamanho', render: (b) => TAMANHOS.find((t) => t.valor === b.tamanho)?.rotulo },
              { rotulo: 'Período', render: (b) => (b.data_inicio || b.data_fim ? `${dataCurta(b.data_inicio) || 'já'} até ${dataCurta(b.data_fim) || 'sem fim'}` : 'Sempre') },
              { rotulo: 'Ativo', render: (b) => (b.ativo ? 'Sim' : 'Não') },
            ]}
            campos={[
              { nome: 'titulo', rotulo: 'Título', obrigatorio: true, inteira: true },
              { nome: 'subtitulo', rotulo: 'Texto de apoio', inteira: true },
              { nome: 'posicao', rotulo: 'Onde aparece', tipo: 'selecao', obrigatorio: true, padrao: 'inicio_meio', opcoes: Object.entries(POSICOES).map(([valor, rotulo]) => ({ valor, rotulo })) },
              { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'selecao', dica: 'Só para as posições ligadas a uma categoria do cardápio.', opcoes: (categorias ?? []).map((c) => ({ valor: c.id, rotulo: c.nome })) },
              { nome: 'tamanho', rotulo: 'Tamanho', tipo: 'selecao', obrigatorio: true, padrao: 'medio', opcoes: TAMANHOS.map((t) => ({ valor: t.valor, rotulo: t.rotulo })) },
              { nome: 'cor', rotulo: 'Cor de fundo', tipo: 'selecao', obrigatorio: true, padrao: 'molho', opcoes: [{ valor: 'molho', rotulo: 'Vermelho' }, { valor: 'forno', rotulo: 'Marrom escuro' }, { valor: 'queijo', rotulo: 'Amarelo' }, { valor: 'manjericao', rotulo: 'Verde' }] },
              { nome: 'imagem_url', rotulo: 'Enviar imagem de fundo', tipo: 'imagem', dica: 'Opcional. Sem imagem, vale a cor de fundo.' },
              { nome: 'botao', rotulo: 'Texto do botão', dica: 'Ex.: Ver cardápio' },
              { nome: 'link', rotulo: 'Link ao tocar', dica: 'Ex.: /cardapio' },
              { nome: 'data_inicio', rotulo: 'Mostrar a partir de', tipo: 'data' },
              { nome: 'data_fim', rotulo: 'Mostrar até', tipo: 'data' },
              { nome: 'ordem', rotulo: 'Ordem', tipo: 'numero', padrao: 0 },
              { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
            ]}
          />
        </>
      )}

      {aba === 'cupons' && (
        <Crud<Cupom>
          tabela="cupons"
          nome="cupom"
          ordem="codigo"
          preparar={(v) => ({ ...v, codigo: String(v.codigo ?? '').toUpperCase().replace(/\s/g, '') })}
          colunas={[
            { rotulo: 'Código', render: (x) => <b>{x.codigo}</b> },
            { rotulo: 'Desconto', render: (x) => (x.tipo === 'percentual' ? `${Number(x.valor)}%` : brl(x.valor)) },
            { rotulo: 'Pedido mínimo', render: (x) => (Number(x.pedido_minimo) > 0 ? brl(x.pedido_minimo) : '—') },
            { rotulo: 'Validade', render: (x) => dataCurta(x.validade) || 'Sem validade' },
            { rotulo: 'Usos', render: (x) => `${x.usos}${x.usos_max ? ` de ${x.usos_max}` : ''}` },
            { rotulo: 'Ativo', render: (x) => (x.ativo ? 'Sim' : 'Não') },
          ]}
          campos={[
            { nome: 'codigo', rotulo: 'Código', obrigatorio: true },
            { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, padrao: 'percentual', opcoes: [{ valor: 'percentual', rotulo: 'Percentual (%)' }, { valor: 'valor', rotulo: 'Valor fixo (R$)' }] },
            { nome: 'valor', rotulo: 'Valor do desconto', tipo: 'numero', obrigatorio: true },
            { nome: 'pedido_minimo', rotulo: 'Pedido mínimo (R$)', tipo: 'moeda', padrao: 0, obrigatorio: true },
            { nome: 'validade', rotulo: 'Válido até', tipo: 'data' },
            { nome: 'usos_max', rotulo: 'Limite de usos', tipo: 'numero', dica: 'Em branco = sem limite.' },
            { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
          ]}
        />
      )}
    </Pagina>
  )
}
