import { chamarFuncao } from './dados'
import { imprimirPedido } from './impressao'
import { supabase } from './supabase'
import type { ConfigFiscal, Configuracoes, NotaFiscal, Pedido, StatusPedido } from './tipos'

export const SELECT_PEDIDO = '*, pedido_itens(*), notas_fiscais(*), entregadores(nome)'

/** Próximo passo do pedido conforme o tipo (retirada e balcão não passam por "saiu para entrega"). */
export function proximoPasso(p: Pick<Pedido, 'status' | 'tipo'>): { status: StatusPedido; rotulo: string } | null {
  switch (p.status) {
    case 'novo':
      return { status: 'confirmado', rotulo: 'Aceitar' }
    case 'confirmado':
      return { status: 'em_preparo', rotulo: 'Iniciar preparo' }
    case 'em_preparo':
      return { status: 'pronto', rotulo: 'Marcar pronto' }
    case 'pronto':
      return p.tipo === 'entrega'
        ? { status: 'saiu_entrega', rotulo: 'Saiu para entrega' }
        : { status: 'entregue', rotulo: 'Entregar e receber' }
    case 'saiu_entrega':
      return { status: 'entregue', rotulo: 'Entregue e recebido' }
    case 'problema_entrega':
      return { status: 'saiu_entrega', rotulo: 'Tentar entregar de novo' }
    default:
      return null
  }
}

export async function carregarPedido(id: string) {
  const { data, error } = await supabase.from('pedidos').select(SELECT_PEDIDO).eq('id', id).single()
  if (error) throw error
  return data as Pedido
}

const AVISO_SEM_CAIXA = 'Nenhum caixa aberto: o recebimento ficou registrado só no pedido. Abra o caixa para controlar o dinheiro.'

/** Atualiza o pedido. Devolve um aviso quando um recebimento é registrado sem caixa aberto. */
export async function atualizarPedido(id: string, dados: Partial<Pedido>): Promise<string | null> {
  const { error } = await supabase.from('pedidos').update(dados).eq('id', id)
  if (error) throw error
  if (!dados.pago) return null
  const { count } = await supabase.from('caixas').select('id', { count: 'exact', head: true }).is('fechado_em', null)
  return count ? null : AVISO_SEM_CAIXA
}

/** Concluir o pedido também registra o recebimento (vai para o caixa aberto). */
export const mudarStatus = (p: Pick<Pedido, 'id'>, status: StatusPedido) =>
  atualizarPedido(p.id, { status, ...(status === 'entregue' ? { pago: true } : {}) })

export const emitirNota = (pedidoId: string) => chamarFuncao<NotaFiscal>('fiscal', { acao: 'emitir', pedido_id: pedidoId })
export const consultarNota = (notaId: string) => chamarFuncao<NotaFiscal>('fiscal', { acao: 'consultar', nota_id: notaId })
export const cancelarNota = (notaId: string, justificativa: string) =>
  chamarFuncao<NotaFiscal>('fiscal', { acao: 'cancelar', nota_id: notaId, justificativa })

export const notaAutorizada = (p: Pedido) => p.notas_fiscais?.find((n) => n.status === 'autorizada')

/**
 * Depois que um pedido é confirmado: emite a NFC-e (se a emissão automática estiver ligada)
 * e manda o cupom para a impressora. Devolve avisos que não impedem a venda.
 */
export async function aposConfirmar(pedidoId: string, cfg: Configuracoes, fiscal: ConfigFiscal | null) {
  const avisos: string[] = []
  if (fiscal?.ativo && fiscal.auto_emitir) {
    try {
      await emitirNota(pedidoId)
    } catch (e) {
      avisos.push(`Nota fiscal não emitida: ${(e as Error).message}`)
    }
  }
  if (cfg.impressao?.auto) {
    await imprimirPedido(await carregarPedido(pedidoId), cfg, { fiscal })
  }
  return avisos
}

/**
 * Aceita um pedido novo. O filtro por status garante que só uma aba/computador
 * processa (e imprime) o pedido, mesmo com vários painéis abertos.
 */
export async function aceitarPedido(pedidoId: string, cfg: Configuracoes, fiscal: ConfigFiscal | null) {
  const { data, error } = await supabase.from('pedidos').update({ status: 'confirmado' }).eq('id', pedidoId).eq('status', 'novo').select('id')
  if (error) throw error
  if (!data?.length) return null
  return aposConfirmar(pedidoId, cfg, fiscal)
}
