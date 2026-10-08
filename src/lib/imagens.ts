import { supabase } from './supabase'

/** Envia uma imagem para o armazenamento de fotos e devolve o endereço público. */
export async function enviarImagem(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.')
  if (arquivo.size > 3 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 3 MB.')
  const caminho = `${crypto.randomUUID()}.${arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`
  const { error } = await supabase.storage.from('produtos').upload(caminho, arquivo, { cacheControl: '31536000' })
  if (error) throw error
  return supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl
}
