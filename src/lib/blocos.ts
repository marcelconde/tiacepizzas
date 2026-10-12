// Página inicial montada em blocos (Site e promoções → Página inicial → Livre).
import type { Catalogo } from './loja'
import type { Bloco, Configuracoes, Destino, Produto, SecaoId, SiteConteudo } from './tipos'
import { soDigitos } from './formato'

export const SECOES: Record<SecaoId, { nome: string; descricao: string }> = {
  hero: { nome: 'Capa', descricao: 'Título grande, frase de apresentação e botões' },
  banners: { nome: 'Banners cadastrados', descricao: 'Os banners da aba Banners marcados para a página inicial' },
  promocoes: { nome: 'Produtos em promoção', descricao: 'Produtos com promoção valendo agora' },
  destaques: { nome: 'Destaques', descricao: 'Produtos marcados como “destaque na capa” no cardápio' },
  como_funciona: { nome: 'Como funciona', descricao: 'Os três passos explicando o pedido' },
}

export const DESTINOS: Record<Destino['tipo'], string> = {
  nenhum: 'Nada (não é clicável)',
  cardapio: 'Abrir o cardápio',
  promocoes: 'Mostrar só os itens em promoção',
  categoria: 'Abrir uma categoria do cardápio',
  produto: 'Abrir um produto para pedir',
  acompanhar: 'Abrir o acompanhamento de pedido',
  whatsapp: 'Conversar no WhatsApp',
  instagram: 'Abrir o Instagram',
  link: 'Abrir outro endereço (link)',
}

const base = () => ({ id: crypto.randomUUID(), ativo: true, largura: 'inteira' as const })

export function novoBloco(tipo: 'texto' | 'imagem' | 'botao' | SecaoId): Bloco {
  if (tipo === 'texto') return { ...base(), tipo, titulo: '', texto: '', alinhamento: 'esquerda', fundo: 'nenhum' }
  if (tipo === 'imagem') return { ...base(), tipo, imagem_url: null, descricao: '', destino: { tipo: 'nenhum' } }
  if (tipo === 'botao') return { ...base(), tipo, texto: 'Ver cardápio e pedir', destino: { tipo: 'cardapio' }, estilo: 'principal', alinhamento: 'centro' }
  return { ...base(), tipo: 'secao', secao: tipo, tamanho: tipo === 'hero' ? 'grande' : 'medio' }
}

/** A página padrão de hoje transformada em blocos: ponto de partida para quem vai montar do seu jeito. */
export const blocosDaPaginaPadrao = (c: SiteConteudo): Bloco[] =>
  c.secoes.filter((s) => s.ativo).map((s) => ({ ...base(), tipo: 'secao' as const, secao: s.id, tamanho: s.tamanho }))

/** Só endereços de internet de verdade (nada de "javascript:" e afins). Sem "https://", completa. */
export function enderecoSeguro(valor: string | undefined): string | null {
  const v = (valor ?? '').trim()
  if (!v) return null
  if (v.startsWith('/') && !v.startsWith('//')) return v
  const comProtocolo = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const url = new URL(comProtocolo)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export type Caminho = { interno: string } | { externo: string } | { produto: Produto } | null

/** Para onde o destino leva de fato. Null quando não é clicável ou o que foi escolhido não existe mais. */
export function resolverDestino(d: Destino | undefined, config: Configuracoes | null, catalogo: Catalogo): Caminho {
  switch (d?.tipo) {
    case 'cardapio':
      return { interno: '/cardapio' }
    case 'promocoes':
      return { interno: '/cardapio?promocoes=1' }
    case 'acompanhar':
      return { interno: '/pedido' }
    case 'categoria':
      return catalogo.categorias.some((c) => c.id === d.valor) ? { interno: `/cardapio#cat-${d.valor}` } : null
    case 'produto': {
      const produto = catalogo.produtos.find((p) => p.id === d.valor && p.disponivel)
      return produto ? { produto } : null
    }
    case 'whatsapp':
      return config?.whatsapp ? { externo: `https://wa.me/55${soDigitos(config.whatsapp)}?text=${encodeURIComponent('Olá! Vim pelo site.')}` } : null
    case 'instagram': {
      const usuario = (config?.instagram ?? '').trim().replace(/^@/, '')
      return usuario ? { externo: `https://instagram.com/${usuario}` } : null
    }
    case 'link': {
      const endereco = enderecoSeguro(d.valor)
      return endereco ? (endereco.startsWith('/') ? { interno: endereco } : { externo: endereco }) : null
    }
    default:
      return null
  }
}

/** Resumo de uma linha do bloco, para a lista do editor. */
export function resumoBloco(b: Bloco): string {
  if (b.tipo === 'texto') return b.titulo || b.texto.split('\n')[0] || 'Sem texto ainda'
  if (b.tipo === 'imagem') return b.imagem_url ? `${b.descricao || 'Imagem enviada'} · ${DESTINOS[b.destino.tipo].toLowerCase()}` : 'Falta enviar a imagem'
  if (b.tipo === 'botao') return `“${b.texto || 'sem texto'}” · ${DESTINOS[b.destino.tipo].toLowerCase()}`
  return SECOES[b.secao].descricao
}
