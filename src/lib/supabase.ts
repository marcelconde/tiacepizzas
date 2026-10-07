import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && chave)

export const supabase = createClient(url || 'https://nao-configurado.supabase.co', chave || 'nao-configurado')

/** Converte os erros do banco em mensagens legíveis para quem está usando. */
export function mensagemErro(erro: unknown): string {
  const msg = (erro as { message?: string })?.message ?? String(erro)
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão. Verifique a internet e tente de novo.'
  if (/violates foreign key/i.test(msg)) return 'Este registro está em uso e não pode ser excluído. Desative-o em vez de excluir.'
  if (/duplicate key/i.test(msg)) return 'Já existe um registro com esses dados.'
  if (/row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para fazer isso.'
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  return msg
}
