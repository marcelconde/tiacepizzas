import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, Info, RefreshCw } from 'lucide-react'
import { Abas, Alternar, AreaTexto, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selecao, Selo, Tabela, Vazio, useAviso } from '../components/ui'
import { useConsulta } from '../lib/dados'
import { brl, dataHora, diasAtras, isoDia } from '../lib/formato'
import { cancelarNota, consultarNota, emitirNota } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { ConfigFiscal, NotaFiscal } from '../lib/tipos'
import { Pagina, useAdmin } from './AdminLayout'

const STATUS_NOTA: Record<NotaFiscal['status'], { rotulo: string; cor: string }> = {
  autorizada: { rotulo: 'Autorizada', cor: 'bg-emerald-100 text-emerald-900' },
  processando: { rotulo: 'Processando', cor: 'bg-sky-100 text-sky-900' },
  rejeitada: { rotulo: 'Rejeitada', cor: 'bg-red-100 text-red-900' },
  erro: { rotulo: 'Erro', cor: 'bg-red-100 text-red-900' },
  cancelada: { rotulo: 'Cancelada', cor: 'bg-stone-200 text-stone-700' },
}

type NotaComPedido = NotaFiscal & { pedidos: { numero: number; cliente_nome: string } | null }

function Notas() {
  const aviso = useAviso()
  const [inicio, setInicio] = useState(diasAtras(6))
  const [fim, setFim] = useState(isoDia())
  const [ocupado, setOcupado] = useState('')
  const [cancelando, setCancelando] = useState<NotaComPedido | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const { dados, carregando, erro, recarregar } = useConsulta<NotaComPedido[]>(
    () =>
      supabase
        .from('notas_fiscais')
        .select('*, pedidos(numero, cliente_nome)')
        .gte('criado_em', new Date(`${inicio}T00:00:00`).toISOString())
        .lte('criado_em', new Date(`${fim}T23:59:59.999`).toISOString())
        .order('criado_em', { ascending: false })
        .limit(500),
    [inicio, fim],
  )

  async function executar(id: string, fn: () => Promise<unknown>, sucesso: string) {
    setOcupado(id)
    try {
      await fn()
      aviso.sucesso(sucesso)
      return true
    } catch (e) {
      aviso.erro(mensagemErro(e))
      return false
    } finally {
      setOcupado('')
      recarregar()
    }
  }

  const autorizadas = (dados ?? []).filter((n) => n.status === 'autorizada')

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Entrada type="date" aria-label="De" className="w-auto" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
        <span className="text-sm text-stone-500">até</span>
        <Entrada type="date" aria-label="Até" className="w-auto" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
        <span className="ml-auto text-sm text-stone-600">
          {autorizadas.length} nota(s) autorizada(s) · <b>{brl(autorizadas.reduce((s, n) => s + Number(n.valor ?? 0), 0))}</b>
        </span>
      </div>
      {erro && <Erro>{erro}</Erro>}
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhuma nota no período" texto="As notas aparecem aqui conforme os pedidos são confirmados (emissão automática) ou quando você emite pelo pedido." />
      ) : (
        <Tabela colunas={['Data', 'Pedido', 'NFC-e', 'Situação', 'Valor', '']}>
          {dados.map((n) => (
            <tr key={n.id}>
              <td className="whitespace-nowrap tabular-nums">{dataHora(n.criado_em)}</td>
              <td>
                <b>#{n.pedidos?.numero}</b> <span className="text-stone-500">{n.pedidos?.cliente_nome}</span>
              </td>
              <td className="tabular-nums">{n.numero ? `${n.numero} / série ${n.serie}` : '—'}</td>
              <td>
                <Selo className={STATUS_NOTA[n.status].cor}>{STATUS_NOTA[n.status].rotulo}</Selo>
                {n.ambiente === 'homologacao' && <Selo className="ml-1 bg-amber-100 text-amber-900">Teste</Selo>}
                {n.status !== 'autorizada' && n.mensagem && <span className="mt-0.5 block max-w-xs text-xs text-stone-600">{n.mensagem}</span>}
              </td>
              <td className="tabular-nums">{brl(n.valor)}</td>
              <td className="text-right whitespace-nowrap">
                {n.danfe_url && (
                  <a href={n.danfe_url} target="_blank" rel="noreferrer" className="mr-2 inline-flex items-center gap-1 text-sm font-semibold text-molho-700 hover:underline">
                    DANFE <ExternalLink className="size-3.5" />
                  </a>
                )}
                {n.xml_url && (
                  <a href={n.xml_url} target="_blank" rel="noreferrer" className="mr-2 text-sm font-semibold text-molho-700 hover:underline">
                    XML
                  </a>
                )}
                {(n.status === 'rejeitada' || n.status === 'erro') && (
                  <Botao variante="secundario" tamanho="p" carregando={ocupado === n.id} onClick={() => executar(n.id, () => emitirNota(n.pedido_id), 'NFC-e autorizada')}>
                    Tentar de novo
                  </Botao>
                )}
                {n.status === 'processando' && (
                  <Botao variante="secundario" tamanho="p" carregando={ocupado === n.id} onClick={() => executar(n.id, () => consultarNota(n.id), 'Situação atualizada')}>
                    <RefreshCw className="size-4" /> Consultar
                  </Botao>
                )}
                {n.status === 'autorizada' && (
                  <Botao variante="perigo" tamanho="p" onClick={() => setCancelando(n)}>
                    Cancelar
                  </Botao>
                )}
              </td>
            </tr>
          ))}
        </Tabela>
      )}

      <Modal aberto={cancelando != null} titulo={`Cancelar NFC-e nº ${cancelando?.numero ?? ''}`} onFechar={() => setCancelando(null)} largura="max-w-md">
        <form
          className="space-y-4"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault()
            if (await executar(cancelando!.id, () => cancelarNota(cancelando!.id, justificativa), 'NFC-e cancelada')) {
              setCancelando(null)
              setJustificativa('')
            }
          }}
        >
          <p className="text-sm text-stone-600">A SEFAZ só aceita o cancelamento em até 30 minutos após a emissão. O pedido em si não é cancelado por aqui.</p>
          <Campo rotulo="Justificativa (mínimo de 15 caracteres)">
            <AreaTexto required minLength={15} maxLength={255} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          </Campo>
          <Botao type="submit" variante="perigo" className="w-full" carregando={ocupado === cancelando?.id}>
            Cancelar nota
          </Botao>
        </form>
      </Modal>
    </>
  )
}

function Configurar() {
  const { fiscal, recarregarFiscal } = useAdmin()
  const aviso = useAviso()
  const [f, setF] = useState<ConfigFiscal | null>(fiscal)
  const [salvando, setSalvando] = useState(false)
  useEffect(() => {
    setF(fiscal)
  }, [fiscal])
  if (!f) return <Carregando />

  const campo = (nome: keyof ConfigFiscal) => ({
    value: String(f[nome] ?? ''),
    onChange: (e: { target: { value: string } }) => setF({ ...f, [nome]: e.target.value }),
  })

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const { id: _id, ...valores } = f!
    const { error } = await supabase.from('config_fiscal').update({ ...valores, cnpj: valores.cnpj?.replace(/\D/g, '') || null, aliquota_tributos: Number(valores.aliquota_tributos) || 0 }).eq('id', 1)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Configuração fiscal salva')
    recarregarFiscal()
  }

  const passos = [
    'CNPJ com Inscrição Estadual e credenciamento para NFC-e na SEFAZ do seu estado (a contabilidade faz).',
    'Certificado digital A1 (e-CNPJ) e o CSC (Código de Segurança do Contribuinte), gerado no portal da SEFAZ.',
    'Conta na Focus NFe com a empresa cadastrada: envie lá o certificado A1 e o CSC, e copie os tokens de homologação e de produção.',
    'Tokens gravados como segredos do servidor (FOCUS_NFE_TOKEN_HOMOLOGACAO e FOCUS_NFE_TOKEN_PRODUCAO) — veja o README.',
    'Teste em homologação: emita algumas notas de teste e confira NCM, CFOP e CSOSN com a contabilidade.',
    'Mude o ambiente para produção. A partir daí as notas têm valor fiscal.',
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <form onSubmit={salvar}>
        <Cartao className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-8 gap-y-3 sm:col-span-2">
            <Alternar ativo={f.ativo} onChange={(v) => setF({ ...f, ativo: v })} rotulo="Emissão de NFC-e ligada" />
            <Alternar ativo={f.auto_emitir} onChange={(v) => setF({ ...f, auto_emitir: v })} rotulo="Emitir sozinho ao confirmar o pedido" />
          </div>
          <Campo rotulo="Ambiente" dica="Homologação = testes, sem valor fiscal.">
            <Selecao value={f.ambiente} onChange={(e) => setF({ ...f, ambiente: e.target.value as ConfigFiscal['ambiente'] })}>
              <option value="homologacao">Homologação (testes)</option>
              <option value="producao">Produção (valendo)</option>
            </Selecao>
          </Campo>
          <Campo rotulo="CNPJ">
            <Entrada inputMode="numeric" maxLength={18} {...campo('cnpj')} />
          </Campo>
          <Campo rotulo="Razão social">
            <Entrada {...campo('razao_social')} />
          </Campo>
          <Campo rotulo="Inscrição estadual">
            <Entrada {...campo('inscricao_estadual')} />
          </Campo>

          <h3 className="mt-2 font-semibold sm:col-span-2">Tributação padrão dos produtos</h3>
          <Campo rotulo="NCM padrão" dica="Usado quando o produto não tem NCM próprio.">
            <Entrada required maxLength={8} {...campo('ncm_padrao')} />
          </Campo>
          <Campo rotulo="CFOP padrão">
            <Entrada required maxLength={4} {...campo('cfop_padrao')} />
          </Campo>
          <Campo rotulo="CSOSN padrão" dica="Simples Nacional: 102 (sem ST) ou 500 (com ST).">
            <Entrada required maxLength={3} {...campo('csosn_padrao')} />
          </Campo>
          <Campo rotulo="Origem da mercadoria" dica="0 = nacional.">
            <Entrada required maxLength={1} {...campo('origem_padrao')} />
          </Campo>
          <Campo rotulo="Tributos aproximados (%)" dica="Lei 12.741: percentual impresso no cupom.">
            <Entrada type="number" step="0.01" min="0" max="100" {...campo('aliquota_tributos')} />
          </Campo>
          <div className="flex items-end pb-2">
            <Alternar ativo={f.indicar_entrega} onChange={(v) => setF({ ...f, indicar_entrega: v })} rotulo="Identificar entrega em domicílio na nota" />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Salvar configuração
            </Botao>
          </div>
        </Cartao>
      </form>

      <Cartao className="h-fit p-5">
        <h3 className="font-display text-lg font-semibold">Para emitir nota fiscal</h3>
        <ol className="mt-3 space-y-3 text-sm">
          {passos.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-stone-200 text-xs font-bold">{i + 1}</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <Info className="size-4 shrink-0" />
          Enquanto a emissão estiver desligada, o sistema imprime um cupom simples com o aviso “não é documento fiscal”.
        </p>
      </Cartao>
    </div>
  )
}

export default function Fiscal() {
  const [aba, setAba] = useState<'notas' | 'config'>('notas')
  const { fiscal } = useAdmin()
  return (
    <Pagina titulo="Fiscal" descricao="Notas fiscais de consumidor (NFC-e) emitidas e configuração da emissão.">
      {fiscal && !fiscal.ativo && aba === 'notas' && (
        <div className="mb-4">
          <Erro>A emissão de NFC-e está desligada. Veja o passo a passo na aba Configuração.</Erro>
        </div>
      )}
      <div className="mb-4">
        <Abas atual={aba} onChange={setAba} abas={[{ id: 'notas', rotulo: 'Notas emitidas' }, { id: 'config', rotulo: 'Configuração' }]} />
      </div>
      {aba === 'notas' ? <Notas /> : <Configurar />}
    </Pagina>
  )
}
