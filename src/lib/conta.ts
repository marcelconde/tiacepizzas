import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { mensagemErro, supabase } from './supabase'
import type { Cliente, Endereco } from './tipos'

export interface Conta extends Cliente {
  enderecos: Endereco[]
}

/** Cadastro do cliente logado. Com `ativo` falso não consulta (evita criar cadastro para quem só está navegando). */
export function useConta(ativo = true) {
  const { sessao, carregando: carregandoSessao } = useAuth()
  const [conta, setConta] = useState<Conta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const usuarioId = sessao?.user.id

  const recarregar = useCallback(async () => {
    if (!usuarioId || !ativo) {
      setConta(null)
      setCarregando(false)
      return
    }
    const { data, error } = await supabase.rpc('minha_conta')
    if (error) setErro(mensagemErro(error))
    else {
      setErro('')
      setConta(data as Conta)
    }
    setCarregando(false)
  }, [usuarioId, ativo])

  useEffect(() => {
    if (!carregandoSessao) recarregar()
  }, [carregandoSessao, recarregar])

  return { conta, carregando: carregando || carregandoSessao, erro, recarregar, logado: Boolean(usuarioId) }
}

/** Abre o login do Google ou do Facebook e volta para a página indicada. */
export const entrarCom = (provedor: 'google' | 'facebook', voltarPara = '/conta') =>
  supabase.auth.signInWithOAuth({ provider: provedor, options: { redirectTo: `${location.origin}${voltarPara}` } })
