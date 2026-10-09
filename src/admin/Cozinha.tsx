import { useEffect, useState } from 'react'
import { Bike, Store, Trash2 } from 'lucide-react'
import { Botao, Carregando, Erro, Modal, Selo, Vazio, cx, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { TIPO, haQuanto } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { mudarStatus } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Pedido } from '../lib/tipos'
import { ATRASO, Pagina, nivelAtraso, useAdmin, usePedidosAoVivo } from './AdminLayout'
import { FormDesperdicio } from './Desperdicio'

/** Tela da cozinha: só o que precisa ser feito, em letras grandes. */
export default function Cozinha() {
  const aviso = useAviso()
  const { config } = useLoja()
  const { sincronizar } = useAdmin()
  const [ocupado, setOcupado] = useState('')
  const [desperdicio, setDesperdicio] = useState(false)
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
    <Pagina
      titulo="Cozinha"
      descricao="Pedidos confirmados, do mais antigo para o mais novo."
      acoes={
        <Botao variante="secundario" onClick={() => setDesperdicio(true)}>
          <Trash2 className="size-4" /> Registrar desperdício
        </Botao>
      }
    >
      <Modal aberto={desperdicio} titulo="Registrar desperdício" onFechar={() => setDesperdicio(false)} largura="max-w-md">
        <p className="mb-4 text-sm text-stone-600">Caiu no chão, queimou, foi montado errado? Registre: a quantidade sai do estoque e o motivo fica guardado.</p>
        <FormDesperdicio aoRegistrar={() => setDesperdicio(false)} />
      </Modal>
      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Tudo em dia" texto="Nenhum pedido aguardando preparo." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dados.map((p) => {
            const preparando = p.status === 'em_preparo'
            const atraso = nivelAtraso(p.status_em, config)
            return (
              <article key={p.id} className={cx('flex flex-col rounded-2xl border-2 bg-white p-4', atraso ? ATRASO[atraso].borda : preparando ? 'border-orange-400' : 'border-sky-400')}>
                <header className="flex items-center justify-between">
                  <span className="text-2xl font-bold">#{p.numero}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-600">
                    {p.tipo === 'entrega' ? <Bike className="size-4" /> : <Store className="size-4" />}
                    {TIPO[p.tipo]} · {haQuanto(p.confirmado_em ?? p.criado_em)}
                  </span>
                </header>
                {atraso && (
                  <p className="mt-2">
                    <Selo className={ATRASO[atraso].cor}>
                      {ATRASO[atraso].rotulo} · {haQuanto(p.status_em)} nesta etapa
                    </Selo>
                  </p>
                )}
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
