import { Suspense, lazy, useState } from 'react'
import { ExternalLink, LocateFixed, MapPin } from 'lucide-react'
import { Botao, Campo, Carregando, Cartao, Entrada, Erro, useAviso } from '../components/ui'
import { distanciaKm, lerCoordenadas, localizarEndereco, type Ponto } from '../lib/geo'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'

const Mapa = lazy(() => import('../components/Mapa'))

/**
 * Onde a loja fica no mapa. É deste ponto que a distância de cada entrega é medida e é ele que o cliente vê
 * no acompanhamento — por isso o ajuste fino: achar pelo endereço costuma errar por uma esquina.
 */
export function PontoLoja({ podeEditar }: { podeEditar: boolean }) {
  const { config, recarregar } = useLoja()
  const aviso = useAviso()
  const [ocupado, setOcupado] = useState('')
  const [novo, setNovo] = useState<Ponto | null>(null) // ponto em ajuste, ainda não salvo
  const [origem, setOrigem] = useState('')
  const [colado, setColado] = useState('')
  const [centro, setCentro] = useState(0) // muda quando o pino "pula": o mapa é centralizado de novo
  if (!config) return <Carregando />

  const salvo = config.loja_lat != null && config.loja_lng != null ? { lat: Number(config.loja_lat), lng: Number(config.loja_lng) } : null
  const ponto = novo ?? salvo
  const moveu = novo && salvo ? Math.round(distanciaKm(novo, salvo) * 1000) : null

  function propor(p: Ponto, texto: string, centralizar = true) {
    setNovo(p)
    setOrigem(texto)
    if (centralizar) setCentro((n) => n + 1)
  }

  function pelaLocalizacao() {
    if (!navigator.geolocation) return aviso.erro('Este aparelho não informa a localização.')
    setOcupado('gps')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOcupado('')
        const metros = Math.round(pos.coords.accuracy)
        propor(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          metros <= 30
            ? `Este é o lugar onde este aparelho está (precisão de uns ${metros} metros).`
            : `Este é o lugar onde este aparelho está, mas com pouca precisão (uns ${metros} metros). Arraste o pino até a porta da loja.`,
        )
      },
      () => {
        setOcupado('')
        aviso.erro('Não foi possível ler a localização. Permita o acesso à localização no navegador e tente de novo.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  async function peloEndereco() {
    if (!config?.logradouro) return aviso.erro('Preencha o endereço da loja em Configurações → Loja.')
    setOcupado('endereco')
    const p = await localizarEndereco({ logradouro: config.logradouro, numero: config.numero, bairro: config.bairro, cidade: config.cidade, uf: config.uf })
    setOcupado('')
    if (!p) return aviso.erro('Não encontramos o endereço da loja no mapa. Use um dos outros jeitos.')
    propor(p, p.aproximado ? `O número não está no mapa: o ponto é ${p.aproximado === 'rua' ? 'o da rua' : 'o do bairro'}. Arraste o pino até a porta da loja.` : 'Este é o ponto achado pelo endereço. Ele costuma cair perto, mas não na porta: confira e arraste o pino.')
  }

  function peloTextoColado() {
    const p = lerCoordenadas(colado)
    if (!p) return aviso.erro('Não entendi. Cole os dois números copiados do Google Maps, por exemplo: -7.99850, -34.84403')
    propor(p, 'Este é o ponto colado do Google Maps.')
    setColado('')
  }

  async function salvar() {
    if (!novo) return
    setOcupado('salvar')
    const { error } = await supabase
      .from('configuracoes')
      .update({ loja_lat: Number(novo.lat.toFixed(6)), loja_lng: Number(novo.lng.toFixed(6)) })
      .eq('id', 1)
    setOcupado('')
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Ponto da loja salvo')
    setNovo(null)
    recarregar()
  }

  return (
    <Cartao className="p-5">
      <h2 className="font-display text-lg font-semibold">Ponto da loja no mapa</h2>
      <p className="mt-1 text-sm text-stone-600">
        A distância de cada entrega é medida pelo caminho das ruas, saindo deste ponto, e é ele que o cliente vê no mapa. Deixe o pino em cima da porta da loja.
      </p>

      {ponto ? (
        <div className="mt-3">
          <Suspense fallback={<Carregando />}>
            <Mapa
              key={centro}
              zoom={18}
              className="h-72"
              marcadores={[
                {
                  id: 'loja', ponto, tipo: 'loja', rotulo: podeEditar ? 'Arraste até a porta da loja' : config.nome_loja,
                  ...(podeEditar ? { aoArrastar: (p: Ponto) => propor(p, 'Você arrastou o pino.', false) } : {}),
                },
              ]}
            />
          </Suspense>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-stone-500">
            {podeEditar && <span>Use o + para aproximar e arraste a pizza até a porta da loja.</span>}
            <a href={`https://www.google.com/maps/search/?api=1&query=${ponto.lat},${ponto.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-forno-600 hover:underline">
              Conferir este ponto no Google Maps <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <Erro>A loja ainda não foi marcada no mapa. Sem isso, a entrega por distância não funciona e o cliente não vê a loja no mapa.</Erro>
        </div>
      )}

      {novo && (
        <div role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>
            <b>Ponto novo, ainda não salvo.</b> {origem}
            {moveu != null && ` Fica a ${moveu} metros do ponto salvo hoje.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Botao variante="verde" carregando={ocupado === 'salvar'} onClick={salvar}>
              Salvar este ponto
            </Botao>
            <Botao variante="secundario" onClick={() => { setNovo(null); setCentro((n) => n + 1) }}>
              Desfazer
            </Botao>
          </div>
        </div>
      )}

      {podeEditar && (
        <div className="mt-4 space-y-3 border-t border-stone-200 pt-4 text-sm">
          <p className="font-semibold">Outros jeitos de marcar o ponto</p>
          <div className="flex flex-wrap items-center gap-2">
            <Botao variante="secundario" carregando={ocupado === 'gps'} onClick={pelaLocalizacao}>
              <LocateFixed className="size-4" /> Estou na loja: usar a localização deste aparelho
            </Botao>
            <Botao variante="secundario" carregando={ocupado === 'endereco'} onClick={peloEndereco}>
              <MapPin className="size-4" /> Achar pelo endereço
            </Botao>
          </div>
          <div>
            <div className="flex flex-wrap items-end gap-2">
              <Campo rotulo="Colar do Google Maps" className="min-w-0 flex-1 basis-64">
                <Entrada placeholder="-7.99850, -34.84403" value={colado} onChange={(e) => setColado(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), peloTextoColado())} />
              </Campo>
              <Botao variante="secundario" disabled={!colado.trim()} onClick={peloTextoColado}>
                Usar este ponto
              </Botao>
            </div>
            <p className="mt-1 text-xs text-stone-500">No Google Maps, toque e segure em cima da loja (no computador, clique com o botão direito) e copie os números que aparecem.</p>
          </div>
        </div>
      )}
    </Cartao>
  )
}
