import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Image as IconeImagem, ImagePlus, LayoutTemplate, Monitor, MousePointerClick, Plus, RotateCcw, Smartphone, Trash2, Type,
  type LucideIcon,
} from 'lucide-react'
import { AreaTexto, Botao, Campo, Cartao, Entrada, Selecao, cx, useAviso } from '../components/ui'
import { DESTINOS, SECOES, blocosDaPaginaPadrao, enderecoSeguro, novoBloco, resumoBloco } from '../lib/blocos'
import { enviarImagem } from '../lib/imagens'
import { useLoja } from '../lib/loja'
import { mensagemErro } from '../lib/supabase'
import type { Bloco, Destino, LarguraBloco, SecaoId, SiteConteudo, Tamanho3 } from '../lib/tipos'

const TAMANHOS: { valor: Tamanho3; rotulo: string }[] = [
  { valor: 'pequeno', rotulo: 'Pequeno' },
  { valor: 'medio', rotulo: 'Médio' },
  { valor: 'grande', rotulo: 'Grande' },
]
const LARGURAS: { valor: LarguraBloco; rotulo: string }[] = [
  { valor: 'inteira', rotulo: 'Largura toda' },
  { valor: 'metade', rotulo: 'Metade (dois lado a lado)' },
  { valor: 'terco', rotulo: 'Um terço (três lado a lado)' },
]
const TIPOS: Record<'texto' | 'imagem' | 'botao' | 'secao', { nome: string; icone: LucideIcon }> = {
  texto: { nome: 'Texto', icone: Type },
  imagem: { nome: 'Imagem ou banner', icone: IconeImagem },
  botao: { nome: 'Botão', icone: MousePointerClick },
  secao: { nome: 'Seção pronta', icone: LayoutTemplate },
}
const nomeDe = (b: Bloco) => (b.tipo === 'secao' ? SECOES[b.secao].nome : TIPOS[b.tipo].nome)

/** Botão de enviar uma imagem do computador ou do celular (a arte feita no Canva, por exemplo). */
export function EnviarImagem({ url, onChange, rotulo, grande }: { url: string | null; onChange: (url: string | null) => void; rotulo: string; grande?: boolean }) {
  const aviso = useAviso()
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3">
      {url && <img src={url} alt="" className={cx('rounded-lg border border-stone-200 object-contain', grande ? 'max-h-40 max-w-full' : 'h-16 max-w-40')} />}
      <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50">
        <ImagePlus className="size-4" /> {enviando ? 'Enviando…' : url ? 'Trocar imagem' : rotulo}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const arquivo = e.target.files?.[0]
            e.target.value = '' // deixa escolher o mesmo arquivo de novo
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

/** O que acontece ao tocar na imagem ou no botão. */
function CampoDestino({ rotulo, valor, onChange, obrigatorio }: { rotulo: string; valor: Destino; onChange: (d: Destino) => void; obrigatorio?: boolean }) {
  const { config, catalogo } = useLoja()
  const produtos = [...catalogo.produtos].sort((a, b) => a.nome.localeCompare(b.nome))
  const tipos = (Object.keys(DESTINOS) as Destino['tipo'][]).filter((t) => !obrigatorio || t !== 'nenhum')
  const falta =
    valor.tipo === 'whatsapp' && !config?.whatsapp
      ? 'O WhatsApp da loja ainda não foi cadastrado em Configurações → Loja.'
      : valor.tipo === 'instagram' && !config?.instagram
        ? 'O Instagram da loja ainda não foi cadastrado em Configurações → Loja.'
        : valor.tipo === 'link' && valor.valor?.trim() && !enderecoSeguro(valor.valor)
          ? 'Este endereço não parece válido. Copie do navegador, começando com https://'
          : ''
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo rotulo={rotulo} dica={valor.tipo === 'promocoes' ? 'Abre o cardápio mostrando só os produtos com promoção valendo naquele momento.' : undefined}>
        <Selecao value={valor.tipo} onChange={(e) => onChange({ tipo: e.target.value as Destino['tipo'] })}>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {DESTINOS[t]}
            </option>
          ))}
        </Selecao>
      </Campo>
      {valor.tipo === 'categoria' && (
        <Campo rotulo="Qual categoria?">
          <Selecao value={valor.valor ?? ''} onChange={(e) => onChange({ ...valor, valor: e.target.value })}>
            <option value="">Selecione…</option>
            {catalogo.categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      )}
      {valor.tipo === 'produto' && (
        <Campo rotulo="Qual produto?">
          <Selecao value={valor.valor ?? ''} onChange={(e) => onChange({ ...valor, valor: e.target.value })}>
            <option value="">Selecione…</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      )}
      {valor.tipo === 'link' && (
        <Campo rotulo="Endereço (link)">
          <Entrada inputMode="url" placeholder="https://…" value={valor.valor ?? ''} onChange={(e) => onChange({ ...valor, valor: e.target.value })} />
        </Campo>
      )}
      {falta && <p className="text-sm text-molho-700 sm:col-span-2">{falta}</p>}
    </div>
  )
}

/** Lista do que dá para colocar na página. As seções prontas que já estão nela não aparecem de novo. */
function MenuAdicionar({ usadas, aoEscolher }: { usadas: SecaoId[]; aoEscolher: (tipo: 'texto' | 'imagem' | 'botao' | SecaoId) => void }) {
  const opcao = 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold hover:border-molho-400 hover:text-molho-700'
  const secoes = (Object.keys(SECOES) as SecaoId[]).filter((s) => !usadas.includes(s))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(['texto', 'imagem', 'botao'] as const).map((t) => {
          const Icone = TIPOS[t].icone
          return (
            <button key={t} type="button" className={opcao} onClick={() => aoEscolher(t)}>
              <Icone className="size-4" /> {TIPOS[t].nome}
            </button>
          )
        })}
      </div>
      {secoes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-stone-500 uppercase">Seções prontas</span>
          {secoes.map((s) => (
            <button key={s} type="button" className={opcao} title={SECOES[s].descricao} onClick={() => aoEscolher(s)}>
              <LayoutTemplate className="size-4" /> {SECOES[s].nome}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A página inicial de verdade dentro de um quadro, recebendo o rascunho a cada mudança (mesmo antes de salvar). */
export function PreviaDaPagina({ conteudo }: { conteudo: SiteConteudo }) {
  const quadro = useRef<HTMLIFrameElement>(null)
  const moldura = useRef<HTMLDivElement>(null)
  const atual = useRef(conteudo)
  atual.current = conteudo
  const [tela, setTela] = useState<'celular' | 'computador'>('celular')
  const [largura, setLargura] = useState(390)

  const enviar = useCallback(() => quadro.current?.contentWindow?.postMessage({ tiace: 'previa', conteudo: atual.current }, location.origin), [])
  useEffect(() => {
    enviar()
  }, [conteudo, enviar])
  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.tiace === 'previa-pronta') enviar()
    }
    window.addEventListener('message', ouvir)
    return () => window.removeEventListener('message', ouvir)
  }, [enviar])
  useEffect(() => {
    const el = moldura.current
    if (!el) return
    const medir = new ResizeObserver(() => setLargura(el.clientWidth))
    medir.observe(el)
    return () => medir.disconnect()
  }, [])

  // a tela de computador (1280 px) é mostrada encolhida para caber; a de celular, no tamanho real
  const base = tela === 'celular' ? 390 : 1280
  const escala = Math.min(1, largura / base)
  const altura = 640
  const aba = (ativo: boolean) => cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold', ativo ? 'bg-forno-800 text-white' : 'text-forno-700 hover:bg-stone-100')
  return (
    <Cartao className="p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Como está ficando</h2>
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5">
          <button type="button" aria-pressed={tela === 'celular'} className={aba(tela === 'celular')} onClick={() => setTela('celular')}>
            <Smartphone className="size-4" /> Celular
          </button>
          <button type="button" aria-pressed={tela === 'computador'} className={aba(tela === 'computador')} onClick={() => setTela('computador')}>
            <Monitor className="size-4" /> Computador
          </button>
        </div>
      </div>
      <div ref={moldura} className="overflow-hidden rounded-xl border border-stone-200 bg-massa-50" style={{ height: altura }}>
        <iframe
          ref={quadro}
          title="Prévia da página inicial"
          src="/?previa=1"
          className="origin-top-left border-0"
          style={{ width: base, height: altura / escala, transform: `scale(${escala})`, marginLeft: Math.max(0, (largura - base * escala) / 2) }}
        />
      </div>
      <p className="mt-2 text-xs text-stone-500">A prévia mostra o que você está montando agora. O site só muda quando você salvar.</p>
    </Cartao>
  )
}

/** Montagem livre da página inicial: blocos que se arrastam, com texto, imagem, botão e as seções prontas. */
export function EditorBlocos({ conteudo, onChange }: { conteudo: SiteConteudo; onChange: (c: SiteConteudo) => void }) {
  const blocos = conteudo.blocos ?? []
  const [aberto, setAberto] = useState<string | null>(null)
  const [inserirEm, setInserirEm] = useState<number | null>(null)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const lista = useRef<HTMLOListElement>(null)
  const atuais = useRef(blocos)
  atuais.current = blocos

  const gravar = (novos: Bloco[]) => onChange({ ...conteudo, blocos: novos })
  const alterar = (id: string, valores: Partial<Bloco>) => gravar(blocos.map((b) => (b.id === id ? ({ ...b, ...valores } as Bloco) : b)))
  const mover = (de: number, para: number) => {
    const novos = [...atuais.current]
    const [b] = novos.splice(de, 1)
    novos.splice(para, 0, b)
    gravar(novos)
  }
  function inserir(tipo: 'texto' | 'imagem' | 'botao' | SecaoId, posicao: number) {
    const novo = novoBloco(tipo)
    gravar([...blocos.slice(0, posicao), novo, ...blocos.slice(posicao)])
    setAberto(novo.id)
    setInserirEm(null)
  }
  const usadas = blocos.filter((b) => b.tipo === 'secao').map((b) => (b as Extract<Bloco, { tipo: 'secao' }>).secao)

  // arrastar com o mouse ou com o dedo: o bloco troca de lugar na hora, conforme passa pelo meio dos vizinhos
  function aoPegar(e: PointerEvent<HTMLButtonElement>, id: string) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setAberto(null)
    setInserirEm(null)
    setArrastando(id)
  }
  function aoArrastar(e: PointerEvent<HTMLButtonElement>) {
    if (!arrastando || !lista.current) return
    const y = e.clientY
    // perto da borda a página acompanha (na hora, sem a rolagem suave do site, que atrasaria o arrasto)
    if (y < 90) window.scrollBy({ top: -14, behavior: 'instant' })
    else if (y > window.innerHeight - 90) window.scrollBy({ top: 14, behavior: 'instant' })
    const de = atuais.current.findIndex((b) => b.id === arrastando)
    let para = 0
    for (const li of lista.current.querySelectorAll<HTMLElement>(':scope > li[data-bloco]')) {
      if (li.dataset.bloco === arrastando) continue
      const r = li.getBoundingClientRect()
      if (y > r.top + r.height / 2) para++
    }
    if (de >= 0 && para !== de) mover(de, para)
  }

  const acao = 'grid size-9 shrink-0 place-items-center rounded-lg text-forno-700 hover:bg-stone-100 disabled:opacity-25'
  const linha = (rotulo: string, campo: ReactNode) => (
    <Campo rotulo={rotulo}>{campo}</Campo>
  )

  return (
    <Cartao className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">Blocos da página inicial</h2>
          <p className="text-sm text-stone-600">Arraste pelo ícone de pontinhos para mudar a ordem. Toque em um bloco para editar.</p>
        </div>
        <Botao
          variante="sutil"
          tamanho="p"
          onClick={() => {
            if (!blocos.length || confirm('Trocar todos os blocos pela página padrão de hoje? O que você montou aqui será substituído (só vale depois de salvar).')) {
              gravar(blocosDaPaginaPadrao(conteudo))
              setAberto(null)
            }
          }}
        >
          <RotateCcw className="size-4" /> Começar pela página padrão
        </Botao>
      </div>

      {blocos.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">A página está vazia. Adicione o primeiro bloco abaixo.</p>}

      <ol ref={lista} className="space-y-2">
        {blocos.map((b, i) => {
          const Icone = TIPOS[b.tipo].icone
          const editando = aberto === b.id && !arrastando
          return (
            <li key={b.id} data-bloco={b.id} className="space-y-2">
              {inserirEm === i ? (
                <div className="rounded-xl border border-dashed border-molho-300 bg-molho-50/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">Adicionar aqui</span>
                    <Botao variante="sutil" tamanho="p" onClick={() => setInserirEm(null)}>
                      Cancelar
                    </Botao>
                  </div>
                  <MenuAdicionar usadas={usadas} aoEscolher={(t) => inserir(t, i)} />
                </div>
              ) : (
                // durante o arrasto fica invisível mas continua ocupando o lugar: a lista não pode pular debaixo do dedo
                <button type="button" onClick={() => setInserirEm(i)} className={cx('mx-auto flex items-center gap-1 rounded-full px-2 text-xs font-semibold text-stone-400 hover:text-molho-700', arrastando && 'invisible')} aria-label={`Adicionar um bloco antes de ${nomeDe(b)}`}>
                  <Plus className="size-3.5" /> adicionar aqui
                </button>
              )}
              <div className={cx('rounded-xl border bg-white', arrastando === b.id ? 'border-molho-500 shadow-lg ring-2 ring-molho-200' : 'border-stone-200', !b.ativo && 'bg-stone-50')}>
                <div className="flex items-center gap-1 p-1.5">
                  <button
                    type="button"
                    aria-label={`Arrastar ${nomeDe(b)}`}
                    title="Segure e arraste para mudar de lugar"
                    className={cx(acao, 'cursor-grab touch-none text-stone-400 active:cursor-grabbing')}
                    onPointerDown={(e) => aoPegar(e, b.id)}
                    onPointerMove={aoArrastar}
                    onPointerUp={() => setArrastando(null)}
                    onPointerCancel={() => setArrastando(null)}
                  >
                    <GripVertical className="size-5" />
                  </button>
                  <button type="button" aria-expanded={editando} onClick={() => setAberto(editando ? null : b.id)} className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1 text-left hover:bg-stone-50', !b.ativo && 'opacity-60')}>
                    {b.tipo === 'imagem' && b.imagem_url ? (
                      <img src={b.imagem_url} alt="" className="h-10 w-14 shrink-0 rounded-md border border-stone-200 object-cover" />
                    ) : (
                      <span className="grid h-10 w-14 shrink-0 place-items-center rounded-md bg-stone-100 text-forno-700">
                        <Icone className="size-5" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {nomeDe(b)} {!b.ativo && <span className="text-xs font-normal text-stone-500">(escondido)</span>}
                      </span>
                      <span className="block truncate text-xs text-stone-500">{resumoBloco(b)}</span>
                    </span>
                  </button>
                  <button type="button" className={acao} aria-label={b.ativo ? `Esconder ${nomeDe(b)}` : `Mostrar ${nomeDe(b)}`} title={b.ativo ? 'Esconder do site' : 'Mostrar no site'} onClick={() => alterar(b.id, { ativo: !b.ativo })}>
                    {b.ativo ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                  <button type="button" className={acao} aria-label={`Subir ${nomeDe(b)}`} disabled={i === 0} onClick={() => mover(i, i - 1)}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" className={acao} aria-label={`Descer ${nomeDe(b)}`} disabled={i === blocos.length - 1} onClick={() => mover(i, i + 1)}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" className={cx(acao, 'text-red-600')} aria-label={`Excluir ${nomeDe(b)}`} onClick={() => gravar(blocos.filter((x) => x.id !== b.id))}>
                    <Trash2 className="size-4" />
                  </button>
                </div>

                {editando && (
                  <div className="space-y-4 border-t border-stone-200 p-4">
                    {b.tipo === 'texto' && (
                      <>
                        {linha('Título (opcional)', <Entrada maxLength={120} value={b.titulo} onChange={(e) => alterar(b.id, { titulo: e.target.value })} />)}
                        {linha('Texto', <AreaTexto rows={4} maxLength={1500} value={b.texto} onChange={(e) => alterar(b.id, { texto: e.target.value })} />)}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Campo rotulo="Alinhamento">
                            <Selecao value={b.alinhamento} onChange={(e) => alterar(b.id, { alinhamento: e.target.value as 'esquerda' | 'centro' })}>
                              <option value="esquerda">À esquerda</option>
                              <option value="centro">Centralizado</option>
                            </Selecao>
                          </Campo>
                          <Campo rotulo="Fundo">
                            <Selecao value={b.fundo} onChange={(e) => alterar(b.id, { fundo: e.target.value as 'nenhum' | 'claro' | 'escuro' | 'destaque' })}>
                              <option value="nenhum">Sem fundo</option>
                              <option value="claro">Caixa clara</option>
                              <option value="escuro">Caixa escura</option>
                              <option value="destaque">Caixa amarela</option>
                            </Selecao>
                          </Campo>
                        </div>
                      </>
                    )}
                    {b.tipo === 'imagem' && (
                      <>
                        <Campo rotulo="Imagem" dica="Envie a arte pronta (do Canva, por exemplo). Para a largura toda, o ideal é uma imagem deitada, com cerca de 1600 pixels de largura.">
                          <EnviarImagem grande url={b.imagem_url} onChange={(imagem_url) => alterar(b.id, { imagem_url })} rotulo="Enviar imagem" />
                        </Campo>
                        <CampoDestino rotulo="Ao tocar na imagem" valor={b.destino} onChange={(destino) => alterar(b.id, { destino })} />
                        <Campo rotulo="O que a imagem mostra (opcional)" dica="Uma frase curta. É lida em voz alta para quem não enxerga e ajuda o Google a entender a imagem.">
                          <Entrada maxLength={140} placeholder="Ex.: Promoção de terça: pizza grande por R$ 49,90" value={b.descricao} onChange={(e) => alterar(b.id, { descricao: e.target.value })} />
                        </Campo>
                      </>
                    )}
                    {b.tipo === 'botao' && (
                      <>
                        {linha('Texto do botão', <Entrada maxLength={40} value={b.texto} onChange={(e) => alterar(b.id, { texto: e.target.value })} />)}
                        <CampoDestino obrigatorio rotulo="Ao tocar no botão" valor={b.destino} onChange={(destino) => alterar(b.id, { destino })} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Campo rotulo="Cor">
                            <Selecao value={b.estilo} onChange={(e) => alterar(b.id, { estilo: e.target.value as 'principal' | 'claro' | 'whatsapp' })}>
                              <option value="principal">Vermelho (principal)</option>
                              <option value="claro">Branco com borda</option>
                              <option value="whatsapp">Verde, com o ícone de conversa</option>
                            </Selecao>
                          </Campo>
                          <Campo rotulo="Alinhamento">
                            <Selecao value={b.alinhamento} onChange={(e) => alterar(b.id, { alinhamento: e.target.value as 'esquerda' | 'centro' })}>
                              <option value="centro">Centralizado</option>
                              <option value="esquerda">À esquerda</option>
                            </Selecao>
                          </Campo>
                        </div>
                      </>
                    )}
                    {b.tipo === 'secao' ? (
                      <>
                        <p className="text-sm text-stone-600">
                          {SECOES[b.secao].descricao}.{' '}
                          {b.secao === 'banners'
                            ? 'Os banners são cadastrados na aba Banners.'
                            : b.secao === 'promocoes'
                              ? 'As promoções são criadas na aba Promoções.'
                              : b.secao === 'destaques'
                                ? 'Os destaques são marcados em cada produto, no Cardápio.'
                                : 'Os textos ficam mais abaixo, em “Textos da capa e das seções prontas”.'}
                        </p>
                        <Campo rotulo="Tamanho" className="max-w-xs">
                          <Selecao value={b.tamanho} onChange={(e) => alterar(b.id, { tamanho: e.target.value as Tamanho3 })}>
                            {TAMANHOS.map((t) => (
                              <option key={t.valor} value={t.valor}>
                                {t.rotulo}
                              </option>
                            ))}
                          </Selecao>
                        </Campo>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <Campo rotulo="Largura no computador" dica={b.tipo === 'imagem' ? 'No celular, as imagens que não ocupam a largura toda ficam duas por linha.' : 'No celular, fica sempre na largura toda.'} className="max-w-xs">
                          <Selecao value={b.largura} onChange={(e) => alterar(b.id, { largura: e.target.value as LarguraBloco })}>
                            {LARGURAS.map((l) => (
                              <option key={l.valor} value={l.valor}>
                                {l.rotulo}
                              </option>
                            ))}
                          </Selecao>
                        </Campo>
                        <Botao
                          variante="secundario"
                          onClick={() => {
                            const copia = { ...b, id: crypto.randomUUID() }
                            gravar([...blocos.slice(0, i + 1), copia, ...blocos.slice(i + 1)])
                            setAberto(copia.id)
                          }}
                        >
                          <Copy className="size-4" /> Duplicar
                        </Botao>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="rounded-xl border border-dashed border-stone-300 p-3">
        <p className="mb-2 text-sm font-semibold">Adicionar no fim da página</p>
        <MenuAdicionar usadas={usadas} aoEscolher={(t) => inserir(t, blocos.length)} />
      </div>
    </Cartao>
  )
}
