import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && chave)

// O link de "esqueci a senha" chega com "type=recovery" no endereço. O Supabase apaga isso logo ao iniciar,
// antes de as telas existirem; por isso fica anotado aqui para a tela certa abrir a troca de senha.
export const recuperacao = { pendente: typeof location !== 'undefined' && /[#&]type=recovery/.test(location.hash) }

export const supabase = createClient(url || 'https://nao-configurado.supabase.co', chave || 'nao-configurado')

/** Converte os erros do banco em mensagens legíveis para quem está usando. */
export function mensagemErro(erro: unknown): string {
  const msg = (erro as { message?: string })?.message ?? String(erro)
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão. Verifique a internet e tente de novo.'
  if (/violates foreign key/i.test(msg)) return 'Este registro está em uso e não pode ser excluído. Desative-o em vez de excluir.'
  if (/duplicate key/i.test(msg)) return 'Já existe um registro com esses dados.'
  if (/row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para fazer isso.'
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/already registered|already been registered|user_already_exists/i.test(msg)) return 'Já existe uma conta com este e-mail. Entre com a sua senha ou use “Esqueci a senha”.'
  if (/password should be|weak.?password/i.test(msg)) return 'A senha precisa ter pelo menos 8 caracteres.'
  if (/signups? not allowed|signup.*disabled/i.test(msg)) return 'A criação de conta está desligada no momento.'
  if (/rate limit|too many requests|only request this after/i.test(msg)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.'
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'Esta forma de entrar ainda não está ligada.'
  if (/email not confirmed/i.test(msg)) return 'Confirme o seu e-mail pelo link que enviamos antes de entrar.'
  if (/unable to validate email|invalid email|email address .* is invalid/i.test(msg)) return 'Confira o e-mail digitado.'
  if (/database error/i.test(msg)) return 'Não foi possível concluir o cadastro agora. Tente de novo em instantes.'
  return msg
}

/** Quais entradas com rede social estão de fato ligadas no servidor (o painel pode oferecer um botão que ainda não funciona). */
let provedores: Promise<{ google: boolean; facebook: boolean } | null> | null = null
export function provedoresDeLogin() {
  provedores ??= fetch(`${url}/auth/v1/settings`, { headers: { apikey: chave ?? '' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => (r?.external ? { google: Boolean(r.external.google), facebook: Boolean(r.external.facebook) } : null))
    .catch(() => null)
  return provedores
}
