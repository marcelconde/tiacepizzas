import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Download, Plus, Printer } from 'lucide-react'
import { Abas, Alternar, AreaTexto, Botao, Campo, Carregando, Cartao, Entrada, Erro, Modal, Selecao, Tabela, cx, useAviso } from '../components/ui'
import { useAuth } from '../lib/auth'
import { chamarFuncao, useConsulta } from '../lib/dados'
import { DIAS_SEMANA, PAPEIS, isoDia } from '../lib/formato'
import { imprimirPedido } from '../lib/impressao'
import { useLoja } from '../lib/loja'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Configuracoes as TConfig, Meta, Papel, Pedido, Perfil } from '../lib/tipos'
import { MODULOS, Pagina, useAdmin, type Modulo } from './AdminLayout'

type Aba = 'loja' | 'horarios' | 'pedidos' | 'metas' | 'impressao' | 'financeiro' | 'usuarios' | 'permissoes' | 'sistema'

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

const METAS: { id: string; nome: string; unidade: string; explicacao: string }[] = [
  { id: 'faturamento_dia', nome: 'Faturamento por dia', unidade: 'R$', explicacao: 'Classifica cada dia e a média diária do período.' },
  { id: 'pedidos_dia', nome: 'Pedidos por dia', unidade: 'pedidos', explicacao: 'Quantidade média de pedidos por dia.' },
  { id: 'ticket_medio', nome: 'Ticket médio', unidade: 'R$', explicacao: 'Valor médio de cada pedido.' },
  { id: 'tempo_preparo', nome: 'Tempo de preparo', unidade: 'min', explicacao: 'Da confirmação até ficar pronto. Aqui, menos é melhor.' },
  { id: 'cancelamentos_pct', nome: 'Cancelamentos', unidade: '%', explicacao: 'Parte dos pedidos que foi cancelada. Aqui, menos é melhor.' },
]

// ------------------------------------------------------------------ usuários e permissões
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
                {/* motoboy tem cadastro de entregador ligado ao login: a função não muda por aqui */}
                <Selecao aria-label="Função" className="w-auto" disabled={eu || p.papel === 'motoboy'} value={p.papel} onChange={(e) => alterar(p, { papel: e.target.value as Papel })}>
                  {Object.entries(PAPEIS).filter(([v]) => v !== 'motoboy' || p.papel === 'motoboy').map(([v, r]) => (
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
      <p className="mt-3 text-sm text-stone-500">O que cada função enxerga é definido na aba Permissões. O motoboy usa só o aplicativo de entregas, em {location.host}/entregador.</p>

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
            <Campo rotulo="Função" dica={novo.papel === 'motoboy' ? 'O motoboy já entra na lista de entregadores.' : undefined}>
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

function Permissoes() {
  const aviso = useAviso()
  const papeis: Papel[] = ['financeiro', 'atendente', 'cozinha']
  const { dados, carregando, erro, recarregar } = useConsulta<{ papel: Papel; modulo: Modulo }[]>(() => supabase.from('permissoes').select('*'), [])
  const tem = (papel: Papel, modulo: Modulo) => Boolean(dados?.some((p) => p.papel === papel && p.modulo === modulo))

  async function alternar(papel: Papel, modulo: Modulo) {
    const { error } = tem(papel, modulo)
      ? await supabase.from('permissoes').delete().eq('papel', papel).eq('modulo', modulo)
      : await supabase.from('permissoes').insert({ papel, modulo })
    if (error) return aviso.erro(mensagemErro(error))
    recarregar()
  }

  if (erro) return <Erro>{erro}</Erro>
  if (carregando && !dados) return <Carregando />
  return (
    <>
      <p className="mb-3 max-w-3xl text-sm text-stone-600">
        Marque as telas que cada função pode usar. A regra vale também no banco de dados: quem não tem a tela marcada não consegue ler nem alterar aquelas informações. A mudança vale no
        próximo acesso da pessoa.
      </p>
      <Tabela colunas={['Tela', 'Administrador', ...papeis.map((p) => PAPEIS[p]), 'Motoboy']}>
        {MODULOS.map((m) => (
          <tr key={m.id}>
            <td>
              <b>{m.rotulo}</b>
              <span className="block text-xs text-stone-500">{m.descricao}</span>
            </td>
            <td>
              <Check className="size-5 text-manjericao-600" aria-label="Sempre liberado" />
            </td>
            {papeis.map((p) => (
              <td key={p}>
                <input type="checkbox" className="size-5 accent-molho-600" aria-label={`${PAPEIS[p]} pode usar ${m.rotulo}`} checked={tem(p, m.id)} onChange={() => alternar(p, m.id)} />
              </td>
            ))}
            <td className="text-stone-400">—</td>
          </tr>
        ))}
      </Tabela>
      <p className="mt-3 text-sm text-stone-500">Usuários e permissões só podem ser alterados por administradores. O motoboy enxerga apenas as entregas atribuídas a ele, no aplicativo de entregas.</p>
    </>
  )
}

// ------------------------------------------------------------------ sistema
const TABELAS_BACKUP = [
  'configuracoes', 'site_conteudo', 'config_fiscal', 'categorias', 'tamanhos', 'produtos', 'produto_precos', 'adicionais', 'bairros', 'faixas_entrega', 'banners',
  'promocoes', 'promocao_produtos', 'cupons', 'clientes', 'enderecos', 'entregadores', 'pedidos', 'pedido_itens', 'caixas', 'caixa_movimentos', 'fornecedores',
  'insumos', 'fichas_tecnicas', 'estoque_movimentos', 'despesas', 'notas_fiscais', 'perfis', 'permissoes', 'auditoria',
]

function Sistema() {
  const aviso = useAviso()
  const { config } = useLoja()
  const [andamento, setAndamento] = useState('')

  async function baixar() {
    const copia: Record<string, unknown[]> = {}
    try {
      for (const tabela of TABELAS_BACKUP) {
        setAndamento(tabela)
        if (tabela === 'configuracoes') {
          copia[tabela] = [config]
          continue
        }
        const linhas: unknown[] = []
        for (let de = 0; ; de += 1000) {
          const { data, error } = await supabase.from(tabela).select('*').range(de, de + 999)
          if (error) throw error
          linhas.push(...(data ?? []))
          if (!data || data.length < 1000) break
        }
        copia[tabela] = linhas
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({ gerado_em: new Date().toISOString(), tabelas: copia })], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `tiace-copia-${isoDia()}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      aviso.sucesso('Cópia de segurança baixada')
    } catch (e) {
      aviso.erro(mensagemErro(e))
    }
    setAndamento('')
  }

  return (
    <Cartao className="max-w-2xl space-y-3 p-5 text-sm">
      <h2 className="font-display text-lg font-semibold">Cópia de segurança</h2>
      <p className="text-stone-600">
        Baixa um arquivo com todos os dados do sistema (pedidos, clientes, cardápio, estoque, caixa e configurações). Guarde em um lugar seguro: o arquivo contém dados de clientes.
      </p>
      <p className="text-stone-600">
        Faça pelo menos uma vez por semana. O plano gratuito do banco de dados não guarda cópias automáticas; no plano pago há cópia diária.
      </p>
      <Botao onClick={baixar} carregando={Boolean(andamento)}>
        <Download className="size-4" /> {andamento ? `Copiando ${andamento}…` : 'Baixar cópia de segurança'}
      </Botao>
    </Cartao>
  )
}

// ------------------------------------------------------------------ página
export default function Configuracoes() {
  const { config, recarregar } = useLoja()
  const { ehAdmin } = useAdmin()
  const aviso = useAviso()
  const [aba, setAba] = useState<Aba>('loja')
  const [c, setC] = useState<TConfig | null>(config)
  const [categorias, setCategorias] = useState('')
  const [salvando, setSalvando] = useState(false)
  useEffect(() => {
    setC(config)
    setCategorias((config?.categorias_despesa ?? []).join('\n'))
  }, [config])

  if (!c) return <Carregando />

  const texto = (nome: keyof TConfig) => ({
    value: String(c[nome] ?? ''),
    onChange: (e: { target: { value: string } }) => setC({ ...c, [nome]: e.target.value }),
  })
  const numero = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const { id: _id, ...resto } = c!
    const valores: Record<string, unknown> = Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]))
    for (const k of ['pedido_minimo', 'tempo_preparo_min', 'tempo_entrega_min']) valores[k] = numero(valores[k])
    delete valores.atualizado_em
    valores.nome_loja = valores.nome_loja ?? 'Tia Cê Pizzas'
    valores.fuso_horario = valores.fuso_horario ?? 'America/Sao_Paulo'
    valores.alertas_pedido = { atencao: numero(c!.alertas_pedido.atencao), atrasado: numero(c!.alertas_pedido.atrasado), critico: numero(c!.alertas_pedido.critico) }
    valores.metas = Object.fromEntries(Object.entries(c!.metas).map(([k, m]) => [k, { ...m, ruim: numero(m.ruim), bom: numero(m.bom) }]))
    valores.categorias_despesa = [...new Set(categorias.split('\n').map((x) => x.trim()).filter(Boolean))]
    const { error } = await supabase.from('configuracoes').update(valores).eq('id', 1)
    setSalvando(false)
    if (error) return aviso.erro(mensagemErro(error))
    aviso.sucesso('Configurações salvas')
    recarregar()
  }

  // função comum (não componente) para os campos não perderem o foco a cada tecla
  const formulario = (children: ReactNode, largura = 'max-w-3xl') => (
    <form onSubmit={salvar}>
      <Cartao className={cx('grid gap-4 p-5 sm:grid-cols-2', largura)}>
        {children}
        <div className="flex justify-end sm:col-span-2">
          <Botao type="submit" carregando={salvando}>
            Salvar
          </Botao>
        </div>
      </Cartao>
    </form>
  )
  const alerta = (nivel: keyof TConfig['alertas_pedido']) => ({
    type: 'number', min: 1, value: String(c.alertas_pedido[nivel]),
    onChange: (e: { target: { value: string } }) => setC({ ...c, alertas_pedido: { ...c.alertas_pedido, [nivel]: e.target.value as unknown as number } }),
  })
  const meta = (id: string, campo: 'ruim' | 'bom') => ({
    type: 'number', step: 'any', min: 0, value: String(c.metas[id]?.[campo] ?? ''),
    onChange: (e: { target: { value: string } }) => setC({ ...c, metas: { ...c.metas, [id]: { ...(c.metas[id] as Meta), [campo]: e.target.value as unknown as number } } }),
  })

  return (
    <Pagina titulo="Configurações" descricao="Regras da operação que você muda sem precisar de programador.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'loja', rotulo: 'Loja' },
            { id: 'horarios', rotulo: 'Horários' },
            { id: 'pedidos', rotulo: 'Pedidos' },
            { id: 'metas', rotulo: 'Metas e indicadores' },
            { id: 'impressao', rotulo: 'Impressão' },
            { id: 'financeiro', rotulo: 'Financeiro' },
            ...(ehAdmin ? [{ id: 'usuarios' as Aba, rotulo: 'Usuários' }, { id: 'permissoes' as Aba, rotulo: 'Permissões' }, { id: 'sistema' as Aba, rotulo: 'Sistema' }] : []),
          ]}
        />
      </div>

      {aba === 'loja' &&
        formulario(
          <>
            <Campo rotulo="Nome da loja">
              <Entrada required {...texto('nome_loja')} />
            </Campo>
            <Campo rotulo="Frase do rodapé">
              <Entrada {...texto('slogan')} />
            </Campo>
            <Campo rotulo="Telefone">
              <Entrada type="tel" {...texto('telefone')} />
            </Campo>
            <Campo rotulo="WhatsApp (com DDD)" dica="Usado nos botões “Falar com a pizzaria” de todo o site.">
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
            <p className="text-xs text-stone-500 sm:col-span-2">Logo, capa, banners e textos da página inicial ficam em Site e promoções.</p>
          </>,
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
          </>,
        )}

      {aba === 'pedidos' &&
        formulario(
          <>
            <h2 className="font-display text-lg font-semibold sm:col-span-2">Recebimento de pedidos</h2>
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

            <h2 className="mt-2 font-display text-lg font-semibold sm:col-span-2">Alertas de pedido parado</h2>
            <p className="-mt-2 text-sm text-stone-600 sm:col-span-2">Quantos minutos um pedido pode ficar na mesma etapa antes de cada nível de alerta aparecer no quadro de pedidos e na cozinha.</p>
            <div className="grid grid-cols-3 gap-3 sm:col-span-2">
              <Campo rotulo="Atenção (min)">
                <Entrada {...alerta('atencao')} />
              </Campo>
              <Campo rotulo="Atrasado (min)">
                <Entrada {...alerta('atrasado')} />
              </Campo>
              <Campo rotulo="Crítico (min)">
                <Entrada {...alerta('critico')} />
              </Campo>
            </div>

            <h2 className="mt-2 font-display text-lg font-semibold sm:col-span-2">Conta do cliente</h2>
            <div className="space-y-3 sm:col-span-2">
              <Alternar ativo={c.login_google} onChange={(v) => setC({ ...c, login_google: v })} rotulo="Oferecer entrada com Google" />
              <br />
              <Alternar ativo={c.login_facebook} onChange={(v) => setC({ ...c, login_facebook: v })} rotulo="Oferecer entrada com Facebook" />
              <br />
              <Alternar ativo={c.exigir_login} onChange={(v) => setC({ ...c, exigir_login: v })} rotulo="Só aceitar pedidos de clientes com conta" />
              <p className="text-xs text-stone-500">Os botões só funcionam depois que o Google e o Facebook forem ligados no painel do banco de dados (passo a passo no README).</p>
            </div>
          </>,
        )}

      {aba === 'metas' &&
        formulario(
          <>
            <p className="text-sm text-stone-600 sm:col-span-2">
              Defina o que é ruim e o que é bom para cada indicador. O painel mostra <b>Ruim</b>, <b>Médio</b> ou <b>Bom</b> ao lado de cada número; entre os dois valores fica Médio.
            </p>
            <div className="overflow-x-auto sm:col-span-2">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-stone-500 uppercase">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Indicador</th>
                    <th className="px-2 font-semibold">Ruim</th>
                    <th className="px-2 font-semibold">Bom</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {METAS.map((m) => {
                    const menor = c.metas[m.id]?.menor_melhor
                    return (
                      <tr key={m.id}>
                        <td className="py-2 pr-3">
                          <b>{m.nome}</b> <span className="text-stone-500">({m.unidade})</span>
                          <span className="block text-xs text-stone-500">{m.explicacao}</span>
                        </td>
                        <td className="px-2">
                          <label className="flex items-center gap-1 whitespace-nowrap text-stone-500">
                            {menor ? 'acima de' : 'abaixo de'} <Entrada aria-label={`${m.nome}: ruim`} className="w-24" {...meta(m.id, 'ruim')} />
                          </label>
                        </td>
                        <td className="px-2">
                          <label className="flex items-center gap-1 whitespace-nowrap text-stone-500">
                            {menor ? 'até' : 'a partir de'} <Entrada aria-label={`${m.nome}: bom`} className="w-24" {...meta(m.id, 'bom')} />
                          </label>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>,
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
                  Abra o painel por um atalho do Chrome com a opção <code className="rounded bg-white px-1">--kiosk-printing</code> (passo a passo no manual).
                </li>
              </ol>
              <Botao variante="secundario" className="mt-3" onClick={() => imprimirPedido(pedidoTeste, c)}>
                <Printer className="size-4" /> Imprimir cupom de teste
              </Botao>
            </div>
          </>,
        )}

      {aba === 'financeiro' &&
        formulario(
          <Campo rotulo="Categorias de despesa" className="sm:col-span-2" dica="Uma por linha. Aparecem ao lançar uma saída em Financeiro e nos relatórios.">
            <AreaTexto rows={12} value={categorias} onChange={(e) => setCategorias(e.target.value)} />
          </Campo>,
          'max-w-xl',
        )}

      {aba === 'usuarios' && ehAdmin && <Usuarios />}
      {aba === 'permissoes' && ehAdmin && <Permissoes />}
      {aba === 'sistema' && ehAdmin && <Sistema />}
    </Pagina>
  )
}
