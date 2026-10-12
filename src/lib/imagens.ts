import { supabase } from './supabase'

const LADO_MAXIMO = 1920 // pixels: mais que isso não aparece melhor em nenhuma tela e só deixa o site lento
const LIMITE_ENVIO = 3 * 1024 * 1024
const LIMITE_ORIGINAL = 25 * 1024 * 1024

/**
 * Fotos de celular e artes exportadas do Canva chegam com vários megabytes. Antes de enviar, a imagem é
 * reduzida para no máximo 1920 pixels e regravada em WebP (mantém a transparência). GIF e SVG seguem como estão.
 */
async function otimizar(arquivo: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return arquivo
  try {
    const imagem = await createImageBitmap(arquivo)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height))
    if (escala === 1 && arquivo.size <= 300 * 1024) return arquivo
    const tela = document.createElement('canvas')
    tela.width = Math.round(imagem.width * escala)
    tela.height = Math.round(imagem.height * escala)
    tela.getContext('2d')!.drawImage(imagem, 0, 0, tela.width, tela.height)
    const blob = await new Promise<Blob | null>((pronto) => tela.toBlob(pronto, 'image/webp', 0.86))
    // navegador que não grava WebP devolve PNG: nesse caso (ou se não ficou menor) vale o arquivo original
    if (!blob || blob.type !== 'image/webp' || blob.size >= arquivo.size) return arquivo
    return new File([blob], `${arquivo.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' })
  } catch {
    return arquivo
  }
}

/** Envia uma imagem para o armazenamento de fotos e devolve o endereço público. */
export async function enviarImagem(original: File): Promise<string> {
  if (!original.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WebP).')
  if (original.size > LIMITE_ORIGINAL) throw new Error('Esta imagem é grande demais. Exporte com tamanho menor (no Canva, até 1920 de largura) e tente de novo.')
  const arquivo = await otimizar(original)
  if (arquivo.size > LIMITE_ENVIO) throw new Error('A imagem deve ter no máximo 3 MB. Exporte em JPG ou com tamanho menor e tente de novo.')
  const caminho = `${crypto.randomUUID()}.${arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`
  const { error } = await supabase.storage.from('produtos').upload(caminho, arquivo, { cacheControl: '31536000', contentType: arquivo.type })
  if (error) throw error
  return supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl
}
