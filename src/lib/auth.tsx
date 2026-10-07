import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Perfil } from './tipos'

interface Auth {
  sessao: Session | null
  perfil: Perfil | null
  carregando: boolean
  sair: () => Promise<void>
}

const Contexto = createContext<Auth>({ sessao: null, perfil: null, carregando: true, sair: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [sessaoLida, setSessaoLida] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [perfilDe, setPerfilDe] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session)
      setSessaoLida(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const usuarioId = sessao?.user.id ?? null
  useEffect(() => {
    if (!usuarioId) {
      setPerfil(null)
      setPerfilDe(null)
      return
    }
    let vivo = true
    supabase
      .from('perfis')
      .select('*')
      .eq('id', usuarioId)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo) return
        setPerfil(data as Perfil | null)
        setPerfilDe(usuarioId)
      })
    return () => {
      vivo = false
    }
  }, [usuarioId])

  const carregando = !sessaoLida || (usuarioId !== null && perfilDe !== usuarioId)
  const valor = useMemo(
    () => ({ sessao, perfil, carregando, sair: async () => void (await supabase.auth.signOut()) }),
    [sessao, perfil, carregando],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export const useAuth = () => useContext(Contexto)
