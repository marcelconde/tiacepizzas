import { useCallback, useEffect, useRef, useState } from 'react'
import { mensagemErro, supabase } from './supabase'

type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>

/** Executa uma consulta ao montar e sempre que as dependências mudarem. */
export function useConsulta<T>(consulta: () => Resposta<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const atual = useRef(consulta)
  atual.current = consulta
  const vez = useRef(0)

  const recarregar = useCallback(async () => {
    const minha = ++vez.current
    try {
      const { data, error } = await atual.current()
      if (minha !== vez.current) return
      if (error) setErro(mensagemErro(error))
      else {
        setDados(data)
        setErro(null)
      }
    } catch (e) {
      if (minha === vez.current) setErro(mensagemErro(e))
    } finally {
      if (minha === vez.current) setCarregando(false)
    }
  }, [])

  useEffect(() => {
    setCarregando(true)
    recarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { dados, carregando, erro, recarregar, setDados }
}

/** Chama uma função de servidor (Edge Function) e devolve o erro em português quando houver. */
export async function chamarFuncao<T>(nome: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: body as Record<string, unknown> })
  if (error) {
    let msg = error.message
    try {
      const corpo = await (error as { context?: Response }).context?.json()
      if (corpo?.erro) msg = corpo.erro
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new Error(msg)
  }
  if (data?.erro) throw new Error(data.erro)
  return data as T
}
