import type { Pedido, StatusPedido } from './tipos'

/** Texto usado quando a loja não escreveu o seu (Configurações → Pedidos). */
export const MENSAGEM_CLIENTE_PADRAO = 'Recebemos o seu pedido #{número} e ele está {situação}. Você pode acompanhar por aqui: {link}'

/** Campos que o texto aceita, na ordem dos botões de inserir da tela de configurações. */
export const CAMPOS_MENSAGEM = [
  { campo: '{nome}', rotulo: 'Nome do cliente' },
  { campo: '{número}', rotulo: 'Número do pedido' },
  { campo: '{situação}', rotulo: 'Situação do pedido' },
  { campo: '{link}', rotulo: 'Link de acompanhamento' },
  { campo: '{loja}', rotulo: 'Nome da loja' },
] as const

/** Como a situação entra na frase "ele está …". */
const SITUACAO: Record<StatusPedido, string> = {
  novo: 'aguardando confirmação',
  confirmado: 'confirmado',
  em_preparo: 'em preparo',
  pronto: 'pronto',
  saiu_entrega: 'a caminho',
  problema_entrega: 'com um problema na entrega',
  entregue: 'entregue',
  cancelado: 'cancelado',
  reembolsado: 'reembolsado',
}

const simplificar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * Monta a mensagem do pedido a partir do texto da loja. Os campos aceitam com ou sem acento e maiúscula
 * ({numero}, {Situacao}…); o que não for campo conhecido fica como está.
 */
export function mensagemCliente(
  modelo: string | null | undefined,
  p: Pick<Pedido, 'numero' | 'status' | 'tipo' | 'cliente_nome'>,
  link: string,
  loja: string,
) {
  const valores: Record<string, string> = {
    nome: (p.cliente_nome ?? '').trim().split(/\s+/)[0] ?? '',
    numero: String(p.numero),
    situacao: p.status === 'pronto' && p.tipo === 'retirada' ? 'pronto para retirada' : SITUACAO[p.status],
    status: SITUACAO[p.status],
    link,
    loja,
  }
  const texto = modelo?.trim() ? modelo : MENSAGEM_CLIENTE_PADRAO
  return texto.replace(/\{([^{}]{1,20})\}/g, (todo, nome: string) => valores[simplificar(nome)] ?? todo)
}
