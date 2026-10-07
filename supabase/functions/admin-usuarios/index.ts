// Criação de usuários do painel. Só administradores ativos podem chamar.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const PAPEIS = ['admin', 'atendente', 'cozinha']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    const { data: usuario } = await admin.auth.getUser(jwt)
    if (!usuario?.user) return json({ erro: 'Sessão inválida. Entre novamente.' }, 401)
    const { data: perfil } = await admin.from('perfis').select('ativo, papel').eq('id', usuario.user.id).maybeSingle()
    if (!perfil?.ativo || perfil.papel !== 'admin') return json({ erro: 'Apenas administradores podem criar usuários.' }, 403)

    const { acao, nome, email, senha, papel } = await req.json()
    if (acao !== 'criar') return json({ erro: 'Ação desconhecida' }, 400)
    if (!nome?.trim() || !email?.trim()) return json({ erro: 'Informe nome e e-mail.' }, 400)
    if (typeof senha !== 'string' || senha.length < 8) return json({ erro: 'A senha deve ter ao menos 8 caracteres.' }, 400)
    if (!PAPEIS.includes(papel)) return json({ erro: 'Função inválida.' }, 400)

    // papel e liberação vão em app_metadata, que só o servidor grava; o gatilho do banco cria o perfil
    const { data, error } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome: nome.trim() },
      app_metadata: { papel, ativo: true },
    })
    if (error) {
      const repetido = /already.*registered|already exists/i.test(error.message)
      return json({ erro: repetido ? 'Já existe um usuário com este e-mail.' : error.message }, 400)
    }
    return json({ id: data.user.id })
  } catch (e) {
    return json({ erro: (e as Error).message ?? 'Erro inesperado' }, 500)
  }
})
