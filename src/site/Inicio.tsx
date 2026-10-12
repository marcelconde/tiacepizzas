import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Banners } from '../components/Banners'
import { MontarItem } from '../components/MontarItem'
import { useCarrinho } from '../lib/carrinho'
import { bannersEm, useLoja } from '../lib/loja'
import type { Produto, SiteConteudo } from '../lib/tipos'
import { PaginaBlocos } from './Blocos'
import { Secao } from './Secoes'

/**
 * A tela de edição do painel mostra a página inicial dentro de um quadro (endereço com "?previa") e envia
 * para cá o rascunho, ainda não salvo. Só vale dentro de um quadro e para mensagens do próprio site.
 */
function usePrevia(): SiteConteudo | null {
  const [params] = useSearchParams()
  const ativa = params.has('previa') && window.parent !== window
  const [rascunho, setRascunho] = useState<SiteConteudo | null>(null)
  useEffect(() => {
    if (!ativa) return
    const ouvir = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.tiace === 'previa') setRascunho(e.data.conteudo as SiteConteudo)
    }
    window.addEventListener('message', ouvir)
    window.parent.postMessage({ tiace: 'previa-pronta' }, location.origin)
    return () => window.removeEventListener('message', ouvir)
  }, [ativa])
  return ativa ? rascunho : null
}

/** Página inicial: as seções prontas na ordem escolhida no painel ou, no modo livre, os blocos montados lá. */
export default function Inicio() {
  const { conteudo: salvo, catalogo } = useLoja()
  const { adicionar } = useCarrinho()
  const [montando, setMontando] = useState<Produto | null>(null)
  const conteudo = usePrevia() ?? salvo
  if (!conteudo) return null

  const topo = bannersEm(catalogo, 'inicio_topo')
  return (
    <>
      {conteudo.modo === 'blocos' ? (
        <PaginaBlocos conteudo={conteudo} aoAbrir={setMontando} />
      ) : (
        <>
          {topo.length > 0 && <div className="mx-auto max-w-6xl px-4 pt-4"><Banners itens={topo} /></div>}
          {conteudo.secoes.filter((s) => s.ativo).map((s) => <Secao key={s.id} id={s.id} tamanho={s.tamanho} conteudo={conteudo} aoAbrir={setMontando} />)}
        </>
      )}
      <MontarItem produto={montando} onFechar={() => setMontando(null)} onAdicionar={adicionar} />
    </>
  )
}
