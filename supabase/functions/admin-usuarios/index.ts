// Criação de usuários do painel. Só administradores ativos podem chamar.
import { createClient } from 'npm:@supabase/supabase-js@2'

// todos os cabeçalhos que a biblioteca do Supabase envia: faltando um, o navegador barra a chamada antes de ela chegar aqui
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const PAPEIS = ['admin', 'financeiro', 'atendente', 'cozinha', 'motoboy']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    const { data: usuario } = await admin.auth.getUser(jwt)
    if (!usuario?.user) return json({ erro: 'Sessão inválida. Entre novamente.' }, 401)
    const { data: perfil } = await admin.from('perfis').select('ativo, papel').eq('id', usuario.user.id).maybeSingle()
    if (!perfil?.ativo || perfil.papel !== 'admin') return json({ erro: 'Apenas administradores podem criar usuários.' }, 403)

    const { acao, nome, email, senha, papel, entregador_id } = await req.json()
    if (acao !== 'criar') return json({ erro: 'Ação desconhecida' }, 400)
    if (!nome?.trim() || !email?.trim()) return json({ erro: 'Informe nome e e-mail.' }, 400)
    if (typeof senha !== 'string' || senha.length < 8) return json({ erro: 'A senha deve ter ao menos 8 caracteres.' }, 400)
    if (!PAPEIS.includes(papel)) return json({ erro: 'Função inválida.' }, 400)
    // motoboy que já está cadastrado em Entregas: o login é ligado a esse cadastro, em vez de criar outro
    const entregador = papel === 'motoboy' && typeof entregador_id === 'string' && /^[0-9a-f-]{36}$/i.test(entregador_id) ? entregador_id : null

    // papel e liberação vão em app_metadata, que só o servidor grava. O Supabase cria o usuário e grava o
    // app_metadata em seguida; o gatilho do banco cria o perfil nesse momento (e, para motoboy, o cadastro
    // de entregador ligado ao login)
    const { data, error } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome: nome.trim() },
      app_metadata: { papel, ativo: true, ...(entregador ? { entregador_id: entregador } : {}) },
    })
    if (error) {
      const repetido = /already.*registered|already exists/i.test(error.message)
      const banco = /database error/i.test(error.message)
      return json({ erro: repetido ? 'Já existe um usuário com este e-mail.' : banco ? 'O banco de dados recusou o cadastro. Tente de novo; se continuar, avise o suporte.' : error.message }, 400)
    }
    // confere se o perfil nasceu: sem ele a pessoa entraria e veria "acesso restrito"
    const { data: criado } = await admin.from('perfis').select('id').eq('id', data.user.id).maybeSingle()
    if (!criado) {
      await admin.auth.admin.deleteUser(data.user.id)
      return json({ erro: 'Não foi possível concluir o cadastro do usuário. Tente de novo.' }, 500)
    }
    return json({ id: data.user.id })
  } catch (e) {
    return json({ erro: (e as Error).message ?? 'Erro inesperado' }, 500)
  }
})
