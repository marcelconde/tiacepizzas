import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3, Bike, BookOpen, ChefHat, ClipboardList, FileText, KeyRound, LogOut, Menu, Package, PlusCircle, Settings,
  Users, Volume2, VolumeX, Wallet, Wallet2, X, type LucideIcon,
} from 'lucide-react'
import { Logo } from '../components/Logo'
import { Botao, Campo, Carregando, Entrada, Erro, Modal, cx, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useLoja } from '../lib/loja'
import { aceitarPedido } from '../lib/pedidos'
import { configurado, mensagemErro, supabase } from '../lib/supabase'
import type { ConfigFiscal, Papel } from '../lib/tipos'

// ------------------------------------------------------------------ contexto do painel
interface Admin {
  fiscal: ConfigFiscal | null
  recarregarFiscal: () => Promise<void>
  novos: number
  /** Avisa a tela sempre que algum pedido mudar (tempo real, com reforço periódico). */
  aoMudarPedidos: (fn: () => void) => () => void
  /** Atualiza contadores e telas na hora, sem esperar o tempo real (use depois de alterar um pedido). */
  sincronizar: () => void
}
const Contexto = createContext<Admin>({ fiscal: null, recarregarFiscal: async () => {}, novos: 0, aoMudarPedidos: () => () => {}, sincronizar: () => {} })
export const useAdmin = () => useContext(Contexto)

/** Recarrega a tela quando os pedidos mudam. */
export function usePedidosAoVivo(fn: () => void) {
  const { aoMudarPedidos } = useAdmin()
  const atual = useRef(fn)
  atual.current = fn
  useEffect(() => aoMudarPedidos(() => atual.current()), [aoMudarPedidos])
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

// ------------------------------------------------------------------ menu
interface ItemMenu {
  para: string
  rotulo: string
  icone: LucideIcon
  papeis: Papel[]
}
const MENU: ItemMenu[] = [
  { para: '/admin/painel', rotulo: 'Painel', icone: BarChart3, papeis: ['admin'] },
  { para: '/admin/pedidos', rotulo: 'Pedidos', icone: ClipboardList, papeis: ['admin', 'atendente'] },
  { para: '/admin/pdv', rotulo: 'Novo pedido', icone: PlusCircle, papeis: ['admin', 'atendente'] },
  { para: '/admin/cozinha', rotulo: 'Cozinha', icone: ChefHat, papeis: ['admin', 'atendente', 'cozinha'] },
  { para: '/admin/clientes', rotulo: 'Clientes', icone: Users, papeis: ['admin', 'atendente'] },
  { para: '/admin/cardapio', rotulo: 'Cardápio', icone: BookOpen, papeis: ['admin', 'atendente'] },
  { para: '/admin/estoque', rotulo: 'Estoque', icone: Package, papeis: ['admin', 'atendente'] },
  { para: '/admin/caixa', rotulo: 'Caixa', icone: Wallet, papeis: ['admin', 'atendente'] },
  { para: '/admin/entregas', rotulo: 'Entregas', icone: Bike, papeis: ['admin', 'atendente'] },
  { para: '/admin/financeiro', rotulo: 'Financeiro', icone: Wallet2, papeis: ['admin'] },
  { para: '/admin/fiscal', rotulo: 'Fiscal', icone: FileText, papeis: ['admin'] },
  { para: '/admin/configuracoes', rotulo: 'Configurações', icone: Settings, papeis: ['admin'] },
]

export const inicioDoPapel = (papel: Papel) => MENU.find((m) => m.papeis.includes(papel))!.para

// ------------------------------------------------------------------ telas de acesso
function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-forno-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        {children}
      </div>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    if (error) setErro(mensagemErro(error))
  }

  async function esqueci() {
    setErro('')
    if (!email) return setErro('Digite seu e-mail acima para receber o link de redefinição.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin` })
    if (error) setErro(mensagemErro(error))
    else setInfo('Enviamos um link para redefinir a senha. Confira seu e-mail.')
  }

  return (
    <Moldura>
      <h1 className="text-center font-display text-2xl font-semibold">Área da equipe</h1>
      {!configurado && (
        <div className="mt-4">
          <Erro>O banco de dados ainda não foi conectado a este site.</Erro>
        </div>
      )}
      <form onSubmit={entrar} className="mt-5 space-y-4">
        <Campo rotulo="E-mail">
          <Entrada type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo rotulo="Senha">
          <Entrada type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        {erro && <Erro>{erro}</Erro>}
        {info && <p className="text-sm text-manjericao-700">{info}</p>}
        <Botao type="submit" tamanho="g" className="w-full" carregando={enviando}>
          Entrar
        </Botao>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <button type="button" onClick={esqueci} className="font-semibold text-forno-600 hover:underline">
          Esqueci a senha
        </button>
        <Link to="/" className="font-semibold text-forno-600 hover:underline">
          Voltar ao site
        </Link>
      </div>
    </Moldura>
  )
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
  const [novos, setNovos] = useState(0)
  const [som, setSom] = useState(() => localStorage.getItem('tiace.som') !== 'nao')
  const [menu, setMenu] = useState(false)
  const [trocarSenha, setTrocarSenha] = useState(false)
  const ouvintes = useRef(new Set<() => void>())
  const refs = useRef({ config, fiscal, som })
  refs.current = { config, fiscal, som }

  const ativo = Boolean(perfil?.ativo)
  const atendimento = ativo && perfil!.papel !== 'cozinha'

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

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') setTrocarSenha(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setMenu(false)
  }, [pathname])

  const sincronizar = useCallback(() => {
    contarNovos()
    ouvintes.current.forEach((fn) => fn())
  }, [contarNovos])

  useEffect(() => {
    if (!ativo) return
    recarregarFiscal()
    contarNovos()
    const avisar = sincronizar
    const canal = supabase
      .channel('painel-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (m) => {
        avisar()
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
      .subscribe()
    // reforço caso a conexão em tempo real caia
    const t = setInterval(avisar, 45_000)
    return () => {
      clearInterval(t)
      supabase.removeChannel(canal)
    }
  }, [ativo, atendimento, aviso, contarNovos, recarregarFiscal, sincronizar])

  const valor = useMemo(
    () => ({ fiscal, recarregarFiscal, novos, aoMudarPedidos, sincronizar }),
    [fiscal, recarregarFiscal, novos, aoMudarPedidos, sincronizar],
  )

  if (carregando) return <Carregando />
  if (!sessao) return <Login />
  if (!perfil?.ativo) {
    return (
      <Moldura>
        <h1 className="text-center font-display text-2xl font-semibold">Acesso pendente</h1>
        <p className="mt-2 text-center text-sm text-stone-600">Sua conta ({sessao.user.email}) ainda não foi liberada. Peça para a administradora ativar seu acesso.</p>
        <Botao variante="secundario" className="mt-5 w-full" onClick={sair}>
          Sair
        </Botao>
      </Moldura>
    )
  }

  const itens = MENU.filter((m) => m.papeis.includes(perfil.papel))
  const permitido = itens.some((m) => pathname.startsWith(m.para))
  if (pathname === '/admin' || pathname === '/admin/' || !permitido) return <Navigate to={inicioDoPapel(perfil.papel)} replace />

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
            <p className="truncate text-xs text-massa-400 capitalize">{perfil.papel}</p>
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
