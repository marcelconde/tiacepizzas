// Avisa o motoboy, no aplicativo Tia Cê Entregas, que um pedido dele está pronto para retirar.
// O painel chama esta função quando marca o pedido como pronto ou escolhe o motoboy de um pedido pronto.
// O aviso sai pelo Firebase Cloud Messaging; a chave da conta de serviço fica no segredo FIREBASE_CONTA
// (o arquivo JSON inteiro), nunca no código nem no navegador.
import { createClient } from 'npm:@supabase/supabase-js@2'

// todos os cabeçalhos que a biblioteca do Supabase envia: faltando um, o navegador barra a chamada antes de ela chegar aqui
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const base64url = (dados: Uint8Array | string) =>
  btoa(typeof dados === 'string' ? dados : String.fromCharCode(...dados)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Troca a chave da conta de serviço por um acesso temporário ao Firebase. */
async function acessoFirebase(conta: { client_email: string; private_key: string }) {
  const agora = Math.floor(Date.now() / 1000)
  const pedido = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({
      iss: conta.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 600,
    }),
  )}`
  const der = Uint8Array.from(atob(conta.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0))
  const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const assinatura = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(pedido)))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${pedido}.${base64url(assinatura)}` }),
  })
  const resposta = await r.json()
  if (!r.ok || !resposta.access_token) throw new Error(`O Firebase recusou a chave da conta de serviço (${resposta.error_description ?? resposta.error ?? r.status}).`)
  return resposta.access_token as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    const { data: usuario } = await admin.auth.getUser(jwt)
    if (!usuario?.user) return json({ erro: 'Sessão inválida. Entre novamente.' }, 401)
    const { data: perfil } = await admin.from('perfis').select('ativo, papel').eq('id', usuario.user.id).maybeSingle()
    if (!perfil?.ativo || perfil.papel === 'motoboy') return json({ erro: 'Acesso negado' }, 403)

    const { pedido_id } = await req.json()
    if (typeof pedido_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(pedido_id)) return json({ erro: 'Pedido inválido' }, 400)

    // só avisa o que é verdade agora: pedido de entrega, pronto e com motoboy escolhido
    const { data: pedido } = await admin.from('pedidos').select('numero, status, tipo, entregador_id').eq('id', pedido_id).maybeSingle()
    if (!pedido || pedido.tipo !== 'entrega' || pedido.status !== 'pronto' || !pedido.entregador_id) return json({ avisados: 0 })
    const { data: aparelhos } = await admin.from('entregador_aparelhos').select('token').eq('entregador_id', pedido.entregador_id)
    if (!aparelhos?.length) return json({ avisados: 0, motivo: 'O motoboy ainda não entrou no aplicativo neste celular.' })

    const segredo = Deno.env.get('FIREBASE_CONTA')
    if (!segredo) return json({ avisados: 0, motivo: 'O Firebase ainda não foi configurado (segredo FIREBASE_CONTA).' })
    const conta = JSON.parse(segredo)
    const acesso = await acessoFirebase(conta)

    let avisados = 0
    const falhas: string[] = []
    for (const { token } of aparelhos) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${conta.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: `Pedido #${pedido.numero} está pronto`, body: 'Pode retirar na pizzaria.' },
            data: { pedido_id },
            // "tag" faz um aviso repetido do mesmo pedido substituir o anterior, em vez de empilhar
            android: { priority: 'HIGH', ttl: '900s', notification: { channel_id: 'pedidos', sound: 'default', tag: `pedido-${pedido_id}` } },
          },
        }),
      })
      if (r.ok) avisados++
      else {
        // 404: o aplicativo foi desinstalado ou o aparelho trocou de endereço — esse registro não serve mais
        if (r.status === 404) await admin.from('entregador_aparelhos').delete().eq('token', token)
        falhas.push(`${r.status} ${(await r.text()).slice(0, 200)}`)
      }
    }
    return json({ avisados, ...(falhas.length ? { falhas } : {}) })
  } catch (e) {
    return json({ erro: (e as Error).message ?? 'Erro inesperado' }, 500)
  }
})
