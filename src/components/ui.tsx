import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertCircle, CheckCircle2, Loader2, Minus, Plus, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ---------------------------------------------------------------- botões
const variantes = {
  primario: 'bg-molho-600 text-white hover:bg-molho-700 shadow-sm',
  secundario: 'bg-white text-forno-800 border border-stone-300 hover:bg-stone-50',
  sutil: 'text-forno-700 hover:bg-stone-100',
  perigo: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  verde: 'bg-manjericao-600 text-white hover:bg-manjericao-700 shadow-sm',
}
const tamanhos = { p: 'h-8 px-2.5 text-sm gap-1.5', m: 'h-10 px-4 text-sm gap-2', g: 'h-12 px-6 text-base gap-2' }

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: keyof typeof variantes
  tamanho?: keyof typeof tamanhos
  carregando?: boolean
}

export function Botao({ variante = 'primario', tamanho = 'm', carregando, className, children, disabled, ...resto }: BotaoProps) {
  return (
    <button
      type="button"
      {...resto}
      disabled={disabled || carregando}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
    >
      {carregando && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- formulários
// largura total por padrão; quem passa uma classe de largura (w-auto, w-40…) assume o controle
const largura = (classe?: string) => (/(^|\s)w-/.test(classe ?? '') ? '' : 'w-full')
const baseCampo =
  'rounded-lg border border-stone-300 bg-white px-3 text-sm text-forno-900 placeholder:text-stone-400 focus:border-molho-500 focus:outline-none focus:ring-2 focus:ring-molho-500/20 disabled:bg-stone-100'

export function Campo({ rotulo, dica, children, className }: { rotulo: string; dica?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-forno-800">{rotulo}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-stone-500">{dica}</span>}
    </label>
  )
}

export const Entrada = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx(baseCampo, largura(className), 'h-10', className)} />
)

export const Selecao = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(baseCampo, largura(className), 'h-10', className)} />
)

export const AreaTexto = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={2} {...p} className={cx(baseCampo, largura(className), 'py-2', className)} />
)

export function Alternar({ ativo, onChange, rotulo, disabled }: { ativo: boolean; onChange: (v: boolean) => void; rotulo?: string; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-forno-800">
      <button
        type="button"
        role="switch"
        aria-checked={ativo}
        aria-label={rotulo}
        disabled={disabled}
        onClick={() => onChange(!ativo)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', ativo ? 'bg-manjericao-600' : 'bg-stone-300')}
      >
        <span className={cx('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform', ativo && 'translate-x-5')} />
      </button>
      {rotulo}
    </label>
  )
}

export function Contador({ valor, onChange, min = 0 }: { valor: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-stone-300 bg-white">
      <button type="button" aria-label="Diminuir" className="grid size-9 place-items-center text-forno-700 disabled:opacity-30" disabled={valor <= min} onClick={() => onChange(valor - 1)}>
        <Minus className="size-4" />
      </button>
      <span className="w-7 text-center text-sm font-semibold tabular-nums">{valor}</span>
      <button type="button" aria-label="Aumentar" className="grid size-9 place-items-center text-forno-700" onClick={() => onChange(valor + 1)}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- estrutura
export function Modal({
  aberto,
  titulo,
  onFechar,
  children,
  rodape,
  largura = 'max-w-lg',
}: {
  aberto: boolean
  titulo: ReactNode
  onFechar: () => void
  children: ReactNode
  rodape?: ReactNode
  largura?: string
}) {
  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    document.addEventListener('keydown', tecla)
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = anterior
    }
  }, [aberto, onFechar])

  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-forno-900/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="dialog" aria-modal="true" className={cx('animar-subir flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', largura)}>
        <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <h2 className="font-display text-xl font-semibold text-forno-900">{titulo}</h2>
          <button type="button" aria-label="Fechar" onClick={onFechar} className="-m-1 rounded-lg p-1 text-stone-500 hover:bg-stone-100">
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 px-5 py-3">{rodape}</footer>}
      </div>
    </div>
  )
}

export const Cartao = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx('rounded-xl border border-stone-200 bg-white', className)}>{children}</div>
)

export const Selo = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', className)}>{children}</span>
)

export const Carregando = ({ texto = 'Carregando…' }: { texto?: string }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-500">
    <Loader2 className="size-5 animate-spin" /> {texto}
  </div>
)

export const Vazio = ({ titulo, texto, children }: { titulo: string; texto?: string; children?: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-stone-300 px-6 py-12 text-center">
    <p className="font-semibold text-forno-800">{titulo}</p>
    {texto && <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{texto}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>
)

export const Erro = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
    <AlertCircle className="mt-0.5 size-4 shrink-0" />
    <div>{children}</div>
  </div>
)

export function Abas<T extends string>({ abas, atual, onChange }: { abas: { id: T; rotulo: string }[]; atual: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="sem-barra flex gap-1 overflow-x-auto border-b border-stone-200">
      {abas.map((a) => (
        <button
          key={a.id}
          role="tab"
          type="button"
          aria-selected={a.id === atual}
          onClick={() => onChange(a.id)}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap',
            a.id === atual ? 'border-molho-600 text-molho-700' : 'border-transparent text-stone-500 hover:text-forno-800',
          )}
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  )
}

/** Tabela simples com rolagem horizontal em telas pequenas. */
export function Tabela({ colunas, children }: { colunas: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs tracking-wide text-stone-500 uppercase">
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 [&_td]:px-3 [&_td]:py-2">{children}</tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- avisos (toasts)
interface Aviso {
  id: number
  tipo: 'sucesso' | 'erro'
  texto: string
}
const AvisoContexto = createContext<{ sucesso: (t: string) => void; erro: (t: string) => void }>({ sucesso: () => {}, erro: () => {} })

export function AvisoProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const mostrar = useCallback((tipo: Aviso['tipo'], texto: string) => {
    const id = Date.now() + Math.random()
    setAvisos((a) => [...a, { id, tipo, texto }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'erro' ? 7000 : 3500)
  }, [])
  const [api] = useState(() => ({ sucesso: (t: string) => mostrar('sucesso', t), erro: (t: string) => mostrar('erro', t) }))

  return (
    <AvisoContexto.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {avisos.map((a) => (
          <div
            key={a.id}
            className={cx(
              'animar-subir pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg',
              a.tipo === 'erro' ? 'bg-red-700' : 'bg-forno-800',
            )}
          >
            {a.tipo === 'erro' ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
            {a.texto}
          </div>
        ))}
      </div>
    </AvisoContexto.Provider>
  )
}

export const useAviso = () => useContext(AvisoContexto)
