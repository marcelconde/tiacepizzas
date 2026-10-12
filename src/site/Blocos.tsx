import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { cx } from '../components/ui'
import { DESTINOS, resolverDestino, type Caminho } from '../lib/blocos'
import { useLoja } from '../lib/loja'
import type { Bloco, BlocoSecao, Produto, SiteConteudo } from '../lib/tipos'
import { Secao } from './Secoes'

type BlocoLivre = Exclude<Bloco, BlocoSecao>

// No celular a grade tem 2 colunas e no computador 6: imagens estreitas ficam lado a lado até no celular;
// textos e botões estreitos só dividem a linha no computador.
const largura = (b: BlocoLivre) =>
  b.largura === 'inteira'
    ? 'col-span-2 md:col-span-6'
    : cx(b.tipo === 'imagem' ? 'col-span-1' : 'col-span-2', b.largura === 'metade' ? 'md:col-span-3' : 'md:col-span-2')

const FUNDOS = {
  nenhum: '',
  claro: 'rounded-2xl border border-massa-200 bg-massa-100 p-6',
  escuro: 'rounded-2xl bg-forno-900 p-6 text-massa-50',
  destaque: 'rounded-2xl bg-queijo-400 p-6 text-forno-900',
}
const BOTOES = {
  principal: 'bg-molho-600 text-white hover:bg-molho-700',
  claro: 'border border-stone-300 bg-white text-forno-900 hover:bg-stone-50',
  whatsapp: 'bg-manjericao-600 text-white hover:bg-manjericao-700',
}

/** Envolve o conteúdo com o tipo certo de link: página do site, endereço de fora ou a janela de um produto. */
function Clicavel({ caminho, aoAbrir, className, rotulo, children }: { caminho: Caminho; aoAbrir: (p: Produto) => void; className?: string; rotulo?: string; children: ReactNode }) {
  if (!caminho) return <div className={className}>{children}</div>
  if ('interno' in caminho) return <Link to={caminho.interno} aria-label={rotulo} className={className}>{children}</Link>
  if ('externo' in caminho) return <a href={caminho.externo} target="_blank" rel="noreferrer" aria-label={rotulo} className={className}>{children}</a>
  return <button type="button" aria-label={rotulo} onClick={() => aoAbrir(caminho.produto)} className={cx('text-left', className)}>{children}</button>
}

/**
 * Página inicial montada em blocos (Site e promoções → Página inicial → Livre).
 * As seções prontas ocupam a largura toda; os outros blocos se encaixam lado a lado conforme a largura de cada um.
 */
export function PaginaBlocos({ conteudo, aoAbrir }: { conteudo: SiteConteudo; aoAbrir: (p: Produto) => void }) {
  const { config, catalogo } = useLoja()

  const bloco = (b: BlocoLivre) => {
    if (b.tipo === 'texto') {
      if (!b.titulo.trim() && !b.texto.trim()) return null
      return (
        <div key={b.id} className={cx(largura(b), FUNDOS[b.fundo], b.alinhamento === 'centro' && 'text-center')}>
          {b.titulo.trim() && <h2 className="font-display text-2xl font-bold text-balance md:text-3xl">{b.titulo}</h2>}
          {b.texto.trim() && <p className={cx('text-base leading-relaxed whitespace-pre-line', b.titulo.trim() && 'mt-2', b.fundo === 'nenhum' && 'text-forno-700')}>{b.texto}</p>}
        </div>
      )
    }
    const caminho = resolverDestino(b.destino, config, catalogo)
    if (b.tipo === 'imagem') {
      if (!b.imagem_url) return null
      return (
        <Clicavel
          key={b.id}
          caminho={caminho}
          aoAbrir={aoAbrir}
          rotulo={b.descricao || DESTINOS[b.destino.tipo]}
          className={cx(largura(b), 'block overflow-hidden rounded-2xl', caminho && 'transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-molho-500 focus-visible:outline-none')}
        >
          <img src={b.imagem_url} alt={b.descricao} loading="lazy" className="block w-full" />
        </Clicavel>
      )
    }
    // botão sem texto ou que não leva a lugar nenhum não aparece
    if (!b.texto.trim() || !caminho) return null
    return (
      <div key={b.id} className={cx(largura(b), 'flex', b.alinhamento === 'centro' ? 'justify-center' : 'justify-start')}>
        <Clicavel caminho={caminho} aoAbrir={aoAbrir} className={cx('inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-center text-base font-semibold transition-colors sm:w-auto', BOTOES[b.estilo])}>
          {b.estilo === 'whatsapp' && <MessageCircle className="size-5 shrink-0" />}
          {b.texto}
        </Clicavel>
      </div>
    )
  }

  const grupos: (BlocoSecao | BlocoLivre[])[] = []
  for (const b of (conteudo.blocos ?? []).filter((x) => x.ativo)) {
    const ultimo = grupos[grupos.length - 1]
    if (b.tipo === 'secao') grupos.push(b)
    else if (Array.isArray(ultimo)) ultimo.push(b)
    else grupos.push([b])
  }

  return (
    <>
      {grupos.map((g) =>
        Array.isArray(g) ? (
          <div key={g[0].id} className="mx-auto grid max-w-6xl grid-cols-2 items-start gap-4 px-4 py-5 md:grid-cols-6">
            {g.map(bloco)}
          </div>
        ) : (
          <Secao key={g.id} id={g.secao} tamanho={g.tamanho} conteudo={conteudo} aoAbrir={aoAbrir} todosOsBanners />
        ),
      )}
    </>
  )
}
