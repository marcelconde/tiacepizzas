import { useState } from 'react'
import { Crud } from '../components/Crud'
import { Abas, Carregando, Erro, Tabela, Vazio } from '../components/ui'
import { brl, telefone } from '../lib/formato'
import { useLoja } from '../lib/loja'
import type { Bairro, Entregador } from '../lib/tipos'
import { Pagina } from './AdminLayout'
import { usePeriodo, useRelatorio } from './Painel'

function Acerto() {
  const { inicio, fim, seletor } = usePeriodo('hoje')
  const { dados: r, carregando, erro } = useRelatorio(inicio, fim)
  return (
    <>
      <div className="mb-4">{seletor}</div>
      {erro && <Erro>{erro}</Erro>}
      {!r ? (
        carregando && <Carregando />
      ) : r.por_entregador.length === 0 ? (
        <Vazio titulo="Nenhuma entrega com entregador definido no período" texto="Defina o entregador ao abrir o pedido para que ele apareça no acerto." />
      ) : (
        <Tabela colunas={['Entregador', 'Entregas', 'Taxas cobradas dos clientes', 'A pagar ao entregador']}>
          {r.por_entregador.map((e) => (
            <tr key={e.nome}>
              <td className="font-semibold">{e.nome}</td>
              <td className="tabular-nums">{e.entregas}</td>
              <td className="tabular-nums">{brl(e.taxas)}</td>
              <td className="font-semibold tabular-nums">{brl(e.a_pagar)}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </>
  )
}

export default function Entregas() {
  const [aba, setAba] = useState<'bairros' | 'entregadores' | 'acerto'>('bairros')
  const { recarregar } = useLoja()
  const simNao = (v: boolean) => (v ? 'Sim' : 'Não')

  return (
    <Pagina titulo="Entregas" descricao="Área de entrega, taxas e acerto com os entregadores.">
      <div className="mb-4">
        <Abas
          atual={aba}
          onChange={setAba}
          abas={[
            { id: 'bairros', rotulo: 'Bairros e taxas' },
            { id: 'entregadores', rotulo: 'Entregadores' },
            { id: 'acerto', rotulo: 'Acerto de entregas' },
          ]}
        />
      </div>

      {aba === 'bairros' && (
        <Crud<Bairro>
          tabela="bairros"
          nome="bairro"
          aoMudar={recarregar}
          texto={(b) => b.nome}
          colunas={[
            { rotulo: 'Bairro / região', render: (b) => <b>{b.nome}</b> },
            { rotulo: 'Taxa de entrega', classe: 'tabular-nums', render: (b) => (Number(b.taxa_entrega) > 0 ? brl(b.taxa_entrega) : 'Grátis') },
            { rotulo: 'Tempo extra', render: (b) => `${b.tempo_extra_min} min` },
            { rotulo: 'Atende', render: (b) => simNao(b.ativo) },
          ]}
          campos={[
            { nome: 'nome', rotulo: 'Nome do bairro ou região', obrigatorio: true, inteira: true },
            { nome: 'taxa_entrega', rotulo: 'Taxa de entrega (R$)', tipo: 'moeda', obrigatorio: true, padrao: 0 },
            { nome: 'tempo_extra_min', rotulo: 'Tempo extra (min)', tipo: 'numero', padrao: 0, obrigatorio: true, dica: 'Somado à previsão para bairros distantes.' },
            { nome: 'ativo', rotulo: 'Atendendo este bairro', tipo: 'booleano' },
          ]}
        />
      )}

      {aba === 'entregadores' && (
        <Crud<Entregador>
          tabela="entregadores"
          nome="entregador"
          colunas={[
            { rotulo: 'Nome', render: (e) => <b>{e.nome}</b> },
            { rotulo: 'Telefone', render: (e) => telefone(e.telefone) },
            { rotulo: 'Recebe por entrega', classe: 'tabular-nums', render: (e) => brl(e.valor_por_entrega) },
            { rotulo: 'Ativo', render: (e) => simNao(e.ativo) },
          ]}
          campos={[
            { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
            { nome: 'telefone', rotulo: 'Telefone' },
            { nome: 'valor_por_entrega', rotulo: 'Valor pago por entrega (R$)', tipo: 'moeda', padrao: 0, obrigatorio: true },
            { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano' },
          ]}
        />
      )}

      {aba === 'acerto' && <Acerto />}
    </Pagina>
  )
}
