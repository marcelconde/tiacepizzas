import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// As telas do painel são baixadas só quando abertas. Depois de uma publicação, os arquivos antigos deixam de existir
// e quem estava com o painel aberto ficaria com a tela em branco ao trocar de aba: recarrega para pegar os novos.
// Uma vez a cada 30 s no máximo, para não entrar em ciclo se o arquivo faltar de verdade.
window.addEventListener('vite:preloadError', (e) => {
  const CHAVE = 'tiace.recarregou-em'
  let ultima = 0
  try {
    ultima = Number(sessionStorage.getItem(CHAVE) ?? 0)
  } catch {
    /* sem armazenamento: recarrega mesmo assim */
  }
  if (Date.now() - ultima < 30_000) return
  e.preventDefault()
  try {
    sessionStorage.setItem(CHAVE, String(Date.now()))
  } catch {
    /* idem */
  }
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
