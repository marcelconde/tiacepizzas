import { useEffect, useMemo, useState } from 'react'
import { Tag } from 'lucide-react'
import { brl } from '../lib/formato'
import { nomeItem, precoComPromocao, precoNoTamanho, precoPizza, promocoesDo, useLoja } from '../lib/loja'
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
    'flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
    centralizado ? 'justify-center' : 'justify-between text-left',
    ativo ? 'border-molho-500 bg-molho-50 font-semibold text-molho-800' : 'border-stone-200 bg-white hover:border-stone-300',
  )

/** Preço com o valor de tabela riscado quando há promoção. */
export function Preco({ tabela, promo, className }: { tabela: number; promo: number; className?: string }) {
  if (promo >= tabela) return <span className={cx('tabular-nums', className)}>{brl(tabela)}</span>
  return (
    <span className={cx('tabular-nums', className)}>
      <s className="mr-1.5 text-xs font-normal text-stone-400">{brl(tabela)}</s>
      {brl(promo)}
    </span>
  )
}

/**
 * Detalhes do produto sobre o cardápio (no celular sobe como uma folha a partir de baixo):
 * foto, ingredientes, informações nutricionais, tamanho, sabores (meio a meio), borda, adicionais e observação.
 * O que aparece é escolhido no painel, em Conteúdo → Tela do produto.
 */
export function MontarItem({ produto, onFechar, onAdicionar }: { produto: Produto | null; onFechar: () => void; onAdicionar: (item: ItemCarrinho) => void }) {
  const { catalogo, config, conteudo } = useLoja()
  const categoria = catalogo.categorias.find((c) => c.id === produto?.categoria_id)
  const pizza = Boolean(categoria?.usa_tamanhos)
  const exibir = conteudo?.produto ?? { foto: true, descricao: true, ingredientes: true, nutricional: true, observacoes: true, complementos: true }

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
    // só ao trocar de produto: o cardápio se atualiza sozinho em segundo plano e não deve apagar as escolhas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produto?.id])

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
  const bordas = exibir.complementos ? catalogo.adicionais.filter((a) => a.tipo === 'borda') : []
  const listaExtras = exibir.complementos ? catalogo.adicionais.filter((a) => a.tipo === 'extra') : []
  const adicionais = catalogo.adicionais.filter((a) => a.id === bordaId || extras.includes(a.id))
  const promocoes = promocoesDo(catalogo, produto.id)

  const precoBase = pizza
    ? precoPizza(catalogo, saboresEscolhidos, tamanhoId, config?.regra_preco_sabores ?? 'maior')
    : precoComPromocao(catalogo, produto.id, null, Number(produto.preco ?? 0))
  const precoUnitario = precoBase + adicionais.reduce((s, a) => s + Number(a.preco), 0)
  const completo = !pizza || (tamanho != null && saboresEscolhidos.length === Math.min(sabores.length, maxSabores) && saboresEscolhidos.length > 0)
  const n = produto.nutricional
  const temNutricional = exibir.nutricional && n && Object.values(n).some((v) => v !== '' && v != null)

  function mudarQtdSabores(qtd: number) {
    setSabores((atual) => {
      const novo = atual.slice(0, qtd)
      while (novo.length < qtd) novo.push('')
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
      {exibir.foto && produto.imagem_url && <img src={produto.imagem_url} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />}
      {promocoes.map((pr) => (
        <p key={pr.id} className="mb-3 flex items-start gap-2 rounded-lg bg-queijo-300/40 px-3 py-2 text-sm font-semibold text-forno-900">
          <Tag className="mt-0.5 size-4 shrink-0" />
          <span>
            {pr.selo} — {pr.nome}
            {pr.descricao && <span className="block font-normal">{pr.descricao}</span>}
          </span>
        </p>
      ))}
      {exibir.descricao && produto.descricao && <p className="text-sm text-stone-600">{produto.descricao}</p>}
      {exibir.ingredientes && produto.ingredientes && (
        <p className="mt-2 text-sm text-stone-600">
          <b className="text-forno-800">Ingredientes:</b> {produto.ingredientes}
        </p>
      )}
      {!pizza && <p className="mt-3 text-lg font-bold text-molho-700"><Preco tabela={Number(produto.preco ?? 0)} promo={precoBase} /></p>}

      {pizza && (
        <>
          <Titulo>Tamanho</Titulo>
          <div className="grid grid-cols-2 gap-2">
            {tamanhos.map((t) => {
              const tabela = precoNoTamanho(produto, t.id) ?? 0
              return (
                <button key={t.id} type="button" className={opcao(t.id === tamanhoId)} onClick={() => setTamanhoId(t.id)}>
                  <span>
                    {t.nome}
                    {t.descricao && <span className="block text-xs font-normal text-stone-500">{t.descricao}</span>}
                  </span>
                  <Preco tabela={tabela} promo={precoComPromocao(catalogo, produto.id, t.id, tabela)} />
                </button>
              )
            })}
          </div>

          {maxSabores > 1 && (
            <>
              <Titulo dica={config?.regra_preco_sabores === 'media' ? 'Cobramos a média dos sabores' : 'Vale o preço do sabor mais caro'}>Sabores</Titulo>
              <div className="mb-2 flex gap-2">
                {Array.from({ length: maxSabores }, (_, i) => i + 1).map((qtd) => (
                  <button key={qtd} type="button" className={opcao(Math.min(sabores.length, maxSabores) === qtd, true)} onClick={() => mudarQtdSabores(qtd)}>
                    {qtd === 1 ? 'Inteira' : `${qtd} sabores`}
                  </button>
                ))}
              </div>
              {sabores.length > 1 &&
                sabores.slice(0, maxSabores).map((id, i) => (
                  <Selecao key={i} className="mb-2 h-11" aria-label={`Sabor ${i + 1}`} value={id} onChange={(e) => setSabores((s) => s.map((v, j) => (j === i ? e.target.value : v)))}>
                    <option value="">Escolha o {i + 1}º sabor…</option>
                    {opcoesSabor.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome} — {brl(precoComPromocao(catalogo, p.id, tamanhoId, precoNoTamanho(p, tamanhoId) ?? 0))}
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

      {exibir.observacoes && (
        <>
          <Titulo>Observações</Titulo>
          <AreaTexto maxLength={300} placeholder={pizza ? 'Ex.: sem cebola, bem assada…' : 'Alguma observação?'} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </>
      )}

      {temNutricional && n && (
        <details className="mt-5 rounded-lg border border-stone-200 px-3 py-2 text-sm">
          <summary className="font-semibold text-forno-800">Informações nutricionais</summary>
          <table className="mt-2 w-full">
            <tbody className="[&_td]:py-1 [&_td:last-child]:text-right [&_td:last-child]:tabular-nums [&_tr]:border-t [&_tr]:border-stone-100">
              {n.porcao && <tr><td>Porção</td><td>{n.porcao}</td></tr>}
              {n.calorias != null && n.calorias !== '' && <tr><td>Valor energético</td><td>{n.calorias} kcal</td></tr>}
              {n.carboidratos != null && n.carboidratos !== '' && <tr><td>Carboidratos</td><td>{n.carboidratos} g</td></tr>}
              {n.proteinas != null && n.proteinas !== '' && <tr><td>Proteínas</td><td>{n.proteinas} g</td></tr>}
              {n.gorduras != null && n.gorduras !== '' && <tr><td>Gorduras totais</td><td>{n.gorduras} g</td></tr>}
              {n.sodio != null && n.sodio !== '' && <tr><td>Sódio</td><td>{n.sodio} mg</td></tr>}
            </tbody>
          </table>
          {n.alergenicos && <p className="mt-2 font-semibold text-forno-800">{n.alergenicos}</p>}
        </details>
      )}
    </Modal>
  )
}
