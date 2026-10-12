import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Botao, Campo, Carregando, Entrada, Erro, Vazio, cx } from '../components/ui'
import { useAuth } from '../lib/auth'
import { entrarCom, useProvedores } from '../lib/conta'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'

/** Google e Facebook: só aparecem se estiverem ligados no painel e funcionando no servidor. */
export function useLoginSocial() {
  const { config } = useLoja()
  const ligados = useProvedores()
  return {
    google: Boolean(config?.login_google) && ligados.pronto && ligados.google,
    facebook: Boolean(config?.login_facebook) && ligados.pronto && ligados.facebook,
  }
}

export function BotoesSociais({ voltarPara, className }: { voltarPara?: string; className?: string }) {
  const { google, facebook } = useLoginSocial()
  if (!google && !facebook) return null
  return (
    <div className={className}>
      {google && (
        <Botao variante="secundario" tamanho="g" className="w-full" onClick={() => entrarCom('google', voltarPara)}>
          Continuar com Google
        </Botao>
      )}
      {facebook && (
        <Botao variante="secundario" tamanho="g" className="w-full" onClick={() => entrarCom('facebook', voltarPara)}>
          Continuar com Facebook
        </Botao>
      )}
    </div>
  )
}

/** Entrada do cliente: com e-mail e senha (ou criando a conta na hora), Google ou Facebook. */
export default function Entrar() {
  const { config } = useLoja()
  const { sessao, carregando } = useAuth()
  const social = useLoginSocial()
  const [params] = useSearchParams()
  const [modo, setModo] = useState<'entrar' | 'criar'>(params.get('criar') != null ? 'criar' : 'entrar')
  const [d, setD] = useState({ nome: '', email: '', senha: '' })
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

  // só caminhos do próprio site: o endereço de volta vem do link
  const pedido = params.get('voltar') ?? ''
  const voltar = pedido.startsWith('/') && !pedido.startsWith('//') ? pedido : '/conta'

  if (carregando) return <Carregando />
  if (sessao) return <Navigate to={voltar} replace />

  const comEmail = config?.login_email !== false
  const temSocial = social.google || social.facebook
  const criando = modo === 'criar'
  const campo = (nome: keyof typeof d) => ({ value: d[nome], onChange: (e: { target: { value: string } }) => setD((v) => ({ ...v, [nome]: e.target.value })) })

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setInfo('')
    setEnviando(true)
    const email = d.email.trim().toLowerCase()
    if (criando) {
      const nome = d.nome.trim()
      const { data, error } = await supabase.auth.signUp({ email, password: d.senha, options: { data: { nome, full_name: nome }, emailRedirectTo: `${location.origin}${voltar}` } })
      if (error) setErro(mensagemErro(error))
      else if (!data.session) {
        // só acontece se a confirmação de e-mail for ligada no servidor
        setInfo('Enviamos um e-mail para confirmar a sua conta. Abra o link que chegou e depois entre aqui.')
        setModo('entrar')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: d.senha })
      if (error) setErro(mensagemErro(error))
    }
    setEnviando(false)
  }

  async function esqueci() {
    setErro('')
    setInfo('')
    if (!d.email.trim()) return setErro('Digite o seu e-mail acima para receber o link de criar uma senha nova.')
    const { error } = await supabase.auth.resetPasswordForEmail(d.email.trim().toLowerCase(), { redirectTo: `${location.origin}/conta` })
    if (error) setErro(mensagemErro(error))
    else setInfo('Enviamos um link para você criar uma senha nova. Confira o seu e-mail (e a caixa de spam).')
  }

  const aba = (ativo: boolean) =>
    cx('flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors', ativo ? 'bg-white text-forno-900 shadow-sm' : 'text-stone-600 hover:text-forno-900')

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-center font-display text-4xl font-bold">{criando ? 'Criar conta' : 'Entrar'}</h1>
      <p className="mt-2 text-center text-stone-600">Guarde seus endereços e acompanhe todos os seus pedidos em um só lugar.</p>

      {!comEmail && !temSocial ? (
        <div className="mt-8">
          <Vazio titulo="Entrada com conta indisponível" texto="Você pode fazer seu pedido normalmente, sem cadastro." />
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-massa-200 bg-white p-5">
          {comEmail && (
            <>
              <div className="mb-5 flex gap-1 rounded-xl bg-massa-100 p-1" role="tablist">
                <button type="button" role="tab" aria-selected={!criando} className={aba(!criando)} onClick={() => { setModo('entrar'); setErro('') }}>
                  Já tenho conta
                </button>
                <button type="button" role="tab" aria-selected={criando} className={aba(criando)} onClick={() => { setModo('criar'); setErro(''); setInfo('') }}>
                  Criar conta
                </button>
              </div>
              <form onSubmit={enviar} className="space-y-4">
                {criando && (
                  <Campo rotulo="Seu nome">
                    <Entrada className="h-11" required maxLength={80} autoComplete="name" {...campo('nome')} />
                  </Campo>
                )}
                <Campo rotulo="E-mail">
                  <Entrada className="h-11" type="email" required autoComplete="email" inputMode="email" {...campo('email')} />
                </Campo>
                <Campo rotulo={criando ? 'Crie uma senha' : 'Senha'} dica={criando ? 'Pelo menos 8 caracteres.' : undefined}>
                  <Entrada className="h-11" type="password" required minLength={criando ? 8 : undefined} autoComplete={criando ? 'new-password' : 'current-password'} {...campo('senha')} />
                </Campo>
                {erro && <Erro>{erro}</Erro>}
                {info && <p role="status" className="rounded-lg bg-manjericao-100 px-3 py-2 text-sm text-manjericao-700">{info}</p>}
                <Botao type="submit" tamanho="g" className="w-full" carregando={enviando}>
                  {criando ? 'Criar minha conta' : 'Entrar'}
                </Botao>
              </form>
              {!criando && (
                <button type="button" onClick={esqueci} className="mt-3 text-sm font-semibold text-forno-600 hover:underline">
                  Esqueci a senha
                </button>
              )}
            </>
          )}
          {comEmail && temSocial && (
            <div className="my-5 flex items-center gap-3 text-xs text-stone-500 uppercase">
              <span className="h-px flex-1 bg-stone-200" /> ou <span className="h-px flex-1 bg-stone-200" />
            </div>
          )}
          <BotoesSociais voltarPara={voltar} className="space-y-3" />
        </div>
      )}

      <p className="mt-8 text-center text-sm text-stone-500">
        Prefere não criar conta?{' '}
        <Link to="/cardapio" className="font-semibold text-molho-700 hover:underline">
          Peça sem cadastro
        </Link>
        .
      </p>
    </div>
  )
}
