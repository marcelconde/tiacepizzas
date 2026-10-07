import { useEffect, useState } from 'react'
import { Bike, Store } from 'lucide-react'
import { Botao, Carregando, Erro, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { TIPO, haQuanto } from '../lib/formato'
import { mudarStatus } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Pedido } from '../lib/tipos'
import { Pagina, useAdmin, usePedidosAoVivo } from './AdminLayout'

/** Tela da cozinha: só o que precisa ser feito, em letras grandes. */
export default function Cozinha() {
  const aviso = useAviso()
  const { sincronizar } = useAdmin()
  const [ocupado, setOcupado] = useState('')
  const [, setRelogio] = useState(0)
  const { dados, carregando, erro, recarregar } = useConsulta<Pedido[]>(
    () => supabase.from('pedidos').select('*, pedido_itens(*)').in('status', ['confirmado', 'em_preparo']).order('confirmado_em'),
    [],
  )
  usePedidosAoVivo(recarregar)
  useEffect(() => {
    const t = setInterval(() => setRelogio((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  async function avancar(p: Pedido) {
    setOcupado(p.id)
    try {
      await mudarStatus(p, p.status === 'confirmado' ? 'em_preparo' : 'pronto')
      sincronizar()
    } catch (e) {
      aviso.erro(mensagemErro(e))
    } finally {
      setOcupado('')
    }
  }

  return (
    <Pagina titulo="Cozinha" descricao="Pedidos confirmados, do mais antigo para o mais novo.">
      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Tudo em dia" texto="Nenhum pedido aguardando preparo." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dados.map((p) => {
            const preparando = p.status === 'em_preparo'
            return (
              <article key={p.id} className={cx('flex flex-col rounded-2xl border-2 bg-white p-4', preparando ? 'border-orange-400' : 'border-sky-400')}>
                <header className="flex items-center justify-between">
                  <span className="text-2xl font-bold">#{p.numero}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-600">
                    {p.tipo === 'entrega' ? <Bike className="size-4" /> : <Store className="size-4" />}
                    {TIPO[p.tipo]} · {haQuanto(p.confirmado_em ?? p.criado_em)}
                  </span>
                </header>
                <ul className="mt-3 flex-1 space-y-3">
                  {(p.pedido_itens ?? [])
                    .slice()
                    .sort((a, b) => a.ordem - b.ordem)
                    .map((i) => (
                      <li key={i.id} className="text-lg leading-snug">
                        <b>{i.quantidade}x</b> {i.nome}
                        {i.adicionais.map((a) => (
                          <span key={a.id} className="block pl-6 text-base text-stone-700">
                            + {a.nome}
                          </span>
                        ))}
                        {i.observacoes && <span className="mt-0.5 block rounded bg-queijo-300/40 px-2 text-base font-bold">⚠ {i.observacoes}</span>}
                      </li>
                    ))}
                </ul>
                {p.observacoes && <p className="mt-3 rounded-lg bg-queijo-300/40 px-3 py-2 font-bold">Obs.: {p.observacoes}</p>}
                <Botao variante={preparando ? 'verde' : 'primario'} tamanho="g" className="mt-4 w-full" carregando={ocupado === p.id} onClick={() => avancar(p)}>
                  {preparando ? 'Pronto!' : 'Iniciar preparo'}
                </Botao>
              </article>
            )
          })}
        </div>
      )}
    </Pagina>
  )
}
