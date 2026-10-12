import { Suspense, lazy, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crud } from '../components/Crud'
import { Abas, Alternar, Carregando, Cartao, Erro, Modal, Selo, Vazio, cx, useAviso } from '../components/ui'
import { brl, haQuanto, num, telefone } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Bairro, Configuracoes, Entregador, FaixaEntrega } from '../lib/tipos'
import { Pagina, useAdmin } from './AdminLayout'
import { BotoesExportar } from './Analises'
import { FormPagamento, TabelaAcerto, regraDoMotoboy, useAcerto, type PagamentoInicial } from './Pagamentos'
import { usePeriodo } from './Painel'
import { PontoLoja } from './PontoLoja'
import { exportar } from '../lib/exportar'

const Mapa = lazy(() => import('../components/Mapa'))
const simNao = (v: boolean) => (v ? 'Sim' : 'Não')

function Acerto() {
  const { pode } = useAdmin()
  const { inicio, fim, seletor, texto } = usePeriodo('hoje')
  const { dados, carregando, erro, recarregar } = useAcerto(inicio, fim)
  const [pagar, setPagar] = useState<PagamentoInicial | null>(null)
  const lista = (dados ?? []).filter((e) => e.ativo || e.entregas > 0 || Number(e.pago) > 0)
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {seletor}
        <BotoesExportar
          desativado={!lista.length}
          onExportar={(f) =>
            exportar(f, `acerto_entregas_${inicio}_a_${fim}`, 'Acerto de entregas', texto, [
              {
                titulo: 'Entregadores',
                colunas: ['Entregador', 'Dias', 'Entregas', 'Taxas cobradas (R$)', 'Diárias (R$)', 'Pelas entregas (R$)', 'A receber (R$)', 'Já pago (R$)', 'Falta (R$)'],
                linhas: lista.map((e) => [e.nome, e.dias, e.entregas, Number(e.taxas), Number(e.diarias), Number(e.por_entregas), Number(e.a_receber), Number(e.pago), Number(e.falta)]),
              },
            ])
          }
        />
      </div>
      {erro && <Erro>{erro}</Erro>}
      {!dados ? (
        carregando && <Carregando />
      ) : lista.length === 0 ? (
        <Vazio titulo="Nenhum entregador cadastrado" texto="Cadastre os motoboys na aba Entregadores." />
      ) : (
        <TabelaAcerto acerto={lista} umDia={inicio === fim} aoPagar={pode('financeiro') ? (e) => setPagar({ tipo: 'motoboy', entregador: e.id, valor: Number(e.falta) > 0 ? Number(e.falta) : undefined, data: fim }) : undefined} />
      )}
      {pode('financeiro') && (
        <p className="mt-3 text-sm text-stone-600">
          Os pagamentos feitos ficam em{' '}
          <Link to="/admin/pagamentos" className="font-semibold text-molho-700 hover:underline">
            Pagamentos
          </Link>
          .
        </p>
      )}
      <Modal aberto={pagar != null} titulo="Pagar motoboy" onFechar={() => setPagar(null)} largura="max-w-lg">
        {pagar && (
          <FormPagamento
            inicial={pagar}
            aoRegistrar={() => {
              setPagar(null)
              recarregar()
            }}
          />
        )}
      </Modal>
    </>
  )
}

function Area() {
  const { config, catalogo, recarregar } = useLoja()
  const { pode } = useAdmin()
  const aviso = useAviso()
  if (!config) return <Carregando />

  const podeConfigurar = pode('entregas') || pode('configuracoes')
  const loja = config.loja_lat != null && config.loja_lng != null ? { lat: Number(config.loja_lat), lng: Number(config.loja_lng) } : null
  const raio = catalogo.faixas.length ? Math.max(...catalogo.faixas.map((f) => Number(f.ate_km))) : 0

  async function salvar(valores: Partial<Configuracoes>, sucesso: string) {
    const { error } = await supabase.from('configuracoes').update(valores).eq('id', 1)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso(sucesso)
    recarregar()
  }

  return (
    <div className="space-y-4">
      <Cartao className="p-5">
        <h2 className="font-display text-lg font-semibold">Como a taxa de entrega é calculada</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['bairro', 'Por bairro', 'O cliente escolhe o bairro em uma lista e paga a taxa daquele bairro. Só entrega nos bairros cadastrados.'],
              ['distancia', 'Por distância', 'O sistema localiza o endereço no mapa e cobra conforme a distância da loja até o cliente, pelo caminho das ruas. Passou da última faixa, avisa que não entrega.'],
            ] as const
          ).map(([modo, nome, texto]) => (
            <button
              key={modo}
              type="button"
              disabled={!podeConfigurar}
              aria-pressed={config.modo_entrega === modo}
              onClick={() => config.modo_entrega !== modo && salvar({ modo_entrega: modo }, `Entrega ${nome.toLowerCase()} ativada`)}
              className={cx('rounded-xl border-2 p-4 text-left', config.modo_entrega === modo ? 'border-molho-500 bg-molho-50' : 'border-stone-200 hover:border-stone-300')}
            >
              <span className="flex items-center gap-2 font-semibold">
                {nome} {config.modo_entrega === modo && <Selo className="bg-molho-600 text-white">Em uso</Selo>}
              </span>
              <span className="mt-1 block text-sm text-stone-600">{texto}</span>
            </button>
          ))}
        </div>
      </Cartao>

      {config.modo_entrega === 'bairro' ? (
        <Crud<Bairro>
          tabela="bairros"
          nome="bairro"
          aoMudar={recarregar}
          texto={(b) => b.nome}
          colunas={[
            { rotulo: 'Bairro / região', render: (b) => <b>{b.nome}</b> },
            { rotulo: 'Taxa de entrega', classe: 'tabular-nums', render: (b) => (Number(b.taxa_entrega) > 0 ? brl(b.taxa_entrega) : 'Grátis') },
            { rotulo: 'Tempo extra', render: (b) => `${b.tempo_extra_min} min` },
            { rotulo: 'Atende', render: (b) => simNao(b.ativo) },
          ]}
          campos={[
            { nome: 'nome', rotulo: 'Nome do bairro ou região', obrigatorio: true, inteira: true },
            { nome: 'taxa_entrega', rotulo: 'Taxa de entrega (R$)', tipo: 'moeda', obrigatorio: true, padrao: 0 },
            { nome: 'tempo_extra_min', rotulo: 'Tempo extra (min)', tipo: 'numero', padrao: 0, obrigatorio: true, dica: 'Somado à previsão para bairros distantes.' },
            { nome: 'ativo', rotulo: 'Atendendo este bairro', tipo: 'booleano' },
          ]}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-4">
              <PontoLoja podeEditar={podeConfigurar} />
            </div>
            <Crud<FaixaEntrega>
              tabela="faixas_entrega"
              nome="faixa"
              feminino
              ordem="ate_km"
              aoMudar={recarregar}
              colunas={[
                { rotulo: 'Distância', render: (f) => <b>até {num(f.ate_km)} km</b> },
                { rotulo: 'Taxa', classe: 'tabular-nums', render: (f) => (Number(f.taxa) > 0 ? brl(f.taxa) : 'Grátis') },
                { rotulo: 'Tempo extra', render: (f) => `${f.tempo_extra_min} min` },
                { rotulo: 'Ativa', render: (f) => simNao(f.ativo) },
              ]}
              campos={[
                { nome: 'ate_km', rotulo: 'Até quantos km', tipo: 'numero', obrigatorio: true, dica: 'Distância pelo caminho das ruas, da loja até o cliente. A maior faixa ativa é o limite de atendimento.' },
                { nome: 'taxa', rotulo: 'Taxa de entrega (R$)', tipo: 'moeda', obrigatorio: true, padrao: 0 },
                { nome: 'tempo_extra_min', rotulo: 'Tempo extra (min)', tipo: 'numero', padrao: 0, obrigatorio: true },
                { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano' },
              ]}
            />
          </div>
          {loja && (
            <div>
              <Suspense fallback={<Carregando />}>
                <Mapa marcadores={[{ id: 'loja', ponto: loja, tipo: 'loja', rotulo: config.nome_loja }]} circulosKm={catalogo.faixas.map((f) => Number(f.ate_km))} className="h-[28rem]" />
              </Suspense>
              <p className="mt-1 text-xs text-stone-500">
                Os círculos mostram cada faixa em linha reta, só para dar uma ideia (a maior vai até {num(raio)} km). A taxa usa a distância pelo caminho das ruas, que é igual ou maior: um endereço dentro de um círculo pode
                cair na faixa seguinte. Passou da última faixa, o cliente vê “Este endereço está fora da nossa área de entrega.”
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Entregadores() {
  const { config, recarregar } = useLoja()
  const { pode, ehAdmin } = useAdmin()
  const aviso = useAviso()
  async function rastreio(v: boolean) {
    const { error } = await supabase.from('configuracoes').update({ rastreio_motoboy: v }).eq('id', 1)
    if (error) return aviso.erro(mensagemErro(error))
    recarregar()
  }
  return (
    <>
      <Cartao className="mb-4 space-y-2 p-5 text-sm">
        <h2 className="font-display text-lg font-semibold">Aplicativo do motoboy e rastreamento</h2>
        <p className="text-stone-600">
          O motoboy entra em <b>{location.host}/entregador</b> pelo celular, vê só as entregas atribuídas a ele e avisa quando sai, entrega ou tem um problema. Com a entrega na rua, o
          celular envia a posição e o cliente acompanha no mapa.
        </p>
        <p className="text-stone-600">
          Para dar acesso, crie o usuário com a função <b>Motoboy</b> em {ehAdmin ? <Link to="/admin/configuracoes" className="font-semibold text-molho-700 hover:underline">Configurações → Usuários</Link> : 'Configurações → Usuários (peça à administradora)'}. Ele já aparece nesta lista, ligado ao login.
        </p>
        <p className="text-stone-600">
          Cada motoboy tem a sua regra de pagamento: uma <b>diária</b> por dia trabalhado mais o valor das entregas (a taxa cobrada do cliente ou um valor fixo). O que cada um tem a receber aparece na aba
          Acerto de entregas e em Pagamentos.
        </p>
        <Alternar ativo={Boolean(config?.rastreio_motoboy)} disabled={!pode('entregas')} onChange={rastreio} rotulo="Mostrar a posição do motoboy para o cliente" />
      </Cartao>
      <Crud<Entregador>
        tabela="entregadores"
        nome="entregador"
        colunas={[
          { rotulo: 'Nome', render: (e) => <b>{e.nome}</b> },
          { rotulo: 'Telefone', render: (e) => telefone(e.telefone) },
          { rotulo: 'Como recebe', render: (e) => regraDoMotoboy(e) },
          { rotulo: 'Aplicativo', render: (e) => (e.usuario_id ? <Selo className="bg-emerald-100 text-emerald-900">Com acesso</Selo> : <Selo className="bg-stone-100 text-stone-600">Sem login</Selo>) },
          { rotulo: 'Última posição', render: (e) => (e.posicao_em ? `há ${haQuanto(e.posicao_em)}` : '—') },
          { rotulo: 'Ativo', render: (e) => simNao(e.ativo) },
        ]}
        campos={[
          { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
          { nome: 'telefone', rotulo: 'Telefone' },
          { nome: 'diaria', rotulo: 'Diária (R$)', tipo: 'moeda', padrao: 50, obrigatorio: true, dica: 'Valor fixo por dia trabalhado. Use 0 se ele não recebe diária.' },
          {
            nome: 'repasse', rotulo: 'Pelas entregas, ele recebe', tipo: 'selecao', obrigatorio: true, padrao: 'taxa',
            opcoes: [{ valor: 'taxa', rotulo: 'A taxa de entrega de cada pedido' }, { valor: 'fixo', rotulo: 'Um valor fixo por entrega' }],
          },
          { nome: 'valor_por_entrega', rotulo: 'Valor fixo por entrega (R$)', tipo: 'moeda', padrao: 0, obrigatorio: true, dica: 'Só vale na opção “um valor fixo por entrega”.' },
          { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
        ]}
      />
    </>
  )
}

export default function Entregas() {
  const [aba, setAba] = useState<'area' | 'entregadores' | 'acerto'>('area')
  return (
    <Pagina titulo="Entregas" descricao="Área de atendimento, taxas, entregadores e acerto.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'area', rotulo: 'Área e taxas' },
            { id: 'entregadores', rotulo: 'Entregadores' },
            { id: 'acerto', rotulo: 'Acerto de entregas' },
          ]}
        />
      </div>
      {aba === 'area' && <Area />}
      {aba === 'entregadores' && <Entregadores />}
      {aba === 'acerto' && <Acerto />}
    </Pagina>
  )
}
