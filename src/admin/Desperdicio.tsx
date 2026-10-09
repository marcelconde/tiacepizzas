import { useState, type FormEvent } from 'react'
import { AreaTexto, Botao, Campo, Entrada, Erro, Selecao, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { num } from '../lib/formato'
import { mensagemErro, supabase } from '../lib/supabase'

interface InsumoSimples {
  id: string
  nome: string
  unidade: string
  quantidade: number
}

const MOTIVOS = ['Caiu no chão', 'Queimou no forno', 'Pedido montado errado', 'Estragou antes de usar']

/**
 * Registro de desperdício: o que foi perdido durante o preparo, quanto e por quê.
 * Usado na aba Desperdício do Estoque e no botão da tela da Cozinha — por isso busca os insumos por uma
 * função própria, que a cozinha também pode chamar (ela não enxerga a tela de Estoque).
 */
export function FormDesperdicio({ aoRegistrar }: { aoRegistrar?: () => void }) {
  const aviso = useAviso()
  const { dados: insumos, erro, recarregar } = useConsulta<InsumoSimples[]>(() => supabase.rpc('insumos_para_desperdicio'), [])
  const [insumoId, setInsumoId] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const insumo = insumos?.find((i) => i.id === insumoId)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const q = Number(quantidade.replace(',', '.'))
    if (!insumo) return aviso.erro('Escolha o item do estoque.')
    if (!(q > 0)) return aviso.erro('Informe a quantidade desperdiçada.')
    if (!observacao.trim()) return aviso.erro('Escreva o que aconteceu.')
    setSalvando(true)
    const { error } = await supabase.rpc('registrar_desperdicio', { p_insumo: insumo.id, p_quantidade: q, p_observacao: observacao })
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso(`Desperdício registrado: ${num(q)} ${insumo.unidade} de ${insumo.nome}`)
    setInsumoId('')
    setQuantidade('')
    setObservacao('')
    recarregar()
    aoRegistrar?.()
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      {erro && <Erro>{erro}</Erro>}
      <Campo rotulo="Item do estoque">
        <Selecao required value={insumoId} onChange={(e) => setInsumoId(e.target.value)}>
          <option value="">Escolha o que foi desperdiçado</option>
          {(insumos ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo={`Quantidade desperdiçada${insumo ? ` (${insumo.unidade})` : ''}`} dica={insumo ? `Em estoque agora: ${num(insumo.quantidade)} ${insumo.unidade}` : undefined}>
        <Entrada required inputMode="decimal" placeholder="Ex.: 0,2" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
      </Campo>
      <Campo rotulo="O que aconteceu?">
        <AreaTexto required rows={2} maxLength={300} placeholder="Ex.: a porção de queijo caiu no chão" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </Campo>
      <div className="flex flex-wrap gap-2">
        {MOTIVOS.map((m) => (
          <button key={m} type="button" onClick={() => setObservacao(m)} className="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold hover:bg-stone-50">
            {m}
          </button>
        ))}
      </div>
      <Botao type="submit" className="w-full" carregando={salvando}>
        Registrar desperdício
      </Botao>
    </form>
  )
}
