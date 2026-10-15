import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3, Bell, BellOff, BellRing, Bike, BookOpen, ClipboardList, FileText, HandCoins, History, KeyRound, LayoutTemplate, LineChart, LogOut, Menu, Package,
  PlusCircle, Settings, Users, Volume2, VolumeX, Wallet, Wallet2, Wifi, WifiOff, X, type LucideIcon,
} from 'lucide-react'
import { Login, Moldura, TrocarSenha } from '../components/Login'
import { Logo } from '../components/Logo'
import { Botao, Carregando, cx, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { PAPEIS, STATUS, haQuanto } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { aceitarPedido, alteradoAquiAgora } from '../lib/pedidos'
import { mensagemErro, recuperacao, supabase } from '../lib/supabase'
import type { ConfigFiscal, Configuracoes, StatusPedido, TipoPedido } from '../lib/tipos'

// ------------------------------------------------------------------ módulos e menu
export type Modulo =
  | 'painel' | 'pedidos' | 'clientes' | 'cardapio' | 'estoque' | 'caixa' | 'entregas' | 'financeiro' | 'analises'
  | 'conteudo' | 'fiscal' | 'auditoria' | 'configuracoes'

interface ItemMenu {
  para: string
  rotulo: string
  icone: LucideIcon
  modulo: Modulo
}
export const MENU: ItemMenu[] = [
  { para: '/admin/painel', rotulo: 'Painel', icone: BarChart3, modulo: 'painel' },
  { para: '/admin/pedidos', rotulo: 'Pedidos', icone: ClipboardList, modulo: 'pedidos' },
  { para: '/admin/pdv', rotulo: 'Novo pedido', icone: PlusCircle, modulo: 'pedidos' },
  { para: '/admin/clientes', rotulo: 'Clientes', icone: Users, modulo: 'clientes' },
  { para: '/admin/cardapio', rotulo: 'Cardápio', icone: BookOpen, modulo: 'cardapio' },
  { para: '/admin/conteudo', rotulo: 'Site e promoções', icone: LayoutTemplate, modulo: 'conteudo' },
  { para: '/admin/estoque', rotulo: 'Estoque', icone: Package, modulo: 'estoque' },
  { para: '/admin/caixa', rotulo: 'Caixa', icone: Wallet, modulo: 'caixa' },
  { para: '/admin/entregas', rotulo: 'Entregas', icone: Bike, modulo: 'entregas' },
  { para: '/admin/pagamentos', rotulo: 'Pagamentos', icone: HandCoins, modulo: 'financeiro' },
  { para: '/admin/financeiro', rotulo: 'Financeiro', icone: Wallet2, modulo: 'financeiro' },
  { para: '/admin/analises', rotulo: 'Análises', icone: LineChart, modulo: 'analises' },
  { para: '/admin/fiscal', rotulo: 'Fiscal', icone: FileText, modulo: 'fiscal' },
  { para: '/admin/auditoria', rotulo: 'Auditoria', icone: History, modulo: 'auditoria' },
  { para: '/admin/configuracoes', rotulo: 'Configurações', icone: Settings, modulo: 'configuracoes' },
]

/** Nomes dos módulos na tela de permissões (um por linha da matriz). */
export const MODULOS: { id: Modulo; rotulo: string; descricao: string }[] = [
  { id: 'painel', rotulo: 'Painel', descricao: 'Indicadores e gráficos de faturamento' },
  { id: 'pedidos', rotulo: 'Pedidos', descricao: 'Quadro de pedidos, histórico, novo pedido e registro de desperdício' },
  { id: 'clientes', rotulo: 'Clientes', descricao: 'Cadastro e histórico de clientes' },
  { id: 'cardapio', rotulo: 'Cardápio', descricao: 'Produtos, preços e ficha técnica' },
  { id: 'conteudo', rotulo: 'Site e promoções', descricao: 'Banners, textos, promoções e cupons' },
  { id: 'estoque', rotulo: 'Estoque', descricao: 'Insumos, entradas e perdas' },
  { id: 'caixa', rotulo: 'Caixa', descricao: 'Abertura, sangria e fechamento' },
  { id: 'entregas', rotulo: 'Entregas', descricao: 'Área de entrega, taxas e entregadores' },
  { id: 'financeiro', rotulo: 'Financeiro e pagamentos', descricao: 'Despesas, pagamentos à equipe, resultado e relatórios' },
  { id: 'analises', rotulo: 'Análises', descricao: 'Rankings de clientes e produtos' },
  { id: 'fiscal', rotulo: 'Fiscal', descricao: 'Notas fiscais e configuração' },
  { id: 'auditoria', rotulo: 'Auditoria', descricao: 'Registro de alterações' },
  { id: 'configuracoes', rotulo: 'Configurações', descricao: 'Loja, horários, metas e impressão' },
]

// ------------------------------------------------------------------ contexto do painel
interface Admin {
  fiscal: ConfigFiscal | null
  recarregarFiscal: () => Promise<void>
  novos: number
  pode: (modulo: Modulo) => boolean
  ehAdmin: boolean
  /** Avisa a tela sempre que algum pedido mudar (tempo real, com reforço periódico). */
  aoMudarPedidos: (fn: () => void) => () => void
  /** Atualiza contadores e telas na hora, sem esperar o tempo real (use depois de alterar um pedido). */
  sincronizar: () => void
}
const Contexto = createContext<Admin>({
  fiscal: null, recarregarFiscal: async () => {}, novos: 0, pode: () => false, ehAdmin: false, aoMudarPedidos: () => () => {}, sincronizar: () => {},
})
export const useAdmin = () => useContext(Contexto)

/** Recarrega a tela quando os pedidos mudam. */
export function usePedidosAoVivo(fn: () => void) {
  const { aoMudarPedidos } = useAdmin()
  const atual = useRef(fn)
  atual.current = fn
  useEffect(() => aoMudarPedidos(() => atual.current()), [aoMudarPedidos])
}

export type NivelAtraso = 'atencao' | 'atrasado' | 'critico'
export const ATRASO: Record<NivelAtraso, { rotulo: string; cor: string; borda: string }> = {
  atencao: { rotulo: 'Atenção', cor: 'bg-amber-100 text-amber-900', borda: 'border-amber-400' },
  atrasado: { rotulo: 'Atrasado', cor: 'bg-orange-200 text-orange-950', borda: 'border-orange-500' },
  critico: { rotulo: 'Crítico', cor: 'bg-red-600 text-white', borda: 'border-red-600' },
}

/** Há quanto tempo o pedido está parado na mesma etapa, conforme os limites de Configurações → Pedidos. */
export function nivelAtraso(statusEm: string, config: Configuracoes | null): NivelAtraso | null {
  const a = config?.alertas_pedido
  if (!a) return null
  const min = (Date.now() - new Date(statusEm).getTime()) / 60000
  return min >= a.critico ? 'critico' : min >= a.atrasado ? 'atrasado' : min >= a.atencao ? 'atencao' : null
}

// ------------------------------------------------------------------ sons
// Cada aviso tem o seu som, feitos para serem ouvidos numa cozinha barulhenta: ondas "ásperas", volume alto e o
// desenho repetido. Quanto mais grave a situação, mais rápido e insistente.
type Nota = [frequencia: number, inicio: number, duracao: number] // em hertz e segundos
const repetir = (notas: Nota[], vezes: number, intervalo: number): Nota[] =>
  Array.from({ length: vezes }, (_, i) => notas.map(([f, t, d]): Nota => [f, t + i * intervalo, d])).flat()

export type Som = 'novo' | 'entregue' | 'atencao' | 'atrasado' | 'critico' | 'problema'
const SONS: Record<Som, { onda: OscillatorType; volume: number; notas: Nota[] }> = {
  novo: { onda: 'sine', volume: 0.35, notas: [[880, 0, 0.2], [880, 0.25, 0.2], [1175, 0.5, 0.25]] },
  // "plim-plim-plim" subindo, duas vezes
  entregue: { onda: 'triangle', volume: 0.6, notas: repetir([[1047, 0, 0.14], [1319, 0.15, 0.14], [1568, 0.3, 0.32]], 2, 0.75) },
  // "dim-dom", duas vezes
  atencao: { onda: 'triangle', volume: 0.6, notas: repetir([[988, 0, 0.3], [784, 0.35, 0.45]], 2, 0.95) },
  // sirene de dois tons, quatro vezes
  atrasado: { onda: 'square', volume: 0.2, notas: repetir([[880, 0, 0.22], [622, 0.25, 0.22]], 4, 0.5) },
  // bipes agudos e rápidos, como alarme
  critico: { onda: 'square', volume: 0.25, notas: repetir([[1480, 0, 0.08], [1480, 0.12, 0.08], [1480, 0.24, 0.08], [1480, 0.36, 0.08]], 4, 0.6) },
  // dois tons descendo, graves
  problema: { onda: 'square', volume: 0.2, notas: repetir([[740, 0, 0.3], [494, 0.35, 0.45]], 2, 0.95) },
}
export const NOME_DO_SOM: Record<Som, string> = {
  novo: 'Pedido novo', entregue: 'Pedido entregue', atencao: 'Atenção', atrasado: 'Atrasado', critico: 'Crítico', problema: 'Problema na entrega',
}
const duracaoDo = (som: Som) => Math.max(...SONS[som].notas.map(([, inicio, duracao]) => inicio + duracao))

export function tocarAlerta(som: Som = 'novo') {
  try {
    const ctx = new AudioContext()
    const { onda, volume, notas } = SONS[som]
    for (const [frequencia, inicio, duracao] of notas) {
      const osc = ctx.createOscillator()
      const ganho = ctx.createGain()
      const t0 = ctx.currentTime + inicio
      osc.type = onda
      osc.frequency.value = frequencia
      ganho.gain.setValueAtTime(0.0001, t0)
      ganho.gain.exponentialRampToValueAtTime(volume, t0 + 0.01)
      ganho.gain.setValueAtTime(volume, t0 + duracao * 0.6)
      ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao)
      osc.connect(ganho).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + duracao + 0.02)
    }
    setTimeout(() => ctx.close(), (duracaoDo(som) + 0.5) * 1000)
  } catch {
    /* navegador bloqueou o áudio antes de qualquer clique */
  }
}

/** Vários avisos na mesma conferência: um som depois do outro, do mais grave para o mais leve, nunca encavalados. */
const PRIORIDADE: Som[] = ['critico', 'problema', 'atrasado', 'novo', 'atencao', 'entregue']
function tocarEmSequencia(sons: Set<Som>) {
  let espera = 0
  for (const som of PRIORIDADE.filter((s) => sons.has(s))) {
    setTimeout(() => tocarAlerta(som), espera * 1000)
    espera += duracaoDo(som) + 0.5
  }
}

// avisos do computador (aparecem mesmo com o painel minimizado ou em outra aba); a pessoa liga pelo sino do menu
const temAvisosDoSistema = typeof window !== 'undefined' && 'Notification' in window
const avisosLigados = () => temAvisosDoSistema && Notification.permission === 'granted' && localStorage.getItem('tiace.avisos') !== 'nao'

function avisarNoComputador(titulo: string, texto: string, marca: string) {
  if (!document.hidden || !avisosLigados()) return // com o painel à vista, o aviso na tela já basta
  try {
    const n = new Notification(titulo, { body: texto, tag: marca, icon: '/icone-192.png' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* celular: o navegador só mostra avisos de sites instalados como aplicativo */
  }
}

interface PedidoAberto {
  id: string
  numero: number
  status: StatusPedido
  tipo: TipoPedido
  status_em: string
  cliente_nome: string
  entregadores: { nome: string } | null
}
const PESO: Record<NivelAtraso, number> = { atencao: 1, atrasado: 2, critico: 3 }
const EM_ANDAMENTO: StatusPedido[] = ['novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'problema_entrega']

// ------------------------------------------------------------------ layout
export default function AdminLayout() {
  const { sessao, perfil, carregando, sair } = useAuth()
  const { config } = useLoja()
  const aviso = useAviso()
  const { pathname } = useLocation()
  const [fiscal, setFiscal] = useState<ConfigFiscal | null>(null)
  const [modulos, setModulos] = useState<Set<string> | null>(null)
  const [novos, setNovos] = useState(0)
  const [aoVivo, setAoVivo] = useState(false)
  const [som, setSom] = useState(() => localStorage.getItem('tiace.som') !== 'nao')
  const [avisos, setAvisos] = useState<'ligados' | 'desligados' | 'bloqueados'>(() =>
    !temAvisosDoSistema ? 'desligados' : Notification.permission === 'denied' ? 'bloqueados' : avisosLigados() ? 'ligados' : 'desligados',
  )
  // pedidos em andamento como estavam na conferência anterior: etapa e nível de atraso
  const vistos = useRef<Map<string, { status: StatusPedido; nivel: NivelAtraso | null }> | null>(null)
  const novosAvisados = useRef(new Set<string>()) // pedido novo avisa uma vez só (pelo tempo real ou pela conferência)
  const [menu, setMenu] = useState(false)
  const [trocarSenha, setTrocarSenha] = useState(false)
  const ouvintes = useRef(new Set<() => void>())
  const refs = useRef({ config, fiscal, som })
  refs.current = { config, fiscal, som }

  const interno = Boolean(perfil?.ativo) && perfil!.papel !== 'motoboy'
  const ehAdmin = interno && perfil!.papel === 'admin'
  const papel = perfil?.papel
  const pode = useCallback((m: Modulo) => ehAdmin || Boolean(modulos?.has(m)), [ehAdmin, modulos])
  const atendimento = pode('pedidos')

  const recarregarFiscal = useCallback(async () => {
    const { data } = await supabase.from('config_fiscal').select('*').single()
    setFiscal(data as ConfigFiscal | null)
  }, [])

  const contarNovos = useCallback(async () => {
    const { count } = await supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('status', 'novo')
    setNovos(count ?? 0)
  }, [])

  const aoMudarPedidos = useCallback((fn: () => void) => {
    ouvintes.current.add(fn)
    return () => void ouvintes.current.delete(fn)
  }, [])

  const sincronizar = useCallback(() => {
    contarNovos()
    ouvintes.current.forEach((fn) => fn())
  }, [contarNovos])

  /**
   * Avisos com som a cada conferência (tempo real ou a cada 45 s): pedido que passou de nível de atraso (atenção,
   * atrasado, crítico), entrega concluída ou problema registrado pelo motoboy no aplicativo e pedido novo que o tempo
   * real não avisou. Compara com a conferência anterior; o que este painel mesmo mudou não avisa.
   */
  const conferirPedidos = useCallback(async () => {
    const desde = new Date(Date.now() - 12 * 3600_000).toISOString()
    const { data, error } = await supabase
      .from('pedidos')
      .select('id, numero, status, tipo, status_em, cliente_nome, entregadores(nome)')
      .in('status', [...EM_ANDAMENTO, 'entregue'])
      .gte('status_em', desde)
    if (error || !data) return
    const { config, fiscal } = refs.current
    const lista = data as unknown as PedidoAberto[]
    const antes = vistos.current
    vistos.current = new Map(lista.map((p) => [p.id, { status: p.status, nivel: p.status === 'entregue' ? null : nivelAtraso(p.status_em, config) }]))
    if (!antes) {
      // primeira conferência (painel acabou de abrir): só memoriza; o quadro já mostra o que está atrasado
      lista.forEach((p) => p.status === 'novo' && novosAvisados.current.add(p.id))
      return
    }
    const sons = new Set<Som>()
    const atrasos: { p: PedidoAberto; nivel: NivelAtraso }[] = []
    for (const p of lista) {
      const anterior = antes.get(p.id)
      const agora = vistos.current.get(p.id)!
      const motoboy = p.entregadores?.nome ?? 'O motoboy'
      if (p.status === 'novo' && !novosAvisados.current.has(p.id)) {
        novosAvisados.current.add(p.id)
        sons.add('novo')
        aviso.sucesso(`Chegou o pedido #${p.numero}!`)
        avisarNoComputador(`Chegou o pedido #${p.numero}!`, 'Abra o painel para aceitar.', `novo-${p.id}`)
        if (config?.auto_aceitar) aceitarPedido(p.id, config, fiscal).then((a) => a?.forEach((x) => aviso.erro(x)), (e) => aviso.erro(mensagemErro(e)))
      }
      if (!anterior || alteradoAquiAgora(p.id)) continue
      if (anterior.status !== p.status) {
        if (p.tipo === 'entrega' && p.status === 'entregue' && ['pronto', 'saiu_entrega', 'problema_entrega'].includes(anterior.status)) {
          sons.add('entregue')
          aviso.sucesso(`Pedido #${p.numero} entregue! ${motoboy} concluiu a entrega para ${p.cliente_nome}.`, 15_000)
          avisarNoComputador(`Pedido #${p.numero} entregue`, `${motoboy} concluiu a entrega para ${p.cliente_nome}.`, `pedido-${p.id}`)
        } else if (p.status === 'problema_entrega') {
          sons.add('problema')
          aviso.erro(`Problema na entrega do pedido #${p.numero}: ${motoboy} não conseguiu entregar. Veja em Pedidos.`, 20_000)
          avisarNoComputador(`Problema no pedido #${p.numero}`, `${motoboy} não conseguiu entregar para ${p.cliente_nome}.`, `pedido-${p.id}`)
        }
        continue
      }
      // mesma etapa: o tempo parado fez o pedido subir de nível
      if (agora.nivel && PESO[agora.nivel] > (anterior.nivel ? PESO[anterior.nivel] : 0)) atrasos.push({ p, nivel: agora.nivel })
    }
    if (atrasos.length) {
      const pior = atrasos.reduce((a, b) => (PESO[b.nivel] > PESO[a.nivel] ? b : a)).nivel
      sons.add(pior)
      const frase = ({ p, nivel }: (typeof atrasos)[number]) =>
        `Pedido #${p.numero} ${nivel === 'atencao' ? 'pede atenção' : nivel === 'atrasado' ? 'está ATRASADO' : 'está CRÍTICO'}: ${haQuanto(p.status_em)} parado em “${STATUS[p.status].rotulo}”.`
      if (atrasos.length <= 3) atrasos.forEach((a) => aviso.erro(frase(a), a.nivel === 'critico' ? 20_000 : 12_000))
      else aviso.erro(`${atrasos.length} pedidos passaram do tempo (o pior: ${ATRASO[pior].rotulo.toLowerCase()}). Veja o quadro de Pedidos.`, 20_000)
      avisarNoComputador(atrasos.length === 1 ? `Pedido #${atrasos[0].p.numero}: ${ATRASO[pior].rotulo}` : `${atrasos.length} pedidos passaram do tempo`, atrasos.map(frase).join(' '), 'atrasos')
    }
    if (sons.size && refs.current.som) tocarEmSequencia(sons)
  }, [aviso])

  useEffect(() => {
    // o painel é carregado depois do site: o aviso do link de "esqueci a senha" pode já ter passado
    if (recuperacao.pendente) {
      recuperacao.pendente = false
      setTrocarSenha(true)
    }
    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') {
        recuperacao.pendente = false
        setTrocarSenha(true)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setMenu(false)
  }, [pathname])

  // permissões do papel de quem entrou (o administrador pode tudo)
  useEffect(() => {
    if (!interno || !papel) return
    supabase
      .from('permissoes')
      .select('modulo')
      .eq('papel', papel)
      .then(({ data }) => setModulos(new Set((data ?? []).map((p) => p.modulo as string))))
  }, [interno, papel])

  useEffect(() => {
    if (!interno || !modulos) return
    recarregarFiscal()
    if (!atendimento) return
    contarNovos()
    conferirPedidos()
    const pararConferencia = aoMudarPedidos(conferirPedidos)
    const canal = supabase
      .channel('painel-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (m) => {
        const novo = m.new as { id?: string; status?: string; numero?: number }
        const chegou = m.eventType === 'INSERT' && novo.status === 'novo' && Boolean(novo.id)
        // marcado antes de conferir: a conferência que este mesmo evento dispara não avisa de novo
        if (chegou) novosAvisados.current.add(novo.id!)
        sincronizar()
        if (!chegou) return
        const { config, fiscal, som } = refs.current
        if (som) tocarAlerta()
        aviso.sucesso(`Chegou o pedido #${novo.numero}!`)
        avisarNoComputador(`Chegou o pedido #${novo.numero}!`, 'Abra o painel para aceitar.', `novo-${novo.id}`)
        if (config?.auto_aceitar && novo.id) {
          aceitarPedido(novo.id, config, fiscal)
            .then((avisos) => avisos?.forEach((a) => aviso.erro(a)))
            .catch((e) => aviso.erro(mensagemErro(e)))
        }
      })
      .subscribe((estado) => setAoVivo(estado === 'SUBSCRIBED'))
    // reforço caso a conexão em tempo real caia
    const t = setInterval(sincronizar, 45_000)
    return () => {
      clearInterval(t)
      pararConferencia()
      vistos.current = null
      supabase.removeChannel(canal)
    }
  }, [interno, modulos, atendimento, aviso, contarNovos, recarregarFiscal, sincronizar, aoMudarPedidos, conferirPedidos])

  const valor = useMemo(
    () => ({ fiscal, recarregarFiscal, novos, pode, ehAdmin, aoMudarPedidos, sincronizar }),
    [fiscal, recarregarFiscal, novos, pode, ehAdmin, aoMudarPedidos, sincronizar],
  )

  if (carregando) return <Carregando />
  if (!sessao) return <Login titulo="Área da equipe" voltarPara="/admin" />
  if (perfil?.ativo && perfil.papel === 'motoboy') return <Navigate to="/entregador" replace />
  if (!perfil?.ativo) {
    return (
      <Moldura>
        <h1 className="text-center font-display text-2xl font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-center text-sm text-stone-600">
          A conta {sessao.user.email} não faz parte da equipe ou ainda não foi liberada. Peça para a administradora ativar seu acesso.
        </p>
        <Botao variante="secundario" className="mt-5 w-full" onClick={sair}>
          Sair
        </Botao>
        <Link to="/" className="mt-3 block text-center text-sm font-semibold text-forno-600 hover:underline">
          Voltar ao site
        </Link>
      </Moldura>
    )
  }
  if (!modulos) return <Carregando />

  const itens = MENU.filter((m) => pode(m.modulo))
  if (itens.length === 0) {
    return (
      <Moldura>
        <h1 className="text-center font-display text-2xl font-semibold">Sem telas liberadas</h1>
        <p className="mt-2 text-center text-sm text-stone-600">Sua função ({PAPEIS[perfil.papel]}) ainda não tem nenhuma tela liberada. Fale com a administradora.</p>
        <Botao variante="secundario" className="mt-5 w-full" onClick={sair}>
          Sair
        </Botao>
      </Moldura>
    )
  }
  const permitido = itens.some((m) => pathname.startsWith(m.para))
  // a tela Cozinha saiu do painel: quem guardou o endereço dela cai em Pedidos
  const inicio = pathname.startsWith('/admin/cozinha') && atendimento ? '/admin/pedidos' : itens[0].para
  if (pathname === '/admin' || pathname === '/admin/' || !permitido) return <Navigate to={inicio} replace />

  const alternarSom = () => {
    const v = !som
    setSom(v)
    localStorage.setItem('tiace.som', v ? 'sim' : 'nao')
    if (v) tocarAlerta()
  }

  async function alternarAvisos() {
    if (avisos === 'ligados') {
      localStorage.setItem('tiace.avisos', 'nao')
      return setAvisos('desligados')
    }
    localStorage.removeItem('tiace.avisos')
    const permissao = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (permissao === 'granted') {
      setAvisos('ligados')
      aviso.sucesso('Pronto: pedido novo e entrega concluída aparecem no canto da tela do computador, mesmo com o painel minimizado.', 8000)
    } else {
      setAvisos('bloqueados')
      aviso.erro('O navegador bloqueou os avisos. Para liberar, clique no cadeado ao lado do endereço do site e permita "Notificações".', 12_000)
    }
  }

  return (
    <Contexto.Provider value={valor}>
      <div className="min-h-dvh bg-stone-100 text-forno-900 lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-stone-200 bg-white px-4 lg:hidden">
          <button type="button" aria-label="Abrir menu" onClick={() => setMenu(true)}>
            <Menu className="size-6" />
          </button>
          <span className="font-display text-lg font-semibold">{itens.find((m) => pathname.startsWith(m.para))?.rotulo}</span>
          {novos > 0 && atendimento && (
            <Link to="/admin/pedidos" className="pulsar-novo ml-auto rounded-full bg-queijo-400 px-3 py-1 text-sm font-bold">
              {novos} novo{novos > 1 ? 's' : ''}
            </Link>
          )}
        </header>

        {menu && <div className="fixed inset-0 z-40 bg-forno-900/50 lg:hidden" onClick={() => setMenu(false)} />}
        <aside className={cx('fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-forno-900 text-massa-200 transition-transform lg:translate-x-0', !menu && '-translate-x-full')}>
          <div className="flex h-16 items-center justify-between px-4">
            <Link to="/" title="Ver o site">
              <Logo claro />
            </Link>
            <button type="button" aria-label="Fechar menu" className="lg:hidden" onClick={() => setMenu(false)}>
              <X className="size-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {itens.map((m) => (
              <NavLink
                key={m.para}
                to={m.para}
                className={({ isActive }) =>
                  cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-molho-600 text-white' : 'hover:bg-white/10 hover:text-white')
                }
              >
                <m.icone className="size-[18px]" />
                {m.rotulo}
                {m.para === '/admin/pedidos' && novos > 0 && <span className="pulsar-novo ml-auto rounded-full bg-queijo-400 px-2 text-xs font-bold text-forno-900">{novos}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-white/10 p-3 text-sm">
            <p className="truncate font-semibold text-white">{perfil.nome}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-massa-400">
              {PAPEIS[perfil.papel]}
              {atendimento && (
                <span className="ml-auto inline-flex items-center gap-1" title={aoVivo ? 'Pedidos chegam na hora' : 'Sem tempo real: a tela se atualiza a cada 45 segundos'}>
                  {aoVivo ? <Wifi className="size-3.5 text-manjericao-500" /> : <WifiOff className="size-3.5 text-queijo-400" />}
                  {aoVivo ? 'ao vivo' : 'a cada 45 s'}
                </span>
              )}
            </p>
            <div className="mt-2 flex gap-1">
              <button type="button" title={som ? 'Desligar som de novos pedidos' : 'Ligar som de novos pedidos'} aria-label="Som de novos pedidos" aria-pressed={som} onClick={alternarSom} className="rounded-lg p-2 hover:bg-white/10">
                {som ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
              {atendimento && temAvisosDoSistema && (
                <button
                  type="button"
                  title={avisos === 'ligados' ? 'Avisos no canto da tela do computador: ligados' : avisos === 'bloqueados' ? 'Avisos bloqueados pelo navegador' : 'Ligar avisos no canto da tela do computador (pedido novo e entrega concluída)'}
                  aria-label="Avisos no computador"
                  aria-pressed={avisos === 'ligados'}
                  onClick={alternarAvisos}
                  className="rounded-lg p-2 hover:bg-white/10"
                >
                  {avisos === 'ligados' ? <BellRing className="size-4" /> : avisos === 'bloqueados' ? <BellOff className="size-4 text-massa-400" /> : <Bell className="size-4" />}
                </button>
              )}
              <button type="button" title="Trocar senha" aria-label="Trocar senha" onClick={() => setTrocarSenha(true)} className="rounded-lg p-2 hover:bg-white/10">
                <KeyRound className="size-4" />
              </button>
              <button type="button" onClick={sair} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-white/10">
                <LogOut className="size-4" /> Sair
              </button>
            </div>
          </div>
        </aside>

        <main className="mx-auto max-w-7xl p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      <TrocarSenha aberto={trocarSenha} onFechar={() => setTrocarSenha(false)} />
    </Contexto.Provider>
  )
}

/** Cabeçalho padrão das telas do painel. */
export function Pagina({ titulo, descricao, acoes, children }: { titulo: string; descricao?: string; acoes?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold lg:text-3xl">{titulo}</h1>
          {descricao && <p className="mt-0.5 text-sm text-stone-500">{descricao}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </>
  )
}
