import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { configurado, mensagemErro, supabase } from '../lib/supabase'
import { Logo } from './Logo'
import { Botao, Campo, Entrada, Erro } from './ui'

export function Moldura({ children }: { children: ReactNode }) {
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

/** Entrada por e-mail e senha, usada pela equipe (painel) e pelos entregadores (aplicativo de entregas). */
export function Login({ titulo, voltarPara }: { titulo: string; voltarPara: string }) {
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${voltarPara}` })
    if (error) setErro(mensagemErro(error))
    else setInfo('Enviamos um link para redefinir a senha. Confira seu e-mail.')
  }

  return (
    <Moldura>
      <h1 className="text-center font-display text-2xl font-semibold">{titulo}</h1>
      {!configurado && (
        <div className="mt-4">
          <Erro>O banco de dados ainda não foi conectado a este site.</Erro>
        </div>
      )}
      <form onSubmit={entrar} className="mt-5 space-y-4">
        <Campo rotulo="E-mail">
          <Entrada className="h-11" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo rotulo="Senha">
          <Entrada className="h-11" type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
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
