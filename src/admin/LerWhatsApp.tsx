import { useState, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePlus, Sparkles, X } from 'lucide-react'
import { AreaTexto, Botao, Erro, Modal } from '../components/ui'
import { chamarFuncao } from '../lib/dados'
import { mensagemErro } from '../lib/supabase'

/** O pedido como a leitura devolve (mesmo formato de supabase/functions/ler-pedido/montar.ts → PedidoLido). */
export interface PedidoLido {
  cliente: { nome: string | null; telefone: string | null }
  tipo: 'entrega' | 'retirada' | null
  endereco: { cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; referencia: string | null }
  itens: { produto_id: string; tamanho_id: string | null; sabores: string[]; adicionais: string[]; quantidade: number; observacoes: string }[]
  forma_pagamento: 'pix' | 'dinheiro' | 'credito' | 'debito' | 'vale_refeicao' | null
  troco_para: number | null
  observacoes: string | null
  duvidas: string[]
}

interface Imagem {
  tipo: 'image/jpeg'
  base64: string
  previa: string
}

const MAX_IMAGENS = 4

/** Reduz a print (as do celular são enormes) para o tamanho que a IA lê, em JPEG. */
async function prepararImagem(arquivo: File): Promise<Imagem> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height))
  const tela = document.createElement('canvas')
  tela.width = Math.round(bitmap.width * escala)
  tela.height = Math.round(bitmap.height * escala)
  const ctx = tela.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, tela.width, tela.height)
  ctx.drawImage(bitmap, 0, 0, tela.width, tela.height)
  bitmap.close()
  const previa = tela.toDataURL('image/jpeg', 0.85)
  return { tipo: 'image/jpeg', base64: previa.split(',')[1], previa }
}

/**
 * Janela "Colar do WhatsApp": a atendente cola a conversa (texto, prints ou os dois) e a IA devolve o pedido
 * montado com o cardápio, que entra no Novo pedido para ela conferir antes de lançar.
 */
export function LerWhatsApp({ aberto, onFechar, onLido }: { aberto: boolean; onFechar: () => void; onLido: (p: PedidoLido) => void }) {
  const [texto, setTexto] = useState('')
  const [imagens, setImagens] = useState<Imagem[]>([])
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState('')

  async function juntarImagens(arquivos: File[]) {
    const fotos = arquivos.filter((a) => a.type.startsWith('image/'))
    if (!fotos.length) return
    setErro('')
    try {
      const novas = await Promise.all(fotos.slice(0, MAX_IMAGENS).map(prepararImagem))
      setImagens((atuais) => [...atuais, ...novas].slice(0, MAX_IMAGENS))
      if (imagens.length + novas.length > MAX_IMAGENS) setErro(`Use até ${MAX_IMAGENS} prints por pedido.`)
    } catch {
      setErro('Não consegui abrir esta imagem. Tente outra print.')
    }
  }

  // Ctrl+V de uma print (ou de imagem copiada) entra como imagem; texto colado continua indo para a caixa
  function colar(e: ClipboardEvent) {
    const arquivos = [...e.clipboardData.files]
    if (!arquivos.some((a) => a.type.startsWith('image/'))) return
    e.preventDefault()
    juntarImagens(arquivos)
  }

  function soltar(e: DragEvent) {
    e.preventDefault()
    juntarImagens([...e.dataTransfer.files])
  }

  function fechar() {
    if (lendo) return
    setTexto('')
    setImagens([])
    setErro('')
    onFechar()
  }

  async function ler() {
    setLendo(true)
    setErro('')
    try {
      const pedido = await chamarFuncao<PedidoLido>('ler-pedido', { texto, imagens: imagens.map(({ tipo, base64 }) => ({ tipo, base64 })) })
      onLido(pedido)
      setTexto('')
      setImagens([])
      onFechar()
    } catch (err) {
      setErro(mensagemErro(err))
    }
    setLendo(false)
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Colar pedido do WhatsApp"
      onFechar={fechar}
      largura="max-w-xl"
      rodape={
        <>
          <Botao variante="secundario" disabled={lendo} onClick={fechar}>
            Voltar
          </Botao>
          <Botao carregando={lendo} disabled={!texto.trim() && !imagens.length} onClick={ler}>
            <Sparkles className="size-4" /> {lendo ? 'Lendo o pedido…' : 'Ler pedido'}
          </Botao>
        </>
      }
    >
      <div className="space-y-3 text-sm" onPaste={colar} onDragOver={(e) => e.preventDefault()} onDrop={soltar}>
        <p className="text-stone-600">
          No WhatsApp, copie as mensagens do pedido (ou tire uma print da conversa) e cole aqui. Pode colar texto e prints juntos. A leitura preenche o Novo pedido para você conferir antes de
          lançar.
        </p>
        <AreaTexto
          aria-label="Conversa do WhatsApp"
          rows={7}
          maxLength={20000}
          placeholder="Cole aqui a conversa (Ctrl+V)…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {imagens.map((img, i) => (
            <div key={i} className="relative">
              <img src={img.previa} alt={`Print ${i + 1}`} className="h-20 w-14 rounded-lg border border-stone-200 object-cover object-top" />
              <button
                type="button"
                aria-label={`Tirar a print ${i + 1}`}
                onClick={() => setImagens((l) => l.filter((_, j) => j !== i))}
                className="absolute -top-2 -right-2 rounded-full bg-forno-800 p-0.5 text-white"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {imagens.length < MAX_IMAGENS && (
            <label className="inline-flex h-20 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 text-stone-600 hover:bg-stone-50">
              <ImagePlus className="size-5" />
              <span>
                Colar ou escolher print
                <span className="block text-xs text-stone-500">até {MAX_IMAGENS}</span>
              </span>
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => juntarImagens([...(e.target.files ?? [])])} />
            </label>
          )}
        </div>
        {erro && <Erro>{erro}</Erro>}
        <p className="text-xs text-stone-500">A leitura é feita por inteligência artificial e pode errar: confira os itens, o endereço e o pagamento antes de lançar.</p>
      </div>
    </Modal>
  )
}
