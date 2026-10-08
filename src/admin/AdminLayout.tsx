import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3, Bike, BookOpen, ChefHat, ClipboardList, FileText, History, KeyRound, LayoutTemplate, LineChart, LogOut, Menu, Package,
  PlusCircle, Settings, Users, Volume2, VolumeX, Wallet, Wallet2, Wifi, WifiOff, X, type LucideIcon,
} from 'lucide-react'
import { Login, Moldura } from '../components/Login'
import { Logo } from '../components/Logo'
import { Botao, Campo, Carregando, Entrada, Modal, cx, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { PAPEIS } from '../lib/formato'
import { useLoja } from '../lib/loja'
import { aceitarPedido } from '../lib/pedidos'
import { mensagemErro, supabase } from '../lib/supabase'
import type { ConfigFiscal, Configuracoes } from '../lib/tipos'

// ------------------------------------------------------------------ módulos e menu
export type Modulo =
  | 'painel' | 'pedidos' | 'cozinha' | 'clientes' | 'cardapio' | 'estoque' | 'caixa' | 'entregas' | 'financeiro' | 'analises'
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
  { para: '/admin/cozinha', rotulo: 'Cozinha', icone: ChefHat, modulo: 'cozinha' },
  { para: '/admin/clientes', rotulo: 'Clientes', icone: Users, modulo: 'clientes' },
  { para: '/admin/cardapio', rotulo: 'Cardápio', icone: BookOpen, modulo: 'cardapio' },
  { para: '/admin/conteudo', rotulo: 'Site e promoções', icone: LayoutTemplate, modulo: 'conteudo' },
  { para: '/admin/estoque', rotulo: 'Estoque', icone: Package, modulo: 'estoque' },
  { para: '/admin/caixa', rotulo: 'Caixa', icone: Wallet, modulo: 'caixa' },
  { para: '/admin/entregas', rotulo: 'Entregas', icone: Bike, modulo: 'entregas' },
  { para: '/admin/financeiro', rotulo: 'Financeiro', icone: Wallet2, modulo: 'financeiro' },
  { para: '/admin/analises', rotulo: 'Análises', icone: LineChart, modulo: 'analises' },
  { para: '/admin/fiscal', rotulo: 'Fiscal', icone: FileText, modulo: 'fiscal' },
  { para: '/admin/auditoria', rotulo: 'Auditoria', icone: History, modulo: 'auditoria' },
  { para: '/admin/configuracoes', rotulo: 'Configurações', icone: Settings, modulo: 'configuracoes' },
]

/** Nomes dos módulos na tela de permissões (um por linha da matriz). */
export const MODULOS: { id: Modulo; rotulo: string; descricao: string }[] = [
  { id: 'painel', rotulo: 'Painel', descricao: 'Indicadores e gráficos de faturamento' },
  { id: 'pedidos', rotulo: 'Pedidos', descricao: 'Quadro de pedidos, histórico e novo pedido' },
  { id: 'cozinha', rotulo: 'Cozinha', descricao: 'Tela de preparo' },
  { id: 'clientes', rotulo: 'Clientes', descricao: 'Cadastro e histórico de clientes' },
  { id: 'cardapio', rotulo: 'Cardápio', descricao: 'Produtos, preços e ficha técnica' },
  { id: 'conteudo', rotulo: 'Site e promoções', descricao: 'Banners, textos, promoções e cupons' },
  { id: 'estoque', rotulo: 'Estoque', descricao: 'Insumos, entradas e perdas' },
  { id: 'caixa', rotulo: 'Caixa', descricao: 'Abertura, sangria e fechamento' },
  { id: 'entregas', rotulo: 'Entregas', descricao: 'Área de entrega, taxas e entregadores' },
  { id: 'financeiro', rotulo: 'Financeiro', descricao: 'Despesas, resultado e relatórios' },
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

function tocarAlerta() {
  try {
    const ctx = new AudioContext()
    ;[0, 0.25, 0.5].forEach((inicio, i) => {
      const osc = ctx.createOscillator()
      const ganho = ctx.createGain()
      osc.frequency.value = i === 2 ? 1175 : 880
      ganho.gain.setValueAtTime(0.25, ctx.currentTime + inicio)
      ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + inicio + 0.2)
      osc.connect(ganho).connect(ctx.destination)
      osc.start(ctx.currentTime + inicio)
      osc.stop(ctx.currentTime + inicio + 0.2)
    })
    setTimeout(() => ctx.close(), 1500)
  } catch {
    /* navegador bloqueou o áudio antes de qualquer clique */
  }
}

function TrocarSenha({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const aviso = useAviso()
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Senha alterada')
    setSenha('')
    onFechar()
  }
  return (
    <Modal aberto={aberto} titulo="Definir nova senha" onFechar={onFechar} largura="max-w-sm">
      <form onSubmit={salvar} className="space-y-4">
        <Campo rotulo="Nova senha" dica="Mínimo de 8 caracteres.">
          <Entrada type="password" required minLength={8} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <Botao type="submit" className="w-full" carregando={salvando}>
          Salvar senha
        </Botao>
      </form>
    </Modal>
  )
}

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

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') setTrocarSenha(true)
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
    if (!atendimento && !pode('cozinha')) return
    contarNovos()
    const canal = supabase
      .channel('painel-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (m) => {
        sincronizar()
        const novo = m.new as { id?: string; status?: string; numero?: number }
        if (m.eventType !== 'INSERT' || novo.status !== 'novo' || !atendimento) return
        const { config, fiscal, som } = refs.current
        if (som) tocarAlerta()
        aviso.sucesso(`Chegou o pedido #${novo.numero}!`)
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
      supabase.removeChannel(canal)
    }
  }, [interno, modulos, atendimento, pode, aviso, contarNovos, recarregarFiscal, sincronizar])

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
  if (pathname === '/admin' || pathname === '/admin/' || !permitido) return <Navigate to={itens[0].para} replace />

  const alternarSom = () => {
    const v = !som
    setSom(v)
    localStorage.setItem('tiace.som', v ? 'sim' : 'nao')
    if (v) tocarAlerta()
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
              {(atendimento || pode('cozinha')) && (
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
