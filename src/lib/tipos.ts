export type StatusPedido = 'novo' | 'confirmado' | 'em_preparo' | 'pronto' | 'saiu_entrega' | 'entregue' | 'cancelado'
export type TipoPedido = 'entrega' | 'retirada' | 'balcao'
export type OrigemPedido = 'site' | 'balcao' | 'telefone' | 'whatsapp' | 'ifood'
export type FormaPagamento = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'vale_refeicao'
export type Papel = 'admin' | 'atendente' | 'cozinha'

export interface Horario {
  aberto: boolean
  abre: string
  fecha: string
}

export interface Configuracoes {
  id: number
  nome_loja: string
  slogan: string | null
  telefone: string | null
  whatsapp: string | null
  instagram: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  fuso_horario: string
  horarios: Record<string, Horario>
  loja_aberta_manual: boolean | null
  aceita_pedidos_online: boolean
  auto_aceitar: boolean
  pedido_minimo: number
  tempo_preparo_min: number
  tempo_entrega_min: number
  regra_preco_sabores: 'maior' | 'media'
  chave_pix: string | null
  mensagem_aviso: string | null
  impressao: { largura: 58 | 80; auto: boolean; via_cozinha: boolean }
}

export interface ConfigFiscal {
  id: number
  ativo: boolean
  auto_emitir: boolean
  ambiente: 'homologacao' | 'producao'
  cnpj: string | null
  razao_social: string | null
  inscricao_estadual: string | null
  ncm_padrao: string
  cfop_padrao: string
  csosn_padrao: string
  origem_padrao: string
  aliquota_tributos: number
  indicar_entrega: boolean
}

export interface Categoria {
  id: string
  nome: string
  descricao: string | null
  usa_tamanhos: boolean
  ordem: number
  ativo: boolean
}

export interface Tamanho {
  id: string
  nome: string
  descricao: string | null
  fatias: number | null
  max_sabores: number
  ordem: number
  ativo: boolean
}

export interface Produto {
  id: string
  categoria_id: string
  nome: string
  descricao: string | null
  imagem_url: string | null
  preco: number | null
  disponivel: boolean
  destaque: boolean
  ativo: boolean
  ordem: number
  ncm: string | null
  cfop: string | null
  csosn: string | null
  produto_precos: { tamanho_id: string; preco: number }[]
}

export interface Adicional {
  id: string
  nome: string
  tipo: 'borda' | 'extra'
  preco: number
  ordem: number
  ativo: boolean
}

export interface Bairro {
  id: string
  nome: string
  taxa_entrega: number
  tempo_extra_min: number
  ativo: boolean
}

export interface Endereco {
  id?: string
  cep?: string | null
  logradouro: string
  numero?: string | null
  complemento?: string | null
  bairro_id?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  referencia?: string | null
}

export interface Cliente {
  id: string
  nome: string
  telefone: string
  email: string | null
  cpf: string | null
  nascimento: string | null
  observacoes: string | null
  criado_em: string
  total_pedidos?: number
  total_gasto?: number
  ultimo_pedido_em?: string | null
}

export interface Entregador {
  id: string
  nome: string
  telefone: string | null
  valor_por_entrega: number
  ativo: boolean
}

export interface ItemPedido {
  id: string
  pedido_id: string
  produto_id: string | null
  nome: string
  tamanho: string | null
  sabores: { produto_id: string; nome: string }[]
  adicionais: { id: string; nome: string; preco: number; tipo: string }[]
  quantidade: number
  preco_unitario: number
  total: number
  observacoes: string | null
  ordem: number
}

export interface NotaFiscal {
  id: string
  pedido_id: string
  ref: string
  status: 'processando' | 'autorizada' | 'rejeitada' | 'cancelada' | 'erro'
  ambiente: string
  numero: string | null
  serie: string | null
  chave: string | null
  protocolo: string | null
  qrcode_url: string | null
  url_consulta: string | null
  danfe_url: string | null
  xml_url: string | null
  valor: number | null
  mensagem: string | null
  criado_em: string
  cancelada_em: string | null
}

export interface Pedido {
  id: string
  numero: number
  codigo: string
  cliente_id: string | null
  cliente_nome: string
  cliente_telefone: string | null
  tipo: TipoPedido
  origem: OrigemPedido
  status: StatusPedido
  endereco: Endereco | null
  bairro: string | null
  subtotal: number
  taxa_entrega: number
  desconto: number
  total: number
  forma_pagamento: FormaPagamento
  troco_para: number | null
  pago: boolean
  cupom_codigo: string | null
  cpf_nota: string | null
  observacoes: string | null
  entregador_id: string | null
  previsao_em: string | null
  criado_em: string
  confirmado_em: string | null
  preparo_em: string | null
  pronto_em: string | null
  saiu_em: string | null
  entregue_em: string | null
  cancelado_em: string | null
  motivo_cancelamento: string | null
  pedido_itens?: ItemPedido[]
  notas_fiscais?: NotaFiscal[]
  entregadores?: { nome: string } | null
}

export interface Insumo {
  id: string
  nome: string
  unidade: string
  quantidade: number
  estoque_minimo: number
  custo_unitario: number
  fornecedor_id: string | null
  ativo: boolean
}

export interface Caixa {
  id: string
  aberto_em: string
  valor_abertura: number
  fechado_em: string | null
  valor_esperado: number | null
  valor_informado: number | null
  diferenca: number | null
  observacoes: string | null
}

export interface Perfil {
  id: string
  nome: string
  email: string | null
  papel: Papel
  ativo: boolean
}

// Item no carrinho (site e balcão). O preço aqui é só para exibição: o servidor recalcula.
export interface ItemCarrinho {
  uid: string
  produto_id: string
  nome: string
  tamanho_id: string | null
  sabores: string[]
  adicionais: { id: string; nome: string }[]
  quantidade: number
  preco_unitario: number
  observacoes: string
}
