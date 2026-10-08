import { Suspense, lazy, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { Crud } from '../components/Crud'
import { Abas, Alternar, Botao, Campo, Carregando, Cartao, Entrada, Erro, Selo, Tabela, Vazio, cx, useAviso } from '../components/ui'
import { brl, haQuanto, num, telefone } from '../lib/formato'
import { localizarEndereco } from '../lib/geo'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Bairro, Configuracoes, Entregador, FaixaEntrega } from '../lib/tipos'
import { Pagina, useAdmin } from './AdminLayout'
import { BotoesExportar } from './Analises'
import { usePeriodo, useRelatorio } from './Painel'
import { exportar } from '../lib/exportar'

const Mapa = lazy(() => import('../components/Mapa'))
const simNao = (v: boolean) => (v ? 'Sim' : 'Não')

function Acerto() {
  const { inicio, fim, seletor, texto } = usePeriodo('hoje')
  const { dados: r, carregando, erro } = useRelatorio(inicio, fim)
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {seletor}
        <BotoesExportar
          desativado={!r?.por_entregador.length}
          onExportar={(f) =>
            exportar(f, `acerto_entregas_${inicio}_a_${fim}`, 'Acerto de entregas', texto, [
              { titulo: 'Entregadores', colunas: ['Entregador', 'Entregas', 'Taxas cobradas (R$)', 'A pagar (R$)'], linhas: (r?.por_entregador ?? []).map((e) => [e.nome, e.entregas, Number(e.taxas), Number(e.a_pagar)]) },
            ])
          }
        />
      </div>
      {erro && <Erro>{erro}</Erro>}
      {!r ? (
        carregando && <Carregando />
      ) : r.por_entregador.length === 0 ? (
        <Vazio titulo="Nenhuma entrega com entregador definido no período" texto="Defina o motoboy ao abrir o pedido para que ele apareça no acerto." />
      ) : (
        <Tabela colunas={['Entregador', 'Entregas', 'Taxas cobradas dos clientes', 'A pagar ao entregador']}>
          {r.por_entregador.map((e) => (
            <tr key={e.nome}>
              <td className="font-semibold">{e.nome}</td>
              <td className="tabular-nums">{e.entregas}</td>
              <td className="tabular-nums">{brl(e.taxas)}</td>
              <td className="font-semibold tabular-nums">{brl(e.a_pagar)}</td>
            </tr>
          ))}
        </Tabela>
      )}
      <p className="mt-3 text-xs text-stone-500">O valor a pagar é “entregas × valor por entrega” do cadastro do entregador. Lance o pagamento em Financeiro → Saídas, na categoria Motoboys.</p>
    </>
  )
}

function Area() {
  const { config, catalogo, recarregar } = useLoja()
  const { pode } = useAdmin()
  const aviso = useAviso()
  const [ocupado, setOcupado] = useState(false)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  if (!config) return <Carregando />

  const podeConfigurar = pode('entregas') || pode('configuracoes')
  const loja = config.loja_lat != null && config.loja_lng != null ? { lat: Number(config.loja_lat), lng: Number(config.loja_lng) } : null
  const raio = catalogo.faixas.length ? Math.max(...catalogo.faixas.map((f) => Number(f.ate_km))) : 0

  async function salvar(valores: Partial<Configuracoes>, sucesso: string) {
    setOcupado(true)
    const { error } = await supabase.from('configuracoes').update(valores).eq('id', 1)
    setOcupado(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso(sucesso)
    recarregar()
  }

  async function localizarLoja() {
    if (!config?.logradouro) return aviso.erro('Preencha o endereço da loja em Configurações → Loja.')
    setOcupado(true)
    const p = await localizarEndereco({ logradouro: config.logradouro, numero: config.numero, bairro: config.bairro, cidade: config.cidade, uf: config.uf })
    setOcupado(false)
    if (!p) return aviso.erro('Não encontramos o endereço da loja no mapa. Informe a latitude e a longitude manualmente.')
    salvar({ loja_lat: p.lat, loja_lng: p.lng }, 'Loja localizada no mapa')
  }

  return (
    <div className="space-y-4">
      <Cartao className="p-5">
        <h2 className="font-display text-lg font-semibold">Como a taxa de entrega é calculada</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['bairro', 'Por bairro', 'O cliente escolhe o bairro em uma lista e paga a taxa daquele bairro. Só entrega nos bairros cadastrados.'],
              ['distancia', 'Por distância', 'O sistema localiza o endereço no mapa e cobra conforme a distância até a loja. Fora do raio máximo, avisa que não entrega.'],
            ] as const
          ).map(([modo, nome, texto]) => (
            <button
              key={modo}
              type="button"
              disabled={!podeConfigurar || ocupado}
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
            <Cartao className="mb-4 p-5">
              <h2 className="font-display text-lg font-semibold">Ponto da loja</h2>
              <p className="mt-1 text-sm text-stone-600">As distâncias são medidas em linha reta a partir deste ponto.</p>
              {loja ? (
                <p className="mt-2 text-sm">
                  <MapPin className="mr-1 inline size-4" />
                  {num(loja.lat)}, {num(loja.lng)} · raio máximo de atendimento: <b>{num(raio)} km</b>
                </p>
              ) : (
                <div className="mt-3">
                  <Erro>A loja ainda não foi localizada. Sem isso, os clientes não conseguem pedir entrega por distância.</Erro>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Botao variante="secundario" carregando={ocupado} disabled={!podeConfigurar} onClick={localizarLoja}>
                  <MapPin className="size-4" /> Localizar pelo endereço da loja
                </Botao>
                <Campo rotulo="Latitude" className="w-28">
                  <Entrada inputMode="decimal" placeholder="-23.5505" value={lat} onChange={(e) => setLat(e.target.value)} />
                </Campo>
                <Campo rotulo="Longitude" className="w-28">
                  <Entrada inputMode="decimal" placeholder="-46.6333" value={lng} onChange={(e) => setLng(e.target.value)} />
                </Campo>
                <Botao
                  variante="secundario"
                  disabled={!podeConfigurar || !Number(lat.replace(',', '.')) || !Number(lng.replace(',', '.'))}
                  onClick={() => salvar({ loja_lat: Number(lat.replace(',', '.')), loja_lng: Number(lng.replace(',', '.')) }, 'Ponto da loja salvo')}
                >
                  Usar estas coordenadas
                </Botao>
              </div>
            </Cartao>
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
                { nome: 'ate_km', rotulo: 'Até quantos km', tipo: 'numero', obrigatorio: true, dica: 'A maior faixa ativa define o raio máximo de atendimento.' },
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
              <p className="mt-1 text-xs text-stone-500">Cada círculo é uma faixa de entrega. Endereços fora do círculo maior recebem o aviso “Este endereço está fora da nossa área de entrega.”</p>
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
        <Alternar ativo={Boolean(config?.rastreio_motoboy)} disabled={!pode('entregas')} onChange={rastreio} rotulo="Mostrar a posição do motoboy para o cliente" />
      </Cartao>
      <Crud<Entregador>
        tabela="entregadores"
        nome="entregador"
        colunas={[
          { rotulo: 'Nome', render: (e) => <b>{e.nome}</b> },
          { rotulo: 'Telefone', render: (e) => telefone(e.telefone) },
          { rotulo: 'Recebe por entrega', classe: 'tabular-nums', render: (e) => brl(e.valor_por_entrega) },
          { rotulo: 'Aplicativo', render: (e) => (e.usuario_id ? <Selo className="bg-emerald-100 text-emerald-900">Com acesso</Selo> : <Selo className="bg-stone-100 text-stone-600">Sem login</Selo>) },
          { rotulo: 'Última posição', render: (e) => (e.posicao_em ? `há ${haQuanto(e.posicao_em)}` : '—') },
          { rotulo: 'Ativo', render: (e) => simNao(e.ativo) },
        ]}
        campos={[
          { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
          { nome: 'telefone', rotulo: 'Telefone' },
          { nome: 'valor_por_entrega', rotulo: 'Valor pago por entrega (R$)', tipo: 'moeda', padrao: 0, obrigatorio: true },
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
