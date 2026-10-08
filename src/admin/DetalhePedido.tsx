import { useState } from 'react'
import { AlertTriangle, Ban, ChefHat, Copy, ExternalLink, FileText, MessageCircle, Printer, Undo2 } from 'lucide-react'
import { AreaTexto, Botao, Campo, Carregando, Erro, Modal, Selecao, Selo, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { ORIGEM, PAGAMENTO, STATUS, TIPO, brl, cpf, dataHora, enderecoTexto, hora, soDigitos, telefone } from '../lib/formato'
import { imprimirPedido } from '../lib/impressao'
import { useLoja } from '../lib/loja'
import { SELECT_PEDIDO, aceitarPedido, atualizarPedido, emitirNota, mudarStatus, notaAutorizada, proximoPasso } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Entregador, FormaPagamento, Pedido, StatusPedido } from '../lib/tipos'
import { ATRASO, nivelAtraso, useAdmin } from './AdminLayout'

interface Mudanca {
  quando: string
  usuario: string | null
  antes: Record<string, unknown>
  depois: Record<string, unknown>
}

type Acao = 'cancelar' | 'reembolsar' | 'problema'
const ACOES: Record<Acao, { titulo: string; botao: string; texto: string; rotulo: string; exemplo: string; obrigatorio: boolean }> = {
  cancelar: {
    titulo: 'Cancelar pedido', botao: 'Confirmar cancelamento', rotulo: 'Motivo (opcional)', exemplo: 'Ex.: cliente desistiu, endereço fora da área…', obrigatorio: false,
    texto: 'O estoque é devolvido e, se o pedido já estava pago, o valor é estornado do caixa. O cliente vê o motivo na tela de acompanhamento.',
  },
  reembolsar: {
    titulo: 'Reembolsar pedido', botao: 'Confirmar reembolso', rotulo: 'Motivo do reembolso', exemplo: 'Ex.: pizza errada, chegou fria…', obrigatorio: true,
    texto: 'Use quando o pedido foi feito e o dinheiro é devolvido ao cliente. O valor sai do caixa e o pedido deixa de contar no faturamento. O estoque não é devolvido.',
  },
  problema: {
    titulo: 'Problema na entrega', botao: 'Registrar problema', rotulo: 'O que aconteceu?', exemplo: 'Ex.: cliente não atende, endereço não encontrado…', obrigatorio: true,
    texto: 'O pedido fica marcado como problema na entrega até ser reenviado, entregue, cancelado ou reembolsado. O cliente vê o aviso no acompanhamento.',
  },
}

/** Tudo sobre um pedido, com as ações de operação (avançar, imprimir, nota, cancelar, reembolsar) e o histórico de alterações. */
export function DetalhePedido({ pedidoId, onFechar, onMudou }: { pedidoId: string | null; onFechar: () => void; onMudou?: () => void }) {
  const { config } = useLoja()
  const { fiscal, sincronizar, pode } = useAdmin()
  const aviso = useAviso()
  const [ocupado, setOcupado] = useState('')
  const [acao, setAcao] = useState<Acao | null>(null)
  const [motivo, setMotivo] = useState('')

  const { dados: p, carregando, erro, recarregar } = useConsulta<Pedido | null>(
    () => (pedidoId ? supabase.from('pedidos').select(SELECT_PEDIDO).eq('id', pedidoId).single() : Promise.resolve({ data: null, error: null })),
    [pedidoId],
  )
  const { dados: historico, recarregar: recarregarHistorico } = useConsulta<Mudanca[]>(
    () => (pedidoId ? supabase.rpc('historico_pedido', { p_pedido: pedidoId }) : Promise.resolve({ data: [], error: null })),
    [pedidoId],
  )
  const { dados: entregadores } = useConsulta<Entregador[]>(() => supabase.from('entregadores').select('*').eq('ativo', true).order('nome'), [])

  if (!pedidoId) return null

  async function executar(nome: string, fn: () => Promise<unknown>, sucesso?: string) {
    setOcupado(nome)
    try {
      const r = await fn()
      const avisos = Array.isArray(r) ? r : typeof r === 'string' ? [r] : []
      avisos.forEach((a) => aviso.erro(a))
      if (sucesso) aviso.sucesso(sucesso)
      await Promise.all([recarregar(), recarregarHistorico()])
      sincronizar()
      onMudou?.()
      return true
    } catch (e) {
      aviso.erro(mensagemErro(e))
      return false
    } finally {
      setOcupado('')
    }
  }

  async function confirmarAcao() {
    if (!p || !acao) return
    const texto = motivo.trim()
    const dados: Partial<Pedido> =
      acao === 'cancelar' ? { status: 'cancelado', motivo_cancelamento: texto || null }
      : acao === 'reembolsar' ? { status: 'reembolsado', motivo_reembolso: texto }
      : { status: 'problema_entrega', problema_entrega: texto }
    if (await executar('acao', () => atualizarPedido(p.id, dados), acao === 'cancelar' ? 'Pedido cancelado' : acao === 'reembolsar' ? 'Pedido reembolsado' : 'Problema registrado')) {
      setAcao(null)
      setMotivo('')
    }
  }

  const passo = p ? proximoPasso(p) : null
  const nota = p ? notaAutorizada(p) : undefined
  const ultimaNota = p?.notas_fiscais?.slice().sort((a, b) => b.criado_em.localeCompare(a.criado_em))[0]
  const encerrado = !p || ['entregue', 'cancelado', 'reembolsado'].includes(p.status)
  const semVolta = !p || p.status === 'cancelado' || p.status === 'reembolsado'
  const atraso = p && !encerrado ? nivelAtraso(p.status_em, config) : null
  const linkAcompanhar = p ? `${location.origin}/pedido?c=${p.codigo}` : ''
  const whats = p?.cliente_telefone
    ? `https://wa.me/55${soDigitos(p.cliente_telefone)}?text=${encodeURIComponent(`Olá, ${p.cliente_nome.split(' ')[0]}! Aqui é da ${config?.nome_loja}. Seu pedido #${p.numero} está ${STATUS[p.status].rotulo.toLowerCase()}. Acompanhe: ${linkAcompanhar}`)}`
    : null
  const nomeEntregador = (id: unknown) => entregadores?.find((e) => e.id === id)?.nome ?? (id ? 'outro entregador' : 'ninguém')

  // traduz cada alteração registrada na auditoria para uma frase
  const frases = (m: Mudanca) =>
    Object.keys(m.depois).map((campo) => {
      const de = m.antes[campo]
      const para = m.depois[campo]
      if (campo === 'status') return `Situação: ${STATUS[de as StatusPedido]?.rotulo ?? de} → ${STATUS[para as StatusPedido]?.rotulo ?? para}`
      if (campo === 'pago') return para ? 'Pagamento confirmado' : 'Pagamento desfeito'
      if (campo === 'entregador_id') return `Entregador: ${nomeEntregador(de)} → ${nomeEntregador(para)}`
      if (campo === 'forma_pagamento') return `Forma de pagamento: ${PAGAMENTO[de as FormaPagamento] ?? de} → ${PAGAMENTO[para as FormaPagamento] ?? para}`
      if (campo === 'motivo_cancelamento') return `Motivo do cancelamento: ${para}`
      if (campo === 'motivo_reembolso') return `Motivo do reembolso: ${para}`
      if (campo === 'problema_entrega') return para ? `Problema: ${para}` : 'Problema resolvido'
      return `${campo}: ${String(de ?? '—')} → ${String(para ?? '—')}`
    })

  return (
    <>
      <Modal
        aberto
        largura="max-w-2xl"
        onFechar={onFechar}
        titulo={
          p ? (
            <span className="flex flex-wrap items-center gap-2">
              Pedido #{p.numero} <Selo className={STATUS[p.status].cor}>{STATUS[p.status].rotulo}</Selo>
              {atraso && <Selo className={ATRASO[atraso].cor}>{ATRASO[atraso].rotulo}</Selo>}
            </span>
          ) : (
            'Pedido'
          )
        }
        rodape={
          p &&
          config && (
            <>
              <div className="mr-auto flex flex-wrap gap-2">
                {!encerrado && (
                  <Botao variante="perigo" onClick={() => setAcao('cancelar')}>
                    <Ban className="size-4" /> Cancelar
                  </Botao>
                )}
                {p.status === 'saiu_entrega' && (
                  <Botao variante="perigo" onClick={() => setAcao('problema')}>
                    <AlertTriangle className="size-4" /> Problema
                  </Botao>
                )}
                {(p.status === 'entregue' || p.status === 'problema_entrega') && (
                  <Botao variante="perigo" onClick={() => setAcao('reembolsar')}>
                    <Undo2 className="size-4" /> Reembolsar
                  </Botao>
                )}
              </div>
              <Botao variante="secundario" title="Via da cozinha" onClick={() => imprimirPedido(p, config, { cozinha: true, cliente: false })}>
                <ChefHat className="size-4" /> Cozinha
              </Botao>
              <Botao variante="secundario" onClick={() => imprimirPedido(p, config, { fiscal, cozinha: false })}>
                <Printer className="size-4" /> Imprimir
              </Botao>
              {passo && (
                <Botao
                  variante="verde"
                  carregando={ocupado === 'passo'}
                  onClick={() =>
                    executar('passo', () =>
                      passo.status === 'confirmado'
                        ? aceitarPedido(p.id, config, fiscal)
                        : p.status === 'problema_entrega'
                          ? atualizarPedido(p.id, { status: 'saiu_entrega', problema_entrega: null })
                          : mudarStatus(p, passo.status),
                    )
                  }
                >
                  {passo.rotulo}
                </Botao>
              )}
            </>
          )
        }
      >
        {erro && <Erro>{erro}</Erro>}
        {carregando && !p ? (
          <Carregando />
        ) : (
          p && (
            <div className="space-y-5 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Cliente</p>
                  <p className="font-semibold">{p.cliente_nome}</p>
                  {p.cliente_telefone && <p>{telefone(p.cliente_telefone)}</p>}
                  {p.cpf_nota && <p className="text-stone-600">CPF na nota: {cpf(p.cpf_nota)}</p>}
                  <div className="mt-1 flex flex-wrap gap-3">
                    {whats && (
                      <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-manjericao-700 hover:underline">
                        <MessageCircle className="size-4" /> Avisar no WhatsApp
                      </a>
                    )}
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-forno-600 hover:underline" onClick={() => navigator.clipboard.writeText(linkAcompanhar).then(() => aviso.sucesso('Link de acompanhamento copiado'))}>
                      <Copy className="size-4" /> Link de acompanhamento
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                    {TIPO[p.tipo]} · {ORIGEM[p.origem]} · {dataHora(p.criado_em)}
                  </p>
                  {p.tipo === 'entrega' ? (
                    <>
                      <p className="font-semibold">{enderecoTexto(p.endereco)}</p>
                      {p.endereco?.referencia && <p className="text-stone-600">Ref.: {p.endereco.referencia}</p>}
                      {p.distancia_km != null && <p className="text-stone-600">Distância: {String(p.distancia_km).replace('.', ',')} km</p>}
                    </>
                  ) : (
                    <p className="font-semibold">{p.tipo === 'retirada' ? 'Cliente retira na loja' : 'Venda no balcão'}</p>
                  )}
                  {p.previsao_em && !encerrado && <p className="text-stone-600">Previsão: {hora(p.previsao_em)}</p>}
                </div>
              </div>

              {p.observacoes && <p className="rounded-lg bg-queijo-300/30 px-3 py-2 font-semibold">Obs.: {p.observacoes}</p>}
              {p.status === 'cancelado' && <Erro>Cancelado{p.motivo_cancelamento ? `: ${p.motivo_cancelamento}` : ''}</Erro>}
              {p.status === 'reembolsado' && <Erro>Reembolsado{p.motivo_reembolso ? `: ${p.motivo_reembolso}` : ''}</Erro>}
              {p.status === 'problema_entrega' && <Erro>Problema na entrega: {p.problema_entrega ?? 'sem detalhes'}</Erro>}

              <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
                {(p.pedido_itens ?? [])
                  .slice()
                  .sort((a, b) => a.ordem - b.ordem)
                  .map((i) => (
                    <li key={i.id} className="flex justify-between gap-3 px-3 py-2">
                      <span>
                        <b>{i.quantidade}x</b> {i.nome}
                        {i.adicionais.length > 0 && <span className="block text-stone-500">+ {i.adicionais.map((a) => a.nome).join(', ')}</span>}
                        {i.observacoes && <span className="block font-semibold text-molho-700">Obs.: {i.observacoes}</span>}
                      </span>
                      <span className="tabular-nums">{brl(i.total)}</span>
                    </li>
                  ))}
              </ul>

              <div className="grid gap-4 sm:grid-cols-2">
                <dl className="space-y-1">
                  <div className="flex justify-between">
                    <dt>Subtotal</dt>
                    <dd className="tabular-nums">{brl(p.subtotal)}</dd>
                  </div>
                  {p.taxa_entrega > 0 && (
                    <div className="flex justify-between">
                      <dt>Entrega</dt>
                      <dd className="tabular-nums">{brl(p.taxa_entrega)}</dd>
                    </div>
                  )}
                  {p.desconto > 0 && (
                    <div className="flex justify-between">
                      <dt>Desconto {p.cupom_codigo && `(${p.cupom_codigo})`}</dt>
                      <dd className="tabular-nums">− {brl(p.desconto)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{brl(p.total)}</dd>
                  </div>
                  {p.forma_pagamento === 'dinheiro' && p.troco_para && (
                    <div className="flex justify-between font-semibold text-molho-700">
                      <dt>Levar troco (paga com {brl(p.troco_para)})</dt>
                      <dd className="tabular-nums">{brl(p.troco_para - p.total)}</dd>
                    </div>
                  )}
                </dl>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Selecao
                      aria-label="Forma de pagamento"
                      className="w-auto flex-1"
                      disabled={p.pago || encerrado}
                      value={p.forma_pagamento}
                      onChange={(e) => executar('pgto', () => atualizarPedido(p.id, { forma_pagamento: e.target.value as FormaPagamento }))}
                    >
                      {Object.entries(PAGAMENTO).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                    {!semVolta && (
                      <Botao variante={p.pago ? 'secundario' : 'verde'} carregando={ocupado === 'pago'} onClick={() => executar('pago', () => atualizarPedido(p.id, { pago: !p.pago }))}>
                        {p.pago ? 'Pago ✓ (desfazer)' : 'Confirmar pagamento'}
                      </Botao>
                    )}
                  </div>
                  {p.pago && p.pago_em && <p className="text-xs text-stone-500">Pagamento confirmado em {dataHora(p.pago_em)}</p>}
                  {p.tipo === 'entrega' && (
                    <Campo rotulo="Motoboy responsável">
                      <Selecao value={p.entregador_id ?? ''} disabled={encerrado} onChange={(e) => executar('entregador', () => atualizarPedido(p.id, { entregador_id: e.target.value || null }))}>
                        <option value="">Não definido</option>
                        {entregadores?.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nome}
                          </option>
                        ))}
                      </Selecao>
                    </Campo>
                  )}
                </div>
              </div>

              {!semVolta && (pode('fiscal') || pode('pedidos')) && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 px-3 py-2">
                  <FileText className="size-4 text-stone-500" />
                  {nota ? (
                    <>
                      <span className="font-semibold">
                        NFC-e nº {nota.numero} autorizada{nota.ambiente === 'homologacao' && ' (homologação)'}
                      </span>
                      {nota.danfe_url && (
                        <a href={nota.danfe_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-molho-700 hover:underline">
                          DANFE <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-stone-600">
                        {!fiscal?.ativo
                          ? 'Emissão de nota fiscal desativada (configure em Fiscal).'
                          : ultimaNota
                            ? `Última tentativa: ${ultimaNota.status} — ${ultimaNota.mensagem ?? 'sem detalhes'}`
                            : 'Nota fiscal ainda não emitida.'}
                      </span>
                      {fiscal?.ativo && p.status !== 'novo' && (
                        <Botao variante="secundario" tamanho="p" carregando={ocupado === 'nota'} onClick={() => executar('nota', () => emitirNota(p.id), 'NFC-e autorizada')}>
                          Emitir NFC-e
                        </Botao>
                      )}
                    </>
                  )}
                </div>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Histórico de alterações</h3>
                <ol className="space-y-1.5 border-l-2 border-stone-200 pl-3">
                  <li>
                    <span className="text-stone-500 tabular-nums">{dataHora(p.criado_em)}</span> · Pedido recebido pelo canal {ORIGEM[p.origem].toLowerCase()}
                  </li>
                  {(historico ?? []).map((m, i) => (
                    <li key={i}>
                      <span className="text-stone-500 tabular-nums">{dataHora(m.quando)}</span> · {frases(m).join('; ')}
                      <span className="text-stone-500"> — {m.usuario ?? 'sistema'}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )
        )}
      </Modal>

      <Modal
        aberto={acao != null}
        titulo={acao ? ACOES[acao].titulo : ''}
        largura="max-w-md"
        onFechar={() => setAcao(null)}
        rodape={
          acao && (
            <>
              <Botao variante="secundario" onClick={() => setAcao(null)}>
                Voltar
              </Botao>
              <Botao variante="perigo" carregando={ocupado === 'acao'} disabled={ACOES[acao].obrigatorio && !motivo.trim()} onClick={confirmarAcao}>
                {ACOES[acao].botao}
              </Botao>
            </>
          )
        }
      >
        {acao && (
          <>
            <p className="mb-3 text-sm text-stone-600">{ACOES[acao].texto}</p>
            {nota && acao !== 'problema' && (
              <div className="mb-3">
                <Erro>Este pedido tem NFC-e autorizada. Cancele a nota na tela Fiscal (o prazo é de 30 minutos após a emissão).</Erro>
              </div>
            )}
            <Campo rotulo={ACOES[acao].rotulo}>
              <AreaTexto value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder={ACOES[acao].exemplo} />
            </Campo>
          </>
        )}
      </Modal>
    </>
  )
}
