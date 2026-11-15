// Lê um pedido que chegou pelo WhatsApp (texto copiado e/ou prints) e devolve o pedido montado com o cardápio,
// para a atendente conferir no Novo pedido. Quem lê é o Claude (Anthropic); a chave fica só nos segredos do
// Supabase (ANTHROPIC_API_KEY). Só a equipe com acesso a Pedidos pode chamar.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.8.0/helpers/zod'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4'
import { INSTRUCOES, cardapioParaIA, montarPedido, type Cardapio } from './montar.ts'

// todos os cabeçalhos que a biblioteca do Supabase envia: faltando um, o navegador barra a chamada antes de ela chegar aqui
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const texto = z.string().nullable()
const PedidoDaConversa = z.object({
  cliente: z.object({ nome: texto, telefone: texto }),
  tipo: z.enum(['entrega', 'retirada']).nullable(),
  endereco: z.object({ cep: texto, logradouro: texto, numero: texto, complemento: texto, bairro: texto, referencia: texto }),
  itens: z.array(
    z.object({
      produto: z.string(),
      tamanho: texto,
      sabores: z.array(z.string()),
      adicionais: z.array(z.string()),
      quantidade: z.number().int(),
      observacoes: texto,
      como_o_cliente_pediu: z.string(),
    }),
  ),
  forma_pagamento: z.enum(['pix', 'dinheiro', 'credito', 'debito', 'vale_refeicao']).nullable(),
  troco_para: z.number().nullable(),
  observacoes: texto,
  duvidas: z.array(z.string()),
})

const TIPOS_DE_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    const { data: usuario } = await admin.auth.getUser(jwt)
    if (!usuario?.user) return json({ erro: 'Sessão inválida. Entre novamente.' }, 401)
    const { data: perfil } = await admin.from('perfis').select('ativo, papel').eq('id', usuario.user.id).maybeSingle()
    const { data: permissao } = perfil ? await admin.from('permissoes').select('modulo').eq('papel', perfil.papel).eq('modulo', 'pedidos').maybeSingle() : { data: null }
    if (!perfil?.ativo || (perfil.papel !== 'admin' && !permissao)) return json({ erro: 'Só quem cuida dos pedidos pode usar a leitura do WhatsApp.' }, 403)

    const chave = Deno.env.get('ANTHROPIC_API_KEY')
    if (!chave) return json({ erro: 'A leitura com IA ainda não foi ligada: falta a chave ANTHROPIC_API_KEY nos segredos do Supabase.' }, 503)

    const corpo = await req.json()
    const conversa = typeof corpo.texto === 'string' ? corpo.texto.trim().slice(0, 20000) : ''
    const imagens = (Array.isArray(corpo.imagens) ? corpo.imagens : [])
      .filter((i: { tipo?: string; base64?: string }) => TIPOS_DE_IMAGEM.includes(i?.tipo as TipoDeImagem) && typeof i.base64 === 'string' && i.base64.length < 6_000_000)
      .slice(0, 4) as { tipo: TipoDeImagem; base64: string }[]
    if (!conversa && !imagens.length) return json({ erro: 'Cole a conversa ou uma print do pedido.' }, 400)

    // o cardápio de agora: só o que está ativo e disponível
    const [categorias, tamanhos, produtos, adicionais] = await Promise.all([
      admin.from('categorias').select('id, nome, usa_tamanhos').eq('ativo', true).order('ordem'),
      admin.from('tamanhos').select('id, nome, max_sabores, aceita_borda').eq('ativo', true).order('ordem'),
      admin.from('produtos').select('id, categoria_id, nome, preco, produto_precos(tamanho_id, preco)').eq('ativo', true).eq('disponivel', true).order('ordem'),
      admin.from('adicionais').select('id, nome, tipo').eq('ativo', true).order('ordem'),
    ])
    const erroCardapio = categorias.error ?? tamanhos.error ?? produtos.error ?? adicionais.error
    if (erroCardapio) return json({ erro: erroCardapio.message }, 500)
    const cardapio = { categorias: categorias.data, tamanhos: tamanhos.data, produtos: produtos.data, adicionais: adicionais.data } as Cardapio
    if (!cardapio.produtos.length) return json({ erro: 'O cardápio está vazio: cadastre os produtos antes de ler pedidos.' }, 400)
    const mapa = cardapioParaIA(cardapio)

    const anthropic = new Anthropic({ apiKey: chave })
    // Haiku: escolha do Marcel (2026-11-15) pelo custo, cerca de 40 vezes menor que o do Opus. Não tem modelo
    // reserva no servidor para recusas: a recusa cai no aviso abaixo e a atendente lança à mão.
    const resposta = await anthropic.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      // esforço médio: com o baixo, o Haiku errava tamanho e sabor ("pizza média de calabresa"); custa centavos a mais por mês
      output_config: { effort: 'medium', format: zodOutputFormat(PedidoDaConversa) },
      // o cardápio muda pouco: fica guardado em cache entre um pedido e outro
      system: [
        { type: 'text', text: INSTRUCOES },
        { type: 'text', text: mapa.texto, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            ...imagens.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.tipo, data: i.base64 } })),
            { type: 'text' as const, text: conversa ? `Conversa copiada do WhatsApp:\n\n${conversa}` : 'A conversa está nas imagens acima.' },
          ],
        },
      ],
    })
    if (resposta.stop_reason === 'refusal' || !resposta.parsed_output) {
      return json({ erro: 'Não consegui ler este pedido. Confira se a conversa está completa ou lance à mão.' }, 422)
    }
    return json(montarPedido(resposta.parsed_output, cardapio, mapa))
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return json({ erro: 'A chave da IA (ANTHROPIC_API_KEY) foi recusada. Confira a chave e o crédito na conta da Anthropic.' }, 502)
    }
    if (e instanceof Anthropic.RateLimitError) return json({ erro: 'Muitas leituras ao mesmo tempo. Tente de novo em alguns segundos.' }, 429)
    // sem crédito na conta da Anthropic, a resposta é um 400
    if (e instanceof Anthropic.BadRequestError) return json({ erro: 'A IA recusou a leitura. Confira se ainda há crédito na conta da Anthropic; se houver, lance este pedido à mão.' }, 502)
    if (e instanceof Anthropic.APIError) return json({ erro: `A IA não respondeu agora (${e.status ?? 'sem conexão'}). Tente de novo ou lance à mão.` }, 502)
    return json({ erro: (e as Error).message ?? 'Erro inesperado' }, 500)
  }
})
