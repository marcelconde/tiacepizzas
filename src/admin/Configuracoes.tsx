import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Plus, Printer } from 'lucide-react'
import { Crud } from '../components/Crud'
import { Abas, Alternar, AreaTexto, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selecao, Tabela, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { chamarFuncao, useConsulta } from '../lib/dados'
import { DIAS_SEMANA, brl, dataCurta } from '../lib/formato'
import { imprimirPedido } from '../lib/impressao'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Configuracoes as TConfig, Papel, Pedido, Perfil } from '../lib/tipos'
import { Pagina } from './AdminLayout'

type Aba = 'loja' | 'horarios' | 'pedidos' | 'impressao' | 'cupons' | 'usuarios'

interface Cupom {
  id: string
  codigo: string
  tipo: 'percentual' | 'valor'
  valor: number
  pedido_minimo: number
  validade: string | null
  usos_max: number | null
  usos: number
  ativo: boolean
}

const PAPEIS: Record<Papel, string> = { admin: 'Administrador', atendente: 'Atendente', cozinha: 'Cozinha' }

const pedidoTeste = {
  numero: 0, codigo: 'TESTE123', cliente_nome: 'Cliente de teste', cliente_telefone: '11999990000', tipo: 'entrega', origem: 'site', status: 'confirmado',
  endereco: { logradouro: 'Rua de Exemplo', numero: '123', bairro: 'Centro', referencia: 'Portão azul' }, bairro: 'Centro',
  subtotal: 80, taxa_entrega: 5, desconto: 0, total: 85, forma_pagamento: 'dinheiro', troco_para: 100, pago: false, observacoes: 'Teste de impressão',
  criado_em: new Date().toISOString(), notas_fiscais: [],
  pedido_itens: [
    { id: '1', nome: '1/2 Calabresa + 1/2 Mussarela (Grande)', quantidade: 1, total: 68, ordem: 1, adicionais: [{ id: 'a', nome: 'Borda de catupiry', preco: 10, tipo: 'borda' }], observacoes: 'Sem cebola' },
    { id: '2', nome: 'Refrigerante lata 350ml', quantidade: 2, total: 12, ordem: 2, adicionais: [], observacoes: null },
  ],
} as unknown as Pedido

function Usuarios() {
  const { perfil } = useAuth()
  const aviso = useAviso()
  const [novo, setNovo] = useState<{ nome: string; email: string; senha: string; papel: Papel } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const { dados, carregando, erro, recarregar } = useConsulta<Perfil[]>(() => supabase.from('perfis').select('*').order('criado_em'), [])

  async function alterar(p: Perfil, valores: Partial<Perfil>) {
    const { error } = await supabase.from('perfis').update(valores).eq('id', p.id)
    if (error) return aviso.erro(mensagemErro(error))
    recarregar()
  }

  async function criar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    try {
      await chamarFuncao('admin-usuarios', { acao: 'criar', ...novo })
      aviso.sucesso('Usuário criado')
      setNovo(null)
      recarregar()
    } catch (err) {
      aviso.erro(mensagemErro(err))
    }
    setSalvando(false)
  }

  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !dados) return <Carregando />
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Botao onClick={() => setNovo({ nome: '', email: '', senha: '', papel: 'atendente' })}>
          <Plus className="size-4" /> Novo usuário
        </Botao>
      </div>
      <Tabela colunas={['Nome', 'E-mail', 'Função', 'Acesso']}>
        {(dados ?? []).map((p) => {
          const eu = p.id === perfil?.id
          return (
            <tr key={p.id}>
              <td className="font-semibold">
                {p.nome} {eu && <span className="text-xs font-normal text-stone-500">(você)</span>}
              </td>
              <td>{p.email}</td>
              <td>
                <Selecao aria-label="Função" className="w-auto" disabled={eu} value={p.papel} onChange={(e) => alterar(p, { papel: e.target.value as Papel })}>
                  {Object.entries(PAPEIS).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </td>
              <td>
                <Alternar ativo={p.ativo} disabled={eu} onChange={(v) => alterar(p, { ativo: v })} rotulo={p.ativo ? 'Liberado' : 'Bloqueado'} />
              </td>
            </tr>
          )
        })}
      </Tabela>
      <p className="mt-3 text-sm text-stone-500">
        Administrador vê tudo. Atendente cuida de pedidos, clientes, cardápio, estoque e caixa. Cozinha vê só a tela de preparo.
      </p>

      <Modal aberto={novo != null} titulo="Novo usuário" onFechar={() => setNovo(null)} largura="max-w-md">
        {novo && (
          <form onSubmit={criar} className="space-y-4">
            <Campo rotulo="Nome">
              <Entrada required value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            </Campo>
            <Campo rotulo="E-mail">
              <Entrada required type="email" autoComplete="off" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            </Campo>
            <Campo rotulo="Senha inicial" dica="Mínimo de 8 caracteres. A pessoa pode trocar depois de entrar.">
              <Entrada required type="password" minLength={8} autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
            </Campo>
            <Campo rotulo="Função">
              <Selecao value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value as Papel })}>
                {Object.entries(PAPEIS).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Botao type="submit" className="w-full" carregando={salvando}>
              Criar usuário
            </Botao>
          </form>
        )}
      </Modal>
    </>
  )
}

export default function Configuracoes() {
  const { config, recarregar } = useLoja()
  const aviso = useAviso()
  const [aba, setAba] = useState<Aba>('loja')
  const [c, setC] = useState<TConfig | null>(config)
  const [salvando, setSalvando] = useState(false)
  useEffect(() => {
    setC(config)
  }, [config])

  if (!c) return <Carregando />

  const texto = (nome: keyof TConfig) => ({
    value: String(c[nome] ?? ''),
    onChange: (e: { target: { value: string } }) => setC({ ...c, [nome]: e.target.value }),
  })

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const { id: _id, ...resto } = c!
    const valores = Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]))
    for (const k of ['pedido_minimo', 'tempo_preparo_min', 'tempo_entrega_min']) valores[k] = Number(valores[k]) || 0
    delete valores.atualizado_em
    valores.nome_loja = valores.nome_loja ?? 'Tia Cê Pizzas'
    valores.fuso_horario = valores.fuso_horario ?? 'America/Sao_Paulo'
    const { error } = await supabase.from('configuracoes').update(valores).eq('id', 1)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Configurações salvas')
    recarregar()
  }

  // função comum (não componente) para os campos não perderem o foco a cada tecla
  const formulario = (children: ReactNode) => (
    <form onSubmit={salvar}>
      <Cartao className="grid max-w-3xl gap-4 p-5 sm:grid-cols-2">
        {children}
        <div className="flex justify-end sm:col-span-2">
          <Botao type="submit" carregando={salvando}>
            Salvar
          </Botao>
        </div>
      </Cartao>
    </form>
  )

  return (
    <Pagina titulo="Configurações" descricao="Dados da loja, horários, regras de pedido, impressão e equipe.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'loja', rotulo: 'Loja' },
            { id: 'horarios', rotulo: 'Horários' },
            { id: 'pedidos', rotulo: 'Pedidos' },
            { id: 'impressao', rotulo: 'Impressão' },
            { id: 'cupons', rotulo: 'Cupons' },
            { id: 'usuarios', rotulo: 'Usuários' },
          ]}
        />
      </div>

      {aba === 'loja' &&
        formulario(
            <>
              <Campo rotulo="Nome da loja">
                <Entrada required {...texto('nome_loja')} />
              </Campo>
              <Campo rotulo="Frase de apresentação">
                <Entrada {...texto('slogan')} />
              </Campo>
              <Campo rotulo="Telefone">
                <Entrada type="tel" {...texto('telefone')} />
              </Campo>
              <Campo rotulo="WhatsApp (com DDD)" dica="Usado nos botões “Falar com a pizzaria”.">
                <Entrada type="tel" {...texto('whatsapp')} />
              </Campo>
              <Campo rotulo="Instagram">
                <Entrada placeholder="@tiacepizzas" {...texto('instagram')} />
              </Campo>
              <Campo rotulo="Chave Pix" dica="Mostrada ao cliente que escolhe pagar com Pix.">
                <Entrada {...texto('chave_pix')} />
              </Campo>
              <Campo rotulo="CEP">
                <Entrada {...texto('cep')} />
              </Campo>
              <Campo rotulo="Rua / avenida">
                <Entrada {...texto('logradouro')} />
              </Campo>
              <Campo rotulo="Número">
                <Entrada {...texto('numero')} />
              </Campo>
              <Campo rotulo="Bairro">
                <Entrada {...texto('bairro')} />
              </Campo>
              <Campo rotulo="Cidade">
                <Entrada {...texto('cidade')} />
              </Campo>
              <Campo rotulo="UF">
                <Entrada maxLength={2} {...texto('uf')} />
              </Campo>
              <Campo rotulo="Aviso no topo do site (opcional)" className="sm:col-span-2">
                <AreaTexto placeholder="Ex.: Hoje abrimos mais tarde, às 19h." {...texto('mensagem_aviso')} />
              </Campo>
            </>
        )}

      {aba === 'horarios' &&
        formulario(
            <>
              <Campo rotulo="Situação da loja" className="sm:col-span-2" dica="Use “forçar” para abrir ou fechar fora do horário normal — lembre de voltar para automático depois.">
                <Selecao
                  value={c.loja_aberta_manual == null ? '' : String(c.loja_aberta_manual)}
                  onChange={(e) => setC({ ...c, loja_aberta_manual: e.target.value === '' ? null : e.target.value === 'true' })}
                >
                  <option value="">Automático (segue os horários abaixo)</option>
                  <option value="true">Forçar aberta agora</option>
                  <option value="false">Forçar fechada agora</option>
                </Selecao>
              </Campo>
              <div className="space-y-2 sm:col-span-2">
                {DIAS_SEMANA.map((dia, i) => {
                  const h = c.horarios[String(i)] ?? { aberto: false, abre: '18:00', fecha: '23:00' }
                  const mudar = (v: Partial<typeof h>) => setC({ ...c, horarios: { ...c.horarios, [String(i)]: { ...h, ...v } } })
                  return (
                    <div key={dia} className="flex flex-wrap items-center gap-3">
                      <span className="w-20 text-sm font-semibold">{dia}</span>
                      <Alternar ativo={h.aberto} onChange={(v) => mudar({ aberto: v })} rotulo={h.aberto ? 'Abre' : 'Fechado'} />
                      {h.aberto && (
                        <>
                          <Entrada type="time" aria-label={`${dia}: abre às`} className="w-auto" value={h.abre.slice(0, 5)} onChange={(e) => mudar({ abre: e.target.value })} />
                          <span className="text-sm text-stone-500">às</span>
                          <Entrada type="time" aria-label={`${dia}: fecha às`} className="w-auto" value={h.fecha.slice(0, 5)} onChange={(e) => mudar({ fecha: e.target.value })} />
                        </>
                      )}
                    </div>
                  )
                })}
                <p className="text-xs text-stone-500">Se fechar depois da meia-noite, basta informar o horário (ex.: 18:00 às 01:00).</p>
              </div>
            </>
        )}

      {aba === 'pedidos' &&
        formulario(
            <>
              <div className="space-y-3 sm:col-span-2">
                <Alternar ativo={c.aceita_pedidos_online} onChange={(v) => setC({ ...c, aceita_pedidos_online: v })} rotulo="Aceitar pedidos pelo site" />
                <br />
                <Alternar ativo={c.auto_aceitar} onChange={(v) => setC({ ...c, auto_aceitar: v })} rotulo="Aceitar automaticamente os pedidos do site (confirma, emite nota e imprime sem clicar)" />
                <p className="text-xs text-stone-500">O aceite automático acontece no computador da loja: o painel precisa estar aberto.</p>
              </div>
              <Campo rotulo="Pedido mínimo (R$)">
                <Entrada type="number" step="0.01" min="0" {...texto('pedido_minimo')} />
              </Campo>
              <Campo rotulo="Preço da pizza com mais de um sabor">
                <Selecao value={c.regra_preco_sabores} onChange={(e) => setC({ ...c, regra_preco_sabores: e.target.value as TConfig['regra_preco_sabores'] })}>
                  <option value="maior">Cobra o sabor mais caro</option>
                  <option value="media">Cobra a média dos sabores</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Tempo de preparo (min)">
                <Entrada type="number" min="0" {...texto('tempo_preparo_min')} />
              </Campo>
              <Campo rotulo="Tempo de entrega (min)" dica="Somado ao preparo na previsão mostrada ao cliente.">
                <Entrada type="number" min="0" {...texto('tempo_entrega_min')} />
              </Campo>
            </>
        )}

      {aba === 'impressao' &&
        formulario(
            <>
              <Campo rotulo="Largura da bobina">
                <Selecao value={c.impressao.largura} onChange={(e) => setC({ ...c, impressao: { ...c.impressao, largura: Number(e.target.value) as 58 | 80 } })}>
                  <option value={80}>80 mm</option>
                  <option value={58}>58 mm</option>
                </Selecao>
              </Campo>
              <div className="space-y-3 pt-6">
                <Alternar ativo={c.impressao.auto} onChange={(v) => setC({ ...c, impressao: { ...c.impressao, auto: v } })} rotulo="Imprimir sozinho ao confirmar o pedido" />
                <br />
                <Alternar ativo={c.impressao.via_cozinha} onChange={(v) => setC({ ...c, impressao: { ...c.impressao, via_cozinha: v } })} rotulo="Imprimir também a via da cozinha" />
              </div>
              <div className="rounded-lg bg-stone-50 p-4 text-sm text-stone-700 sm:col-span-2">
                <p className="font-semibold">Para imprimir direto, sem a janela do navegador:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Instale o driver da impressora térmica e defina-a como impressora padrão do computador da loja.</li>
                  <li>Nas preferências do driver, escolha o papel de {c.impressao.largura} mm e ative o corte ao final de cada página.</li>
                  <li>
                    Abra o painel por um atalho do Chrome com a opção <code className="rounded bg-white px-1">--kiosk-printing</code> (passo a passo no README).
                  </li>
                </ol>
                <Botao variante="secundario" className="mt-3" onClick={() => imprimirPedido(pedidoTeste, c)}>
                  <Printer className="size-4" /> Imprimir cupom de teste
                </Botao>
              </div>
            </>
        )}

      {aba === 'cupons' && (
        <Crud<Cupom>
          tabela="cupons"
          nome="cupom"
          ordem="codigo"
          preparar={(v) => ({ ...v, codigo: String(v.codigo ?? '').toUpperCase().replace(/\s/g, '') })}
          colunas={[
            { rotulo: 'Código', render: (x) => <b>{x.codigo}</b> },
            { rotulo: 'Desconto', render: (x) => (x.tipo === 'percentual' ? `${Number(x.valor)}%` : brl(x.valor)) },
            { rotulo: 'Pedido mínimo', render: (x) => (Number(x.pedido_minimo) > 0 ? brl(x.pedido_minimo) : '—') },
            { rotulo: 'Validade', render: (x) => dataCurta(x.validade) || 'Sem validade' },
            { rotulo: 'Usos', render: (x) => `${x.usos}${x.usos_max ? ` de ${x.usos_max}` : ''}` },
            { rotulo: 'Ativo', render: (x) => (x.ativo ? 'Sim' : 'Não') },
          ]}
          campos={[
            { nome: 'codigo', rotulo: 'Código', obrigatorio: true },
            { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, padrao: 'percentual', opcoes: [{ valor: 'percentual', rotulo: 'Percentual (%)' }, { valor: 'valor', rotulo: 'Valor fixo (R$)' }] },
            { nome: 'valor', rotulo: 'Valor do desconto', tipo: 'numero', obrigatorio: true },
            { nome: 'pedido_minimo', rotulo: 'Pedido mínimo (R$)', tipo: 'moeda', padrao: 0, obrigatorio: true },
            { nome: 'validade', rotulo: 'Válido até', tipo: 'data' },
            { nome: 'usos_max', rotulo: 'Limite de usos', tipo: 'numero', dica: 'Em branco = sem limite.' },
            { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
          ]}
        />
      )}

      {aba === 'usuarios' && <Usuarios />}
    </Pagina>
  )
}
