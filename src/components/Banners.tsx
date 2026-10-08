import { Link } from 'react-router-dom'
import type { Banner } from '../lib/tipos'
import { cx } from './ui'

const CORES = {
  molho: 'bg-molho-600 text-white',
  forno: 'bg-forno-800 text-massa-50',
  queijo: 'bg-queijo-400 text-forno-900',
  manjericao: 'bg-manjericao-600 text-white',
}
const TAMANHOS = {
  pequeno: { caixa: 'px-5 py-4', titulo: 'text-lg', sub: 'text-sm' },
  medio: { caixa: 'px-6 py-8', titulo: 'text-2xl md:text-3xl', sub: 'text-base' },
  grande: { caixa: 'px-6 py-14 md:px-10', titulo: 'text-3xl md:text-5xl', sub: 'text-lg' },
}

/** Banners cadastrados no painel (Conteúdo → Banners) para uma posição do site. */
export function Banners({ itens, className }: { itens: Banner[]; className?: string }) {
  if (!itens.length) return null
  return (
    <div className={cx('grid gap-3', itens.length > 1 && 'md:grid-cols-2', className)}>
      {itens.map((b) => {
        const t = TAMANHOS[b.tamanho]
        const conteudo = (
          <div
            className={cx('relative flex h-full flex-col justify-center overflow-hidden rounded-2xl', t.caixa, CORES[b.cor])}
            style={b.imagem_url ? { backgroundImage: `linear-gradient(90deg, rgb(38 25 18 / .75), rgb(38 25 18 / .25)), url(${b.imagem_url})`, backgroundSize: 'cover', backgroundPosition: 'center', color: '#fff' } : undefined}
          >
            <p className={cx('font-display leading-tight font-bold text-balance', t.titulo)}>{b.titulo}</p>
            {b.subtitulo && <p className={cx('mt-1 opacity-90', t.sub)}>{b.subtitulo}</p>}
            {b.botao && <span className="mt-4 inline-flex h-10 w-fit items-center rounded-lg bg-white px-4 text-sm font-semibold text-forno-900">{b.botao}</span>}
          </div>
        )
        if (!b.link) return <div key={b.id}>{conteudo}</div>
        return b.link.startsWith('/') ? (
          <Link key={b.id} to={b.link} className="block transition-opacity hover:opacity-95">
            {conteudo}
          </Link>
        ) : (
          <a key={b.id} href={b.link} target="_blank" rel="noreferrer" className="block transition-opacity hover:opacity-95">
            {conteudo}
          </a>
        )
      })}
    </div>
  )
}
