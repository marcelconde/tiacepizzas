import { useEffect, useMemo, useState } from 'react'
import { brl } from '../lib/formato'
import { nomeItem, precoNoTamanho, precoPizza, useLoja } from '../lib/loja'
import type { ItemCarrinho, Produto } from '../lib/tipos'
import { AreaTexto, Botao, Contador, Modal, Selecao, cx } from './ui'

const Titulo = ({ children, dica }: { children: string; dica?: string }) => (
  <div className="mt-5 mb-2 flex items-baseline justify-between first:mt-0">
    <h3 className="text-sm font-bold tracking-wide text-forno-800 uppercase">{children}</h3>
    {dica && <span className="text-xs text-stone-500">{dica}</span>}
  </div>
)

const opcao = (ativo: boolean, centralizado = false) =>
  cx(
    'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
    centralizado ? 'justify-center' : 'justify-between text-left',
    ativo ? 'border-molho-500 bg-molho-50 font-semibold text-molho-800' : 'border-stone-200 bg-white hover:border-stone-300',
  )

/** Janela para montar um item: tamanho, sabores (meio a meio), borda, extras e observação. */
export function MontarItem({ produto, onFechar, onAdicionar }: { produto: Produto | null; onFechar: () => void; onAdicionar: (item: ItemCarrinho) => void }) {
  const { catalogo, config } = useLoja()
  const categoria = catalogo.categorias.find((c) => c.id === produto?.categoria_id)
  const pizza = Boolean(categoria?.usa_tamanhos)

  const tamanhos = useMemo(
    () => (produto && pizza ? catalogo.tamanhos.filter((t) => precoNoTamanho(produto, t.id) != null) : []),
    [produto, pizza, catalogo.tamanhos],
  )

  const [tamanhoId, setTamanhoId] = useState('')
  const [sabores, setSabores] = useState<string[]>([])
  const [bordaId, setBordaId] = useState('')
  const [extras, setExtras] = useState<string[]>([])
  const [quantidade, setQuantidade] = useState(1)
  const [observacoes, setObservacoes] = useState('')

  useEffect(() => {
    if (!produto) return
    setTamanhoId(tamanhos[Math.min(2, tamanhos.length - 1)]?.id ?? '')
    setSabores([produto.id])
    setBordaId('')
    setExtras([])
    setQuantidade(1)
    setObservacoes('')
  }, [produto, tamanhos])

  if (!produto) return null

  const tamanho = tamanhos.find((t) => t.id === tamanhoId) ?? null
  const maxSabores = tamanho?.max_sabores ?? 1
  // sabores que podem dividir a pizza: qualquer pizza com preço neste tamanho
  const opcoesSabor = catalogo.produtos.filter(
    (p) => p.disponivel && catalogo.categorias.find((c) => c.id === p.categoria_id)?.usa_tamanhos && precoNoTamanho(p, tamanhoId) != null,
  )
  const saboresEscolhidos = sabores
    .slice(0, maxSabores)
    .map((id) => catalogo.produtos.find((p) => p.id === id))
    .filter((p): p is Produto => Boolean(p))
  const bordas = catalogo.adicionais.filter((a) => a.tipo === 'borda')
  const listaExtras = catalogo.adicionais.filter((a) => a.tipo === 'extra')
  const adicionais = catalogo.adicionais.filter((a) => a.id === bordaId || extras.includes(a.id))

  const precoBase = pizza ? precoPizza(saboresEscolhidos, tamanhoId, config?.regra_preco_sabores ?? 'maior') : Number(produto.preco ?? 0)
  const precoUnitario = precoBase + adicionais.reduce((s, a) => s + Number(a.preco), 0)
  const completo = !pizza || (tamanho != null && saboresEscolhidos.length === Math.min(sabores.length, maxSabores) && saboresEscolhidos.length > 0)

  function mudarQtdSabores(n: number) {
    setSabores((atual) => {
      const novo = atual.slice(0, n)
      while (novo.length < n) novo.push('')
      return novo
    })
  }

  function adicionar() {
    onAdicionar({
      uid: crypto.randomUUID(),
      produto_id: produto!.id,
      nome: pizza ? nomeItem(saboresEscolhidos, tamanho) : produto!.nome,
      tamanho_id: pizza ? tamanhoId : null,
      sabores: saboresEscolhidos.map((s) => s.id),
      adicionais: adicionais.map((a) => ({ id: a.id, nome: a.nome })),
      quantidade,
      preco_unitario: precoUnitario,
      observacoes: observacoes.trim(),
    })
    onFechar()
  }

  return (
    <Modal
      aberto
      titulo={produto.nome}
      onFechar={onFechar}
      rodape={
        <>
          <Contador valor={quantidade} onChange={setQuantidade} min={1} />
          <Botao className="flex-1" tamanho="g" disabled={!completo} onClick={adicionar}>
            Adicionar · {brl(precoUnitario * quantidade)}
          </Botao>
        </>
      }
    >
      {produto.descricao && <p className="text-sm text-stone-600">{produto.descricao}</p>}

      {pizza && (
        <>
          <Titulo>Tamanho</Titulo>
          <div className="grid grid-cols-2 gap-2">
            {tamanhos.map((t) => (
              <button key={t.id} type="button" className={opcao(t.id === tamanhoId)} onClick={() => setTamanhoId(t.id)}>
                <span>
                  {t.nome}
                  {t.descricao && <span className="block text-xs font-normal text-stone-500">{t.descricao}</span>}
                </span>
                <span className="tabular-nums">{brl(precoNoTamanho(produto, t.id))}</span>
              </button>
            ))}
          </div>

          {maxSabores > 1 && (
            <>
              <Titulo dica={config?.regra_preco_sabores === 'media' ? 'Cobramos a média dos sabores' : 'Vale o preço do sabor mais caro'}>Sabores</Titulo>
              <div className="mb-2 flex gap-2">
                {Array.from({ length: maxSabores }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className={opcao(Math.min(sabores.length, maxSabores) === n, true)} onClick={() => mudarQtdSabores(n)}>
                    {n === 1 ? 'Inteira' : `${n} sabores`}
                  </button>
                ))}
              </div>
              {sabores.length > 1 &&
                sabores.slice(0, maxSabores).map((id, i) => (
                  <Selecao key={i} className="mb-2" aria-label={`Sabor ${i + 1}`} value={id} onChange={(e) => setSabores((s) => s.map((v, j) => (j === i ? e.target.value : v)))}>
                    <option value="">Escolha o {i + 1}º sabor…</option>
                    {opcoesSabor.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome} — {brl(precoNoTamanho(p, tamanhoId))}
                      </option>
                    ))}
                  </Selecao>
                ))}
            </>
          )}

          {bordas.length > 0 && (
            <>
              <Titulo>Borda</Titulo>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className={opcao(bordaId === '')} onClick={() => setBordaId('')}>
                  Tradicional
                </button>
                {bordas.map((b) => (
                  <button key={b.id} type="button" className={opcao(bordaId === b.id)} onClick={() => setBordaId(b.id)}>
                    {b.nome.replace(/^Borda (de )?/i, '').replace(/^./, (c) => c.toUpperCase())}
                    <span className="tabular-nums">+ {brl(b.preco)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {listaExtras.length > 0 && (
            <>
              <Titulo>Adicionais</Titulo>
              <div className="grid gap-2 sm:grid-cols-2">
                {listaExtras.map((a) => {
                  const ativo = extras.includes(a.id)
                  return (
                    <button key={a.id} type="button" aria-pressed={ativo} className={opcao(ativo)} onClick={() => setExtras((e) => (ativo ? e.filter((x) => x !== a.id) : [...e, a.id]))}>
                      {a.nome}
                      <span className="tabular-nums">+ {brl(a.preco)}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      <Titulo>Observações</Titulo>
      <AreaTexto maxLength={300} placeholder={pizza ? 'Ex.: sem cebola, bem assada…' : 'Alguma observação?'} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
    </Modal>
  )
}
