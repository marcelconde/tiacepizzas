// Emissão, consulta e cancelamento de NFC-e pela API da Focus NFe.
// Roda no servidor para que o token fiscal nunca chegue ao navegador.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

class Falha extends Error {
  constructor(mensagem: string, public status = 400) {
    super(mensagem)
  }
}

const BASES = { producao: 'https://api.focusnfe.com.br', homologacao: 'https://homologacao.focusnfe.com.br' }
const FORMAS: Record<string, string> = { dinheiro: '01', credito: '03', debito: '04', vale_refeicao: '11', pix: '17' }
const centavos = (v: number) => Math.round(Number(v) * 100)
const reais = (c: number) => c / 100
const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Divide um valor entre os itens na proporção de cada um, sem perder centavos. */
function ratear(total: number, pesos: number[]) {
  const alvo = centavos(total)
  const soma = pesos.reduce((a, b) => a + b, 0)
  if (!alvo || !soma) return pesos.map(() => 0)
  const partes = pesos.map((p) => Math.floor((alvo * p) / soma))
  let resto = alvo - partes.reduce((a, b) => a + b, 0)
  for (let i = 0; resto > 0; i = (i + 1) % partes.length, resto--) partes[i]++
  return partes.map(reais)
}

function acesso(ambiente: 'producao' | 'homologacao') {
  const token = Deno.env.get(ambiente === 'producao' ? 'FOCUS_NFE_TOKEN_PRODUCAO' : 'FOCUS_NFE_TOKEN_HOMOLOGACAO')
  if (!token) throw new Falha(`Token da Focus NFe (${ambiente}) não está configurado no servidor.`)
  return { base: BASES[ambiente], headers: { Authorization: 'Basic ' + btoa(`${token}:`), 'Content-Type': 'application/json' } }
}

// deno-lint-ignore no-explicit-any
function montarNfce(pedido: any, fiscal: any, loja: any) {
  // deno-lint-ignore no-explicit-any
  const itens = [...pedido.pedido_itens].sort((a: any, b: any) => a.ordem - b.ordem)
  const pesos = itens.map((i) => centavos(i.total))
  const descontos = ratear(pedido.desconto, pesos)
  const taxas = ratear(pedido.taxa_entrega, pesos)
  const cpf = digitos(pedido.cpf_nota)
  // A SEFAZ só aceita "entrega em domicílio" com o destinatário identificado; sem CPF a venda sai como presencial
  // e a taxa de entrega vai como outras despesas.
  const entrega = pedido.tipo === 'entrega' && fiscal.indicar_entrega && cpf.length === 11
  const aliquota = Number(fiscal.aliquota_tributos) || 0

  const nota: Record<string, unknown> = {
    cnpj_emitente: digitos(fiscal.cnpj),
    data_emissao: new Date().toISOString(),
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    indicador_inscricao_estadual_destinatario: '9',
    local_destino: '1',
    presenca_comprador: entrega ? '4' : '1',
    modalidade_frete: entrega && Number(pedido.taxa_entrega) > 0 ? '0' : '9',
    informacoes_adicionais_contribuinte: `Pedido ${pedido.numero}`,
    items: itens.map((i, n) => {
      const extras = (i.adicionais ?? []).map((a: { nome: string }) => a.nome).join(', ')
      return {
        numero_item: String(n + 1),
        codigo_produto: String(i.produto_id ?? i.id).slice(0, 8),
        descricao:
          fiscal.ambiente === 'homologacao' && n === 0
            ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
            : `${i.nome}${extras ? ` + ${extras}` : ''}`.slice(0, 120),
        codigo_ncm: i.produtos?.ncm ?? fiscal.ncm_padrao,
        cfop: i.produtos?.cfop ?? fiscal.cfop_padrao,
        unidade_comercial: 'UN',
        quantidade_comercial: i.quantidade,
        valor_unitario_comercial: Number(i.preco_unitario),
        unidade_tributavel: 'UN',
        quantidade_tributavel: i.quantidade,
        valor_unitario_tributavel: Number(i.preco_unitario),
        valor_bruto: Number(i.total),
        ...(descontos[n] ? { valor_desconto: descontos[n] } : {}),
        ...(taxas[n] ? (entrega ? { valor_frete: taxas[n] } : { valor_outras_despesas: taxas[n] }) : {}),
        icms_origem: fiscal.origem_padrao,
        icms_situacao_tributaria: i.produtos?.csosn ?? fiscal.csosn_padrao,
        ...(aliquota ? { valor_total_tributos: reais(Math.round((centavos(i.total) * aliquota) / 100)) } : {}),
      }
    }),
  }

  if (cpf.length === 11) {
    nota.cpf_destinatario = cpf
    nota.nome_destinatario = fiscal.ambiente === 'homologacao' ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : pedido.cliente_nome
  }
  if (entrega) {
    const e = pedido.endereco ?? {}
    Object.assign(nota, {
      logradouro_destinatario: e.logradouro,
      numero_destinatario: e.numero || 'S/N',
      complemento_destinatario: e.complemento || undefined,
      bairro_destinatario: e.bairro || pedido.bairro,
      municipio_destinatario: e.cidade || loja.cidade,
      uf_destinatario: e.uf || loja.uf,
      cep_destinatario: digitos(e.cep) || undefined,
    })
  }

  const forma = FORMAS[pedido.forma_pagamento] ?? '99'
  const total = Number(pedido.total)
  const troco = pedido.forma_pagamento === 'dinheiro' && Number(pedido.troco_para) > total ? Number(pedido.troco_para) - total : 0
  nota.formas_pagamento = [
    {
      forma_pagamento: forma,
      valor_pagamento: reais(centavos(total + troco)),
      // cartão e Pix recebidos na maquininha/por chave: pagamento não integrado ao sistema
      ...(['03', '04', '17'].includes(forma) ? { tipo_integracao: '2' } : {}),
    },
  ]
  if (troco) nota.valor_troco = reais(centavos(troco))
  return nota
}

/** Traduz a resposta da Focus NFe para as colunas de notas_fiscais. */
// deno-lint-ignore no-explicit-any
function interpretar(r: any, http: number, base: string) {
  const mensagemSefaz = [r.status_sefaz, r.mensagem_sefaz].filter(Boolean).join(' — ')
  if (r.status === 'autorizado') {
    return {
      status: 'autorizada',
      numero: r.numero,
      serie: r.serie,
      chave: r.chave_nfe,
      protocolo: r.protocolo ?? r.protocolo_nota_fiscal?.numero_protocolo ?? null,
      qrcode_url: r.qrcode_url,
      url_consulta: r.url_consulta_nf,
      danfe_url: r.caminho_danfe ? base + r.caminho_danfe : null,
      xml_url: r.caminho_xml_nota_fiscal ? base + r.caminho_xml_nota_fiscal : null,
      mensagem: mensagemSefaz || null,
    }
  }
  if (r.status === 'cancelado') return { status: 'cancelada', mensagem: mensagemSefaz || null }
  if (r.status === 'processando_autorizacao') return { status: 'processando', mensagem: 'Aguardando retorno da SEFAZ' }
  if (r.status === 'erro_autorizacao' || r.status === 'denegado') return { status: 'rejeitada', mensagem: mensagemSefaz || 'Rejeitada pela SEFAZ' }
  const detalhes = Array.isArray(r.erros) ? r.erros.map((e: { mensagem: string }) => e.mensagem).join('; ') : ''
  return { status: 'erro', mensagem: [r.mensagem, detalhes].filter(Boolean).join(' — ') || `Resposta inesperada do provedor fiscal (HTTP ${http})` }
}

async function gravar(admin: SupabaseClient, notaId: string, campos: Record<string, unknown>) {
  const { data, error } = await admin.from('notas_fiscais').update(campos).eq('id', notaId).select().single()
  if (error) throw new Falha(error.message, 500)
  return data
}

// deno-lint-ignore no-explicit-any
async function consultar(admin: SupabaseClient, nota: any) {
  const { base, headers } = acesso(nota.ambiente)
  const resp = await fetch(`${base}/v2/nfce/${encodeURIComponent(nota.ref)}?completa=1`, { headers })
  const r = await resp.json().catch(() => ({}))
  if (resp.status === 404) return gravar(admin, nota.id, { status: 'erro', mensagem: 'Nota não encontrada no provedor fiscal', resposta: r })
  return gravar(admin, nota.id, { ...interpretar(r, resp.status, base), resposta: r })
}

async function emitir(admin: SupabaseClient, pedidoId: string) {
  const [{ data: pedido }, { data: fiscal }, { data: loja }] = await Promise.all([
    admin.from('pedidos').select('*, pedido_itens(*, produtos(ncm, cfop, csosn))').eq('id', pedidoId).maybeSingle(),
    admin.from('config_fiscal').select('*').single(),
    admin.from('configuracoes').select('cidade, uf').single(),
  ])
  if (!pedido) throw new Falha('Pedido não encontrado', 404)
  if (!fiscal?.ativo) throw new Falha('A emissão de NFC-e está desligada.')
  if (digitos(fiscal.cnpj).length !== 14) throw new Falha('Informe o CNPJ na configuração fiscal.')
  if (pedido.status === 'novo' || pedido.status === 'cancelado') throw new Falha('Só é possível emitir nota de pedidos confirmados.')
  if (!pedido.pedido_itens?.length) throw new Falha('Pedido sem itens.')

  const { data: anteriores } = await admin.from('notas_fiscais').select('*').eq('pedido_id', pedidoId).order('criado_em', { ascending: false })
  const autorizada = anteriores?.find((n) => n.status === 'autorizada')
  if (autorizada) return autorizada
  const pendente = anteriores?.find((n) => n.status === 'processando')
  if (pendente) {
    const atual = await consultar(admin, pendente)
    if (atual.status === 'autorizada' || atual.status === 'processando') return atual
  }

  const { base, headers } = acesso(fiscal.ambiente)
  const ref = `tiace-${pedido.numero}-${(anteriores?.length ?? 0) + 1}`
  // registra a tentativa antes de falar com a SEFAZ; o índice único impede duas emissões simultâneas
  const { data: nota, error } = await admin
    .from('notas_fiscais')
    .insert({ pedido_id: pedidoId, ref, ambiente: fiscal.ambiente, valor: pedido.total, status: 'processando' })
    .select()
    .single()
  if (error) throw new Falha(error.code === '23505' ? 'Já existe uma emissão em andamento para este pedido.' : error.message, 409)

  let resp: Response
  try {
    resp = await fetch(`${base}/v2/nfce?ref=${encodeURIComponent(ref)}&completa=1`, {
      method: 'POST',
      headers,
      body: JSON.stringify(montarNfce(pedido, fiscal, loja ?? {})),
    })
  } catch (e) {
    // sem resposta não dá para saber se a nota entrou: fica "processando" para ser consultada depois
    await gravar(admin, nota.id, { mensagem: `Sem resposta do provedor fiscal: ${(e as Error).message}` })
    throw new Falha('Não foi possível falar com o provedor fiscal. Consulte a nota na tela Fiscal em instantes.', 502)
  }
  const r = await resp.json().catch(() => ({}))
  const gravada = await gravar(admin, nota.id, { ...interpretar(r, resp.status, base), resposta: r })
  if (gravada.status !== 'autorizada' && gravada.status !== 'processando') throw new Falha(gravada.mensagem ?? 'Nota não autorizada', 422)
  return gravada
}

async function cancelar(admin: SupabaseClient, notaId: string, justificativa: string) {
  const texto = (justificativa ?? '').trim()
  if (texto.length < 15 || texto.length > 255) throw new Falha('A justificativa deve ter entre 15 e 255 caracteres.')
  const { data: nota } = await admin.from('notas_fiscais').select('*').eq('id', notaId).maybeSingle()
  if (!nota) throw new Falha('Nota não encontrada', 404)
  if (nota.status !== 'autorizada') throw new Falha('Só notas autorizadas podem ser canceladas.')

  const { base, headers } = acesso(nota.ambiente)
  const resp = await fetch(`${base}/v2/nfce/${encodeURIComponent(nota.ref)}`, { method: 'DELETE', headers, body: JSON.stringify({ justificativa: texto }) })
  const r = await resp.json().catch(() => ({}))
  if (r.status !== 'cancelado' && r.codigo !== 'already_processed') {
    throw new Falha([r.mensagem_sefaz, r.mensagem].filter(Boolean).join(' — ') || `Cancelamento recusado (HTTP ${resp.status})`, 422)
  }
  return gravar(admin, nota.id, { status: 'cancelada', cancelada_em: new Date().toISOString(), justificativa_cancelamento: texto, mensagem: r.mensagem_sefaz ?? null })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // só a equipe ativa do painel pode mexer com nota fiscal
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    const { data: usuario } = await admin.auth.getUser(jwt)
    if (!usuario?.user) throw new Falha('Sessão inválida. Entre novamente.', 401)
    const { data: perfil } = await admin.from('perfis').select('ativo').eq('id', usuario.user.id).maybeSingle()
    if (!perfil?.ativo) throw new Falha('Acesso negado', 403)

    const corpo = await req.json()
    if (corpo.acao === 'emitir') return json(await emitir(admin, corpo.pedido_id))
    if (corpo.acao === 'cancelar') return json(await cancelar(admin, corpo.nota_id, corpo.justificativa))
    if (corpo.acao === 'consultar') {
      const { data: nota } = await admin.from('notas_fiscais').select('*').eq('id', corpo.nota_id).maybeSingle()
      if (!nota) throw new Falha('Nota não encontrada', 404)
      return json(await consultar(admin, nota))
    }
    throw new Falha('Ação desconhecida')
  } catch (e) {
    const falha = e instanceof Falha ? e : new Falha((e as Error).message ?? 'Erro inesperado', 500)
    return json({ erro: falha.message }, falha.status)
  }
})
