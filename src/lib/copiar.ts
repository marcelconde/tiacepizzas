/**
 * Copia um texto para a área de transferência. Tenta o jeito atual do navegador e, se ele recusar (permissão,
 * janela sem foco, navegador antigo), o jeito antigo, com um campo escondido. Devolve se deu certo.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const campo = document.createElement('textarea')
    campo.value = texto
    campo.setAttribute('readonly', '')
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      campo.remove()
    }
  }
}
