// Roteiro do vídeo-tutorial: o que é dito (e vira legenda) e o que acontece na tela, capítulo por capítulo.
// Segue a ordem do manual (docs/manual/manual.html). Mudou uma tela? Ajuste aqui e rode "npm run video".
import {
  apontar, apontarCampo, apontarSel, cartao, cena, clicar, clicarEm, clicarSel, clicarTexto, dentro, digitar, dormir, fecharJanela,
  foraDoVideo, gravar, limpar, mostrar, mostrarTexto, preencher, rolar, rolarAte, rolarJanela, semCartao, topo,
} from './gravador.mjs'

/**
 * @param c contexto montado pelo gerar.mjs:
 *   site (cliente no computador), cel (cliente no celular), pc (painel), atend (painel da atendente), moto (motoboy),
 *   ir(pagina, rota, espera), api(caminho, opcoes), SENHA
 */
export function capitulos(c) {
  const { site, cel, pc, atend, moto, ir, api } = c
  const memoria = {} // o que um capítulo deixa para o outro (ex.: o pedido feito pelo site)

  /** Cartão de abertura sobre a página, com a fala de introdução; depois a tela do capítulo aparece. */
  async function abertura(p, rotulo, titulo, sub, fala, rota) {
    await cartao(p, rotulo, titulo, sub)
    await gravar(p)
    await cena(fala, null, { depois: 0.7 })
    if (rota) await foraDoVideo(() => ir(p, rota, 1100))
    else await semCartao(p)
  }
  const pedido = (situacao) => api(`pedidos?select=id,numero,codigo&status=eq.${situacao}&order=criado_em.desc&limit=1`).then((r) => r[0])
  const abrirPedido = async (numero) => {
    await preencher(pc, 'Buscar pedido pelo número', String(numero))
    await pc.keyboard.press('Enter')
    await dormir(1400)
  }

  return [
    // ===================================================================================== abertura
    {
      n: 0, titulo: 'Abertura',
      async gravar() {
        await abertura(site, 'Tutorial em vídeo', 'Tia Cê Pizzas', 'Todas as telas e funções do sistema: o site do cliente, o painel da equipe e o aplicativo do entregador.',
          'Olá! Este vídeo mostra, passo a passo, como usar o sistema da Tia Cê Pizzas. Ele tem três partes: o site, onde o cliente faz o pedido; o painel, onde a equipe trabalha; e o aplicativo do entregador.')
        await cartao(site, 'Antes de começar', 'Ambiente de demonstração', 'As telas foram gravadas com clientes, pedidos e valores fictícios. Nada aqui é dado real da pizzaria.')
        await cena('As telas foram gravadas em um ambiente de demonstração, com clientes e pedidos fictícios. Vamos começar pelo site, do jeito que o cliente vê.', null, { depois: 0.6 })
        await semCartao(site)
      },
    },

    // ===================================================================================== 1 site
    {
      n: 1, titulo: 'O site do cliente',
      async gravar() {
        await foraDoVideo(() => ir(site, '/'))
        await abertura(site, 'Capítulo 1', 'O site do cliente', 'Página inicial, cardápio, montagem da pizza, sacola, finalização e acompanhamento do pedido.',
          'Capítulo um: o site do cliente. Vale conhecer o que o cliente vê, para ajudar quando alguém ligar com dúvida.')

        await cena('Esta é a página inicial. No topo ficam o cardápio, o acompanhamento de pedido, a entrada na conta e a sacola. O selo verde mostra se a pizzaria está aberta agora.', async () => {
          await mostrar(site, 'Cardápio', 'header a'); await dormir(500)
          await mostrar(site, 'Acompanhar pedido', 'header a'); await dormir(500)
          await mostrarTexto(site, 'Aberto', 'header'); await dormir(700)
          await mostrar(site, 'Sacola', 'header button')
        })
        await cena('Rolando a página aparecem os banners, as promoções do dia e as pizzas mais pedidas. Tudo isso é montado por você, no painel, sem precisar de programador.', async () => {
          await rolar(site, 430, 1300); await rolar(site, 430, 1300); await rolar(site, 430, 900)
        })
        await cena('O botão verde abre uma conversa no WhatsApp da pizzaria.', async () => {
          await mostrar(site, 'Falar com a pizzaria', 'a'); await dormir(1200); await topo(site)
        })

        // --- no celular
        await foraDoVideo(() => ir(cel, '/cardapio'))
        await gravar(cel)
        await cena('A maioria dos clientes pede pelo celular, então vamos continuar por lá. No cardápio, os produtos aparecem por categoria, e dá para buscar por nome ou ingrediente.', async () => {
          await rolar(cel, 300, 900)
          await topo(cel)
          await preencher(cel, 'Buscar no cardápio', 'frango', { ritmo: 90 }); await dormir(1500)
          await limpar(cel, 'Buscar no cardápio')
        })
        await cena('Produtos em promoção ganham um selo amarelo e mostram o preço antigo riscado.', async () => {
          await mostrar(cel, 'Calabresa', 'main button', { pausa: 1500 })
        })
        await cena('Ao tocar em uma pizza, abre a tela de montagem. Primeiro o cliente escolhe o tamanho. Cada tamanho tem o seu preço.', async () => {
          await clicar(cel, 'Calabresa', 'main button', { espera: 1300 })
          await clicar(cel, 'Média', '[role=dialog] button'); await clicar(cel, 'Grande', '[role=dialog] button')
        })
        await cena('Depois decide se quer a pizza inteira ou dividida em dois sabores. O preço segue a regra que você definiu: o do sabor mais caro, ou a média.', async () => {
          await clicar(cel, '2 sabores', '[role=dialog] button')
          await preencher(cel, 'Sabor 2', 'Frango com Catupiry'); await dormir(600)
        })
        await cena('Escolhe a borda e os adicionais, e pode escrever uma observação, como: sem cebola.', async () => {
          await clicar(cel, 'Catupiry', '[role=dialog] button')
          await rolarJanela(cel, 420)
          await clicar(cel, 'Bacon extra', '[role=dialog] button')
          await preencher(cel, 'Ex.: sem cebola', 'Sem cebola, por favor')
        })
        await cena('Se você cadastrou, o cliente também vê os ingredientes e as informações nutricionais.', async () => {
          await clicar(cel, 'Informações nutricionais', '[role=dialog] summary'); await rolarJanela(cel, 2000, 1500)
        })
        await cena('O botão vermelho mostra o valor final e coloca a pizza na sacola.', async () => {
          await clicar(cel, 'Adicionar ·', '[role=dialog] button', { espera: 1000 })
        })
        await cena('Vamos juntar um refrigerante.', async () => {
          await clicar(cel, 'Coca-Cola 2L', 'main button', { espera: 1000 })
          await clicar(cel, 'Adicionar ·', '[role=dialog] button', { espera: 900 })
        })
        await cena('A sacola mostra os itens e o subtotal. Dá para mudar a quantidade ou esvaziar. Agora, finalizar o pedido.', async () => {
          await clicar(cel, 'Ver sacola', 'button', { espera: 2600 })
          await clicar(cel, 'Finalizar pedido', 'button', { espera: 1200 })
        })
        await cena('Na finalização, o cliente escolhe entrega ou retirada na loja, e informa o nome e o telefone. Não precisa criar conta.', async () => {
          await mostrar(cel, 'Retirar na loja', 'main button'); await dormir(600)
          await preencher(cel, 'Nome', 'Mariana Alves')
          await preencher(cel, 'WhatsApp', '11970000000')
        })
        await cena('Depois, o endereço. Aqui a pizzaria está cobrando a entrega por bairro: o cliente escolhe o bairro numa lista e já vê a taxa.', async () => {
          await preencher(cel, 'Rua / avenida', 'Rua Augusta')
          await preencher(cel, 'Número', '100')
          await preencher(cel, 'Bairro', 'Centro'); await dormir(800)
        })
        await cena('Escolhe como vai pagar na entrega: Pix, cartão ou dinheiro. No dinheiro, pode pedir troco.', async () => {
          await clicar(cel, 'Dinheiro', 'main button')
          await preencher(cel, 'Troco para quanto?', '100'); await dormir(500)
          await clicar(cel, 'Pix', 'main button')
        })
        await cena('Se tiver um cupom de desconto, aplica aqui. O resumo mostra o subtotal, a taxa de entrega, o desconto e o total.', async () => {
          await preencher(cel, 'Cupom de desconto', 'BEMVINDO10')
          await clicar(cel, 'Aplicar', 'main button', { espera: 1600 })
        })
        await cena('O preço que vale é sempre calculado pelo sistema, na hora do envio. Tocando em enviar pedido, ele chega na mesma hora ao painel da pizzaria.', async () => {
          await dormir(2500)
          await clicar(cel, 'Enviar pedido', 'button', { espera: 2600 })
        })
        memoria.codigo = new URL(cel.url()).searchParams.get('c')
        await cena('O cliente cai na tela de acompanhamento. Ela mostra o número do pedido, a previsão de entrega e cada etapa, com o horário. A tela se atualiza sozinha.', async () => {
          await dormir(2500); await rolar(cel, 330, 1500)
        })
        await cena('Como ele escolheu Pix, aparece a chave para copiar. E no fim da página há um botão que abre o WhatsApp já com a frase: olá, gostaria de falar sobre o pedido, e o número.', async () => {
          await rolarAte(cel, 'Pague com Pix', 'h2', 120); await mostrar(cel, 'Copiar chave', 'button', { pausa: 1500 })
          await rolar(cel, 700, 600); await mostrar(cel, 'Falar sobre este pedido', 'a')
        })

        const naRua = await pedido('saiu_entrega')
        await foraDoVideo(() => ir(cel, `/pedido?c=${naRua.codigo}`, 3500))
        await cena('Quando o pedido sai para entrega e o motoboy está com o aplicativo aberto, o cliente vê um mapa com a posição aproximada dele.', async () => {
          await dormir(3000); await rolar(cel, 260, 1500)
        })

        await foraDoVideo(() => ir(cel, '/entrar'))
        await cena('O cliente pode pedir sem cadastro. Mas, se preferir, entra com a conta do Google. Assim os endereços ficam guardados, e todos os pedidos aparecem em minha conta.', async () => {
          await dormir(1500)
          await clicar(cel, 'Continuar com Google', 'button', { espera: 2800 })
          await rolar(cel, 330, 1500)
        })
        await cena('A entrada com o Google precisa ser ligada uma vez, como explica o manual. Até lá, os clientes pedem sem cadastro.', async () => {
          await rolar(cel, 300, 1200); await topo(cel)
        })
      },
    },

    // ===================================================================================== 2 entrando no painel
    {
      n: 2, titulo: 'Entrando no painel',
      async gravar() {
        await foraDoVideo(() => ir(pc, '/admin'))
        await abertura(pc, 'Capítulo 2', 'Entrando no painel', 'O acesso da equipe, o menu e os avisos de pedido novo.',
          'Capítulo dois: entrando no painel. O painel da equipe fica no endereço do site, barra admin. Também há um link no rodapé do site: área da equipe.')
        await cena('Cada pessoa entra com o seu e-mail e a sua senha. Se esquecer a senha, é só clicar em esqueci a senha, que chega um link por e-mail.', async () => {
          await digitar(pc, 'input[type=email]', 'dona@teste.local')
          await digitar(pc, 'input[type=password]', c.SENHA)
          await mostrarTexto(pc, 'Esqueci', 'form').catch(() => {})
          await clicarSel(pc, 'button[type=submit]', { espera: 2800 })
        })
        await cena('À esquerda fica o menu, com as telas liberadas para a sua função. A administradora vê todas.', async () => {
          for (const item of ['Pedidos', 'Cozinha', 'Cardápio', 'Estoque', 'Financeiro', 'Configurações']) { await mostrar(pc, item, 'aside nav a', { pausa: 380 }) }
        })
        await cena('No pé do menu ficam o seu nome, o sinal que mostra se os pedidos estão chegando na hora, o alto-falante, que liga e desliga o som de pedido novo, a chave para trocar a senha, e o botão sair.', async () => {
          await mostrar(pc, 'Som de novos pedidos', 'aside button', { pausa: 2600 })
          await mostrar(pc, 'Trocar senha', 'aside button', { pausa: 1800 })
          await mostrar(pc, 'Sair', 'aside button', { pausa: 900 })
        })
        await cena('Quando há pedidos novos esperando, um número amarelo aparece ao lado de pedidos, e o painel toca um aviso sonoro.', async () => {
          await mostrar(pc, 'Pedidos', 'aside nav a', { pausa: 2500 })
        })
      },
    },

    // ===================================================================================== 3 pedidos
    {
      n: 3, titulo: 'Pedidos',
      async gravar() {
        const novo = memoria.codigo ? (await api(`pedidos?select=id,numero&codigo=eq.${memoria.codigo}`))[0] : await pedido('novo')
        const cartaoDo = (texto) => dentro(pc, 'article', `#${novo.numero}`, 'button', texto)
        await abertura(pc, 'Capítulo 3', 'Pedidos', 'O quadro do expediente: aceitar, acompanhar, cancelar, reembolsar e consultar o histórico.',
          'Capítulo três: pedidos. Esta é a tela principal do expediente. Deixe ela aberta no computador da loja o tempo todo.', '/admin/pedidos')
        await cena('A aba em andamento mostra um quadro com uma coluna para cada etapa: novos, confirmados, em preparo, prontos e em entrega.', async () => {
          for (const coluna of ['Novos', 'Confirmados', 'Em preparo', 'Prontos', 'Em entrega']) { await mostrarTexto(pc, coluna, 'main', { pausa: 620 }) }
        })
        await cena('Cada cartão é um pedido: o número, há quanto tempo chegou, o cliente, o bairro, os itens, o total e a forma de pagamento.', async () => {
          await apontar(pc, await cartaoDo(''), { pausa: 3000 })
        })
        await cena('O pedido que acabamos de fazer pelo site está aqui, em novos. Clicando em aceitar, ele é confirmado: o sistema dá baixa no estoque, calcula a previsão de entrega e imprime o cupom, se a impressora estiver ligada.', async () => {
          await dormir(3500)
          await clicarEm(pc, await cartaoDo('Aceitar'), { espera: 2200 })
        })
        await cena('O botão de cada cartão leva o pedido para a próxima etapa: iniciar preparo, marcar pronto, saiu para entrega e, por fim, entregue e recebido.', async () => {
          await dormir(1500)
          await clicarEm(pc, await cartaoDo('Iniciar preparo'), { espera: 2000 })
        })
        await cena('Quando um pedido fica parado tempo demais na mesma etapa, o cartão ganha uma borda colorida: amarela para atenção, laranja para atrasado e vermelha para crítico. A faixa no topo conta quantos estão em cada situação.', async () => {
          await mostrarTexto(pc, 'parados', 'main', { pausa: 2500 })
          await mostrarTexto(pc, 'Crítico', 'main', { pausa: 2500 }).catch(() => {})
        })
        await cena('Clicando no cartão, abrem os detalhes do pedido.', async () => {
          await clicarEm(pc, await cartaoDo(''), { espera: 1500 })
        })
        await cena('Aqui estão o cliente, o endereço, os itens com as observações, e o pagamento. O botão avisar no WhatsApp abre a conversa com o cliente, e o link de acompanhamento pode ser copiado e enviado.', async () => {
          await dormir(2500)
          await mostrarTexto(pc, 'Avisar no WhatsApp', '[role=dialog]', { pausa: 1800 })
          await mostrarTexto(pc, 'Link de acompanhamento', '[role=dialog]', { pausa: 1500 })
        })
        await cena('Em pedidos de entrega, escolha aqui o motoboy responsável. É assim que a entrega aparece no aplicativo dele.', async () => {
          await preencher(pc, 'Motoboy', 'Carlos'); await dormir(1200)
        })
        await cena('Quando o cliente paga, clique em confirmar pagamento. O valor entra sozinho no caixa aberto.', async () => {
          await clicar(pc, 'Confirmar pagamento', '[role=dialog] button', { espera: 1600 })
        })
        await cena('Mais abaixo fica o histórico de alterações: cada mudança de etapa e de pagamento, com o horário e quem fez.', async () => {
          await rolarJanela(pc, 900, 2500)
        })
        await cena('No rodapé: cozinha imprime a via da cozinha, imprimir tira o cupom do cliente, e o botão colorido leva o pedido para a próxima etapa.', async () => {
          await mostrar(pc, 'Cozinha', '[role=dialog] footer button', { pausa: 1500 })
          await mostrar(pc, 'Imprimir', '[role=dialog] footer button', { pausa: 1500 })
        })
        await cena('Cancelar pede o motivo. Os ingredientes voltam ao estoque e, se o pedido já estava pago, o valor é estornado do caixa.', async () => {
          await clicar(pc, 'Cancelar', '[role=dialog] footer button', { espera: 1200 })
          await preencher(pc, 'Motivo', 'Cliente desistiu'); await dormir(1800)
          await fecharJanela(pc); await fecharJanela(pc)
        })

        const naRua = await pedido('saiu_entrega')
        await cena('Para um pedido que está na rua existe o botão problema. Use quando o motoboy não conseguiu entregar. O pedido fica destacado, e depois você escolhe: tentar entregar de novo, cancelar ou reembolsar.', async () => {
          await abrirPedido(naRua.numero)
          await clicar(pc, 'Problema', '[role=dialog] footer button', { espera: 1200 })
          await preencher(pc, 'O que aconteceu?', 'Endereço não encontrado'); await dormir(2500)
          await fecharJanela(pc); await fecharJanela(pc)
        })
        const entregue = await pedido('entregue')
        await cena('E para um pedido já entregue existe o reembolso: o valor sai do caixa e o pedido sai do faturamento. O motivo é obrigatório.', async () => {
          await abrirPedido(entregue.numero)
          await clicar(pc, 'Reembolsar', '[role=dialog] footer button', { espera: 1200 })
          await preencher(pc, 'Motivo do reembolso', 'Pizza errada'); await dormir(1800)
          await fecharJanela(pc); await fecharJanela(pc)
        })
        await cena('Para achar um pedido pelo número, digite neste campo e aperte Enter. Já a aba histórico lista os pedidos por período: filtre por datas, situação e forma de pagamento.', async () => {
          await apontarCampo(pc, 'Buscar pedido pelo número', { pausa: 1800 })
          await clicar(pc, 'Histórico', '[role=tab]', { espera: 1800 })
          await apontarCampo(pc, 'De', { pausa: 900 }); await apontarCampo(pc, 'Situação', { pausa: 900 }); await apontarCampo(pc, 'Forma de pagamento', { pausa: 900 })
        })
        await cena('Os botões PDF, Excel e CSV exportam a lista que está na tela.', async () => {
          for (const f of ['PDF', 'Excel', 'CSV']) { await mostrar(pc, f, 'main button', { pausa: 600 }) }
          await rolar(pc, 260, 900); await topo(pc)
        }, { fala: 'Os botões pê dê efe, Excel e cê esse vê exportam a lista que está na tela.' })
      },
    },

    // ===================================================================================== 4 novo pedido
    {
      n: 4, titulo: 'Novo pedido',
      async gravar() {
        await abertura(pc, 'Capítulo 4', 'Novo pedido', 'Vendas no balcão e pedidos que chegam por telefone ou WhatsApp.',
          'Capítulo quatro: novo pedido. Use esta tela para as vendas no balcão e para os pedidos que chegam por telefone ou WhatsApp.', '/admin/pdv')
        await cena('À esquerda ficam os produtos, e à direita o pedido que está sendo montado. Primeiro escolha o tipo: balcão, retirada ou entrega.', async () => {
          await mostrar(pc, 'Balcão', 'form button', { pausa: 700 }); await mostrar(pc, 'Retirada', 'form button', { pausa: 700 })
          await clicar(pc, 'Entrega', 'form button')
        })
        await cena('Digite o telefone. Se o cliente já existe, o nome e o último endereço são preenchidos sozinhos.', async () => {
          await preencher(pc, 'Telefone', '11970000000', { ritmo: 70 })
          await pc.keyboard.press('Tab'); await dormir(2200)
        })
        await cena('Clique nos produtos para adicionar. As pizzas abrem a mesma tela de montagem do site: tamanho, sabores, borda e adicionais.', async () => {
          await clicar(pc, 'Quatro Queijos', 'form button', { espera: 1200 })
          await clicar(pc, '2 sabores', '[role=dialog] button')
          await preencher(pc, 'Sabor 2', 'Portuguesa'); await dormir(500)
          await clicar(pc, 'Adicionar ·', '[role=dialog] button', { espera: 900 })
          await clicar(pc, 'Guaraná Antarctica 2L', 'form button', { espera: 1000 })
          await clicar(pc, 'Adicionar ·', '[role=dialog] button', { espera: 900 })
        })
        await cena('Confira o endereço e o bairro, escolha o pagamento e, se quiser, informe desconto, troco e CPF na nota.', async () => {
          await preencher(pc, 'Bairro', 'Centro').catch(() => {})
          await preencher(pc, 'Pagamento', 'Dinheiro')
          await preencher(pc, 'Troco para', '100')
          await apontarCampo(pc, 'CPF na nota', { pausa: 900 })
        }, { fala: 'Confira o endereço e o bairro, escolha o pagamento e, se quiser, informe desconto, troco e cê pê efe na nota.' })
        await cena('A chave já foi pago registra o pagamento na hora, como acontece no balcão. Em entregas, deixe desligada: o pagamento é registrado ao concluir a entrega.', async () => {
          await mostrarTexto(pc, 'Já foi pago', 'form', { pausa: 3500 })
        })
        await cena('Clicando em lançar pedido, ele já entra como confirmado, dá baixa no estoque e segue para a cozinha.', async () => {
          await dormir(1500)
          await clicar(pc, 'Lançar pedido', 'form button', { espera: 2500 })
        })
      },
    },

    // ===================================================================================== 5 cozinha
    {
      n: 5, titulo: 'Cozinha',
      async gravar() {
        await abertura(pc, 'Capítulo 5', 'Cozinha', 'Só o que precisa ser feito, em letras grandes.',
          'Capítulo cinco: cozinha. Esta tela mostra só o que precisa ser feito, em letras grandes, do pedido mais antigo para o mais novo. Funciona bem em um tablet ou monitor na cozinha.', '/admin/cozinha')
        await cena('Cada cartão traz o número do pedido, se é entrega, retirada ou balcão, os itens com os adicionais, e as observações em destaque.', async () => {
          await apontarSel(pc, 'main article', { pausa: 3500 })
        })
        await cena('Iniciar preparo passa o pedido para em preparo. E pronto avisa o atendimento e o cliente de que a pizza saiu do forno.', async () => {
          await clicar(pc, 'Iniciar preparo', 'main button', { espera: 2000 })
          await clicar(pc, 'Pronto!', 'main button', { espera: 2000 })
        })
        await cena('As cores de alerta de atraso também aparecem aqui. Quem tem a função cozinha enxerga apenas esta tela.', async () => {
          await mostrarTexto(pc, 'nesta etapa', 'main', { pausa: 3000 }).catch(() => {})
        })
        await cena('No alto fica o botão registrar desperdício. Quando um ingrediente cai no chão, queima ou é usado errado, a cozinha registra na hora: o item, a quantidade e o que aconteceu. Dá para tocar em um motivo pronto.', async () => {
          await topo(pc)
          await clicar(pc, 'Registrar desperdício', 'main button', { espera: 1200 })
          await preencher(pc, 'Item do estoque', 'Calabresa'); await preencher(pc, 'Quantidade desperdiçada', '0,2')
          await clicar(pc, 'Queimou no forno', '[role=dialog] button', { espera: 1200 })
          await clicarSel(pc, '[role=dialog] button[type=submit]', { espera: 1800 })
        })
      },
    },

    // ===================================================================================== 6 clientes
    {
      n: 6, titulo: 'Clientes',
      async gravar() {
        await abertura(pc, 'Capítulo 6', 'Clientes', 'A lista de clientes e a ficha de cada um.',
          'Capítulo seis: clientes. O cliente é cadastrado sozinho no primeiro pedido que faz. A lista mostra quantos pedidos ele fez, quanto gastou, o ticket médio e quando comprou pela última vez.', '/admin/clientes')
        await cena('Dá para buscar por nome, telefone, e-mail ou número de pedido, e filtrar por tipo: novos, fiéis e sumidos, que são os que não pedem há mais de quarenta e cinco dias.', async () => {
          await preencher(pc, 'Buscar cliente', 'ana', { ritmo: 110 }); await dormir(1500)
          await limpar(pc, 'Buscar cliente')
          await apontarSel(pc, 'main select', { pausa: 2500 })
        })
        await cena('Exportar baixa a lista em planilha, útil para campanhas. E novo cliente cadastra à mão.', async () => {
          await mostrar(pc, 'Exportar', 'main button', { pausa: 1500 }); await mostrar(pc, 'Novo cliente', 'main button', { pausa: 1200 })
        })
        await cena('Clicando em um cliente abre a ficha: os dados, as observações, como alergias e preferências, o atalho do WhatsApp e os endereços.', async () => {
          await clicarSel(pc, 'main tbody tr', { espera: 1800 })
          await mostrarTexto(pc, 'Abrir WhatsApp', '[role=dialog]', { pausa: 1500 })
        })
        await cena('Mais abaixo, as compras: total de pedidos e de pizzas, total gasto, ticket médio, os produtos que ele mais compra e as datas de cada pedido. Clicar em um pedido abre os detalhes.', async () => {
          await rolarJanela(pc, 420, 2600); await rolarJanela(pc, 900, 2600)
          await fecharJanela(pc)
        })
      },
    },

    // ===================================================================================== 7 cardápio
    {
      n: 7, titulo: 'Cardápio',
      async gravar() {
        await abertura(pc, 'Capítulo 7', 'Cardápio', 'Produtos, preços, fotos, informações nutricionais e ficha técnica.',
          'Capítulo sete: cardápio. Aqui você controla o que aparece no site e quanto custa. São quatro abas: produtos, categorias, tamanhos de pizza, e bordas e adicionais.', '/admin/cardapio')
        await cena('Acabou um sabor? Desligue a chave disponível. O produto continua no cardápio, apagado, com o aviso: indisponível hoje. Ninguém consegue pedir. Ligue de novo quando voltar. A mudança vale na hora.', async () => {
          const chave = await dentro(pc, 'main li', 'Marguerita', '[role=switch], label', '')
          await clicarEm(pc, chave, { espera: 3200 })
          await clicarEm(pc, chave, { espera: 1500 })
        })
        await cena('O lápis abre o cadastro do produto: nome, categoria, descrição, e o preço de cada tamanho. Deixe em branco o tamanho que você não vende.', async () => {
          await clicarEm(pc, await dentro(pc, 'main li', 'Calabresa', '[aria-label=Editar]'), { espera: 1500 })
          await apontarCampo(pc, 'Broto', { pausa: 600 }); await apontarCampo(pc, 'Grande', { pausa: 600 }); await apontarCampo(pc, 'Família', { pausa: 900 })
        })
        await cena('Mais abaixo: a foto, e as chaves disponível hoje, destaque na capa, que põe o produto na página inicial, e aparece no cardápio, para esconder de vez sem apagar.', async () => {
          await rolarJanela(pc, 330, 1500)
          await mostrarTexto(pc, 'Destaque na capa', '[role=dialog]', { pausa: 2200 })
          await mostrarTexto(pc, 'Aparece no cardápio', '[role=dialog]', { pausa: 1800 })
        })
        await cena('Depois, os ingredientes e as informações nutricionais: porção, calorias, carboidratos, proteínas, gorduras, sódio e alergênicos. Elas aparecem para o cliente na tela do produto.', async () => {
          await rolarJanela(pc, 2500, 3500)
        })
        await cena('Para tirar do site um produto que já foi vendido, prefira desligar aparece no cardápio em vez de excluir. Os pedidos antigos continuam no histórico de qualquer forma.', async () => {
          await dormir(2500); await fecharJanela(pc)
        })
        await cena('O botão da balança abre a ficha técnica: quanto de cada insumo vai em uma unidade do produto, por tamanho. É ela que permite a baixa automática do estoque.', async () => {
          await clicarEm(pc, await dentro(pc, 'main li', 'Calabresa', '[aria-label="Ficha técnica"]'), { espera: 1800 })
          await rolarJanela(pc, 300, 2500)
          await fecharJanela(pc)
        })
        await cena('Em categorias, você marca quais são de pizza, com preço por tamanho. Em tamanhos de pizza, define o nome, o número de fatias e quantos sabores cada tamanho aceita.', async () => {
          await clicar(pc, 'Categorias', 'main [role=tab]', { espera: 2800 })
          await clicar(pc, 'Tamanhos de pizza', 'main [role=tab]', { espera: 2500 })
        })
        await cena('E em bordas e adicionais ficam as bordas recheadas e os extras, com o preço de cada um.', async () => {
          await clicar(pc, 'Bordas e adicionais', 'main [role=tab]', { espera: 2500 })
        })
      },
    },

    // ===================================================================================== 8 site e promoções
    {
      n: 8, titulo: 'Site e promoções',
      async gravar() {
        await abertura(pc, 'Capítulo 8', 'Site e promoções', 'Página inicial, banners, promoções, cupons e a tela do produto.',
          'Capítulo oito: site e promoções. Esta tela muda o que o cliente vê, sem mexer em programação. São cinco abas.', '/admin/conteudo')
        await cena('Em página inicial, você envia o logo, escreve o título e a frase da capa, e pode trocar a imagem da pizza por uma foto sua.', async () => {
          await apontarCampo(pc, 'Título da capa', { pausa: 1500 }); await apontarCampo(pc, 'Frase de apresentação', { pausa: 1500 })
        })
        await cena('Ao lado ficam as seções da página: capa, banners, promoções, destaques e como funciona. As setas mudam a ordem, a chave liga ou desliga cada uma, e a lista define o tamanho.', async () => {
          await clicar(pc, 'Descer Banners', 'main button', { espera: 1400 })
          await clicar(pc, 'Subir Banners', 'main button', { espera: 1400 })
          await apontarCampo(pc, 'Tamanho de Promoções', { pausa: 1500 })
        })
        await cena('Mais abaixo ficam os textos: os títulos das seções e os três passos de como funciona. Depois de mexer, clique em salvar página inicial.', async () => {
          await rolarAte(pc, 'Textos', 'h2, h3', 100); await dormir(1500)
          await mostrar(pc, 'Salvar página inicial', 'main button', { pausa: 1500 })
        })
        await cena('Na aba banners, cada banner tem título, texto de apoio, cor de fundo ou imagem, e pode levar a um link. A pré-visualização mostra como ele fica.', async () => {
          await topo(pc)
          await clicar(pc, 'Banners', 'main [role=tab]', { espera: 1200 })
          await clicar(pc, 'Pré-visualizar', 'main summary', { espera: 2500 })
        })
        await cena('No cadastro do banner você escolhe onde ele aparece: no topo ou no meio da página inicial, no topo do cardápio, antes de uma categoria ou no fim do cardápio. E também o tamanho, a ordem e o período em que fica visível.', async () => {
          await clicarSel(pc, 'main tbody [aria-label=Editar]', { espera: 1500 })
          await rolarJanela(pc, 320, 3000); await rolarJanela(pc, 900, 2500)
          await fecharJanela(pc)
        })
        await cena('Promoções dão desconto em um ou mais produtos. Enquanto valem, o produto ganha o selo no cardápio e o preço antigo aparece riscado.', async () => {
          await clicar(pc, 'Promoções', 'main [role=tab]', { espera: 2500 })
        })
        await cena('No cadastro, você escolhe o tipo de desconto: percentual, valor em reais ou preço fixo. Marca os produtos participantes. E define quando vale: datas, horário e dias da semana. Por exemplo: terça da calabresa.', async () => {
          await clicarSel(pc, 'main tbody [aria-label=Editar]', { espera: 1800 })
          await rolarJanela(pc, 300, 3200); await rolarJanela(pc, 900, 3200)
          await fecharJanela(pc)
        })
        await cena('Cupons são códigos que o cliente digita na finalização. Você define o desconto, o pedido mínimo, a validade e o limite de usos.', async () => {
          await clicar(pc, 'Cupons', 'main [role=tab]', { espera: 1200 })
          await mostrar(pc, 'Novo cupom', 'main button', { pausa: 2000 })
        })
        await cena('E em tela do produto, você escolhe o que o cliente vê ao tocar em um produto: foto, descrição, ingredientes, informações nutricionais, complementos e observações.', async () => {
          await clicar(pc, 'Tela do produto', 'main [role=tab]', { espera: 3500 })
        })
      },
    },

    // ===================================================================================== 9 estoque
    {
      n: 9, titulo: 'Estoque',
      async gravar() {
        await abertura(pc, 'Capítulo 9', 'Estoque', 'Insumos, compras, perdas e a baixa automática.',
          'Capítulo nove: estoque. Ele controla os insumos: farinha, queijo, caixas de pizza, refrigerantes. As vendas dão baixa sozinhas, pela ficha técnica. Você só registra o que entra e o que se perde.', '/admin/estoque')
        await cena('A lista mostra a quantidade em estoque, o mínimo, o custo médio e o valor. Quando um insumo fica abaixo do mínimo, ele ganha o selo repor, e aparece no aviso amarelo do painel.', async () => {
          await mostrar(pc, 'EM ESTOQUE', 'main th', { pausa: 900 }); await mostrar(pc, 'MÍNIMO', 'main th', { pausa: 900 }); await mostrar(pc, 'CUSTO MÉDIO', 'main th', { pausa: 900 })
          await mostrarTexto(pc, 'Repor', 'main', { pausa: 2000 }).catch(() => {})
        })
        await cena('A baixa acontece quando o pedido é confirmado. Por exemplo: se a ficha técnica diz que uma pizza usa duzentos e cinquenta gramas de farinha, três pizzas confirmadas tiram setecentos e cinquenta gramas do estoque. Se o pedido for cancelado, os ingredientes voltam.', async () => {
          await rolar(pc, 250, 3000); await topo(pc)
        })
        await cena('Na entrada, que é a compra, informe a quantidade e o custo. O sistema recalcula o custo médio, que é usado para estimar o custo das vendas.', async () => {
          await clicar(pc, 'Entrada', 'main tbody button', { espera: 1200 })
          await preencher(pc, 'Quantidade', '10'); await preencher(pc, 'Custo por', '42,50')
          await clicarSel(pc, '[role=dialog] button[type=submit]', { espera: 1600 })
        })
        await cena('O botão ao lado registra saída para uso interno, perda por vencimento ou quebra, e ajuste de contagem: você digita o que contou na prateleira, e o sistema calcula a diferença.', async () => {
          await clicar(pc, 'Saída, perda ou ajuste', 'main tbody button', { espera: 3500 })
          await fecharJanela(pc)
        })
        await cena('A aba desperdício serve para o que se perde no preparo: a porção de queijo que caiu no chão, a pizza que queimou. Esse ingrediente saiu do estoque, mas nenhuma venda deu baixa nele.', async () => {
          await clicar(pc, 'Desperdício', 'main [role=tab]', { espera: 2500 })
        })
        await cena('Escolha o item do estoque, informe a quantidade e escreva o que aconteceu. O motivo é obrigatório, porque é ele que fica registrado. Clicando em registrar, a quantidade sai do estoque na hora.', async () => {
          await preencher(pc, 'Item do estoque', 'Mussarela'); await preencher(pc, 'Quantidade desperdiçada', '0,25')
          await preencher(pc, 'O que aconteceu?', 'A porção caiu no chão ao montar a pizza')
          await clicarSel(pc, 'main form button[type=submit]', { espera: 2000 })
        })
        await cena('Ao lado ficam os registros do período: data, item, quantidade, valor, motivo e quem registrou. Os quadros do alto somam o valor desperdiçado e mostram o que mais se perde. Esse valor entra no financeiro, junto com as perdas.', async () => {
          await mostrarTexto(pc, 'Valor desperdiçado no período', 'main', { pausa: 3000 })
          await mostrarTexto(pc, 'O que mais se perde', 'main', { pausa: 2500 })
          await mostrar(pc, 'QUEM REGISTROU', 'main th', { pausa: 2500 })
          await topo(pc)
          await clicar(pc, 'Insumos', 'main [role=tab]', { espera: 1200 })
        })
        await cena('Novo insumo cadastra o nome, a unidade de medida, o estoque mínimo e o fornecedor.', async () => {
          await mostrar(pc, 'Novo insumo', 'main button', { pausa: 2500 })
        })
        await cena('A aba movimentações lista tudo o que entrou e saiu, inclusive as baixas de cada pedido. E fornecedores guarda nome, telefone e CNPJ.', async () => {
          await clicar(pc, 'Movimentações', 'main [role=tab]', { espera: 3500 })
          await clicar(pc, 'Fornecedores', 'main [role=tab]', { espera: 2000 })
        }, { fala: 'A aba movimentações lista tudo o que entrou e saiu, inclusive as baixas de cada pedido. E fornecedores guarda nome, telefone e cê ene pê jota.' })
      },
    },

    // ===================================================================================== 10 caixa
    {
      n: 10, titulo: 'Caixa',
      async gravar() {
        await abertura(pc, 'Capítulo 10', 'Caixa', 'Abertura, sangria, suprimento e fechamento.',
          'Capítulo dez: caixa. Ele controla o dinheiro do expediente. No começo do dia, conte o troco que está na gaveta, digite em troco inicial e abra o caixa. Só pode haver um caixa aberto por vez.', '/admin/caixa')
        await cena('Com o caixa aberto, toda vez que um pedido é marcado como pago, a venda entra aqui sozinha, separada por forma de pagamento: dinheiro, Pix, crédito e débito.', async () => {
          await mostrarTexto(pc, 'Recebido por forma de pagamento', 'main', { pausa: 2500 })
          await rolar(pc, 300, 2200)
        })
        await cena('O quadro escuro, dinheiro na gaveta, mostra quanto deve haver em espécie: troco inicial, mais vendas em dinheiro, mais suprimentos, menos sangrias.', async () => {
          await topo(pc)
          await mostrarTexto(pc, 'na gaveta', 'main', { pausa: 4000 })
        })
        await cena('Sangria registra quando você tira dinheiro da gaveta: para pagar o gás, levar ao banco ou dar troco. O motivo é obrigatório.', async () => {
          await clicar(pc, 'Sangria', 'main button', { espera: 1000 })
          await preencher(pc, 'Valor', '80'); await preencher(pc, 'Motivo', 'Pagamento do gás')
          await clicarSel(pc, '[role=dialog] button[type=submit]', { espera: 1600 })
        })
        await cena('Suprimento é o contrário: registra quando você coloca dinheiro, como um reforço de troco.', async () => {
          await mostrar(pc, 'Suprimento', 'main button', { pausa: 3000 })
        })
        await cena('No fim do dia, clique em fechar caixa, conte o dinheiro e informe o valor. O sistema compara com o esperado e mostra se bateu, sobrou ou faltou.', async () => {
          await clicar(pc, 'Fechar caixa', 'main button', { espera: 1200 })
          await preencher(pc, 'Dinheiro contado', '150'); await dormir(3500)
          await fecharJanela(pc)
        })
        await cena('Os caixas fechados ficam guardados na lista de caixas anteriores. Clique em um deles para rever os movimentos.', async () => {
          await rolar(pc, 700, 2500); await topo(pc)
        })
        await cena('Um cuidado: se você marcar um pedido como pago sem ter um caixa aberto, o pagamento fica registrado no pedido, mas não entra no controle do caixa.', async () => {
          await dormir(2000)
        })
      },
    },

    // ===================================================================================== 11 entregas
    {
      n: 11, titulo: 'Entregas',
      async gravar() {
        await abertura(pc, 'Capítulo 11', 'Entregas', 'Taxa por bairro ou por distância, entregadores e acerto.',
          'Capítulo onze: entregas. Aqui você define onde entrega, quanto cobra e quem entrega.', '/admin/entregas')
        await cena('A taxa pode ser calculada de dois modos. Por bairro: você cadastra os bairros atendidos e a taxa de cada um, e o cliente escolhe o bairro numa lista. Só consegue pedir entrega quem mora nos bairros cadastrados.', async () => {
          await mostrarTexto(pc, 'Por bairro', 'main', { pausa: 2500 })
          await mostrar(pc, 'Novo bairro', 'main button', { pausa: 2000 })
          await mostrar(pc, 'TAXA DE ENTREGA', 'main th', { pausa: 1500 })
        })
        await cena('Ou por distância: o sistema localiza o endereço do cliente no mapa, mede a distância até a loja e aplica a faixa de preço correspondente.', async () => {
          await clicarTexto(pc, 'Por distância', 'main', { espera: 4500 })
        })
        await cena('Você marca o ponto da loja no mapa e cadastra as faixas. Por exemplo: até três quilômetros, cinco reais; até cinco quilômetros, oito reais. A maior faixa é o raio máximo de entrega. Os círculos no mapa mostram cada faixa.', async () => {
          await rolar(pc, 320, 3500); await rolar(pc, 200, 3000)
        })

        // o cliente, com a entrega por distância ligada
        await foraDoVideo(async () => {
          await ir(site, '/cardapio')
          await site.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.includes('Mussarela')).click()); await dormir(700)
          await site.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.includes('Adicionar ·')).click()); await dormir(500)
          await ir(site, '/checkout')
          await gravar(site)
        })
        await cena('Com esse modo ligado, na finalização o cliente digita o endereço, e o site mostra o ponto no mapa e a taxa calculada.', async () => {
          await preencher(site, 'Nome', 'Fernanda Costa'); await preencher(site, 'WhatsApp', '11972000000')
          await preencher(site, 'Rua / avenida', 'Rua Augusta'); await preencher(site, 'Número', '1500')
          await site.keyboard.press('Tab')
        })
        await foraDoVideo(async () => {
          await dormir(6000) // a localização do endereço depende da internet: o espectador vê só o resultado
          if (!(await site.evaluate(() => document.body.innerText.includes('Entregamos aí')))) {
            await site.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Marcar manualmente'))?.click()); await dormir(3000)
          }
        })
        await cena('Se o endereço estiver fora do raio, aparece o aviso: este endereço está fora da nossa área de entrega. E o pedido não é enviado. Se o pino cair no lugar errado, o cliente pode arrastar.', async () => {
          await rolarAte(site, 'Endereço de entrega', 'h2', 80); await dormir(4000)
        })
        await foraDoVideo(async () => {
          await api('configuracoes?id=eq.1', { method: 'PATCH', body: JSON.stringify({ modo_entrega: 'bairro' }), headers: { prefer: 'return=minimal' } })
          await ir(pc, '/admin/entregas')
          await gravar(pc)
        })
        await cena('Na aba entregadores fica a lista de quem faz entregas, quanto cada um recebe por entrega, e se tem acesso ao aplicativo. A chave no topo liga ou desliga o mapa do motoboy na tela do cliente.', async () => {
          await clicar(pc, 'Entregadores', 'main [role=tab]', { espera: 1500 })
          await mostrarTexto(pc, 'Mostrar a posição do motoboy', 'main', { pausa: 2500 })
          await mostrar(pc, 'RECEBE POR ENTREGA', 'main th', { pausa: 1500 }); await mostrar(pc, 'APLICATIVO', 'main th', { pausa: 1500 })
        })
        await cena('E em acerto de entregas, escolha o período e veja, por entregador, quantas entregas fez, quanto os clientes pagaram de taxa, e quanto a pizzaria deve a ele. Dá para exportar. Depois de pagar, lance a saída no financeiro, na categoria motoboys.', async () => {
          await clicar(pc, 'Acerto de entregas', 'main [role=tab]', { espera: 1500 })
          await clicar(pc, 'Mês', 'main button', { espera: 2500 })
          await mostrar(pc, 'A PAGAR AO ENTREGADOR', 'main th', { pausa: 2500 })
        })
      },
    },

    // ===================================================================================== 12 motoboy
    {
      n: 12, titulo: 'Aplicativo do motoboy',
      async gravar() {
        // o cartão de abertura fica na tela grande; depois a gravação passa para o celular do motoboy
        await foraDoVideo(() => ir(moto, '/entregador'))
        await cartao(pc, 'Capítulo 12', 'Aplicativo do motoboy', 'As entregas do dia, a rota, o contato com o cliente e a localização.')
        await gravar(pc)
        await cena('Capítulo doze: o aplicativo do motoboy. Ele não precisa instalar nada. Abre o endereço do site, barra entregador, no navegador do celular, e entra com o e-mail e a senha dele.', null, { depois: 0.7 })
        await foraDoVideo(async () => { await semCartao(pc); await gravar(moto) })
        await cena('Para ficar com cara de aplicativo, basta usar a opção adicionar à tela inicial, do navegador.', async () => {
          await digitar(moto, 'input[type=email]', 'carlos@teste.local')
          await digitar(moto, 'input[type=password]', c.SENHA)
          await clicarSel(moto, 'button[type=submit]', { espera: 3200 })
        })
        await cena('Ele vê apenas as entregas que a pizzaria atribuiu a ele. Cada cartão mostra o endereço e a referência em letras grandes, os itens, e uma faixa colorida com o valor a cobrar, ou o aviso de que já está pago.', async () => {
          await dormir(2500); await rolar(moto, 240, 3500); await rolar(moto, 240, 2500)
        })
        await cena('Os botões Waze e Google Maps abrem o trajeto até o cliente. Ligar e WhatsApp falam com ele.', async () => {
          await topo(moto)
          await mostrar(moto, 'Waze', 'main a, main button', { pausa: 1300 }); await mostrar(moto, 'Google Maps', 'main a, main button', { pausa: 1300 })
          await mostrar(moto, 'Ligar', 'main a, main button', { pausa: 900 }); await mostrar(moto, 'WhatsApp', 'main a, main button', { pausa: 900 })
        })
        await cena('Quando o pedido fica pronto, ele toca em saí para entregar, e o cliente é avisado. Ao chegar, toca em entreguei e recebi, que conclui a entrega e registra o pagamento.', async () => {
          // se houver um pedido pronto esperando, o motoboy sai com ele; senão, só mostramos o botão de concluir
          await clicar(moto, 'Saí para entregar', 'main button', { espera: 2200 }).catch(() => {})
          await mostrar(moto, 'Entreguei e recebi', 'main button', { pausa: 3500 })
        })
        await cena('Se algo der errado, ele toca em tive um problema e escolhe o motivo: cliente não atende, endereço não encontrado. A pizzaria e o cliente são avisados na hora.', async () => {
          await clicar(moto, 'Tive um problema', 'main button', { espera: 1800 })
          await clicar(moto, 'Cliente não atende', '[role=dialog] button', { espera: 2500 })
          await fecharJanela(moto)
        })
        await cena('Enquanto há uma entrega na rua, o celular envia a posição a cada quinze segundos, e o cliente acompanha no mapa. Pelo navegador, o envio pausa quando o motoboy abre o Waze ou bloqueia o celular, e volta quando ele retorna a esta tela.', async () => {
          await topo(moto); await dormir(5500)
        })
        await cena('Para o envio continuar com o Waze aberto, existe o aplicativo Tia Cê Entregas, para Android: é esta mesma tela, instalada no celular. Ele ainda está em fase de testes. O manual explica como instalar.', async () => {
          await mostrarTexto(moto, 'use o aplicativo Tia Cê Entregas', 'body', { pausa: 5000 }).catch(() => {})
        })
        await cena('Tocando em entreguei e recebi, a entrega é concluída e some da lista.', async () => {
          await clicar(moto, 'Entreguei e recebi', 'main button', { espera: 2800 })
        })
      },
    },

    // ===================================================================================== 13 financeiro
    {
      n: 13, titulo: 'Financeiro',
      async gravar() {
        await foraDoVideo(() => gravar(pc))
        await abertura(pc, 'Capítulo 13', 'Financeiro', 'Entradas, saídas, resultado e relatórios.',
          'Capítulo treze: financeiro. Ele mostra as entradas, as saídas e o resultado do período que você escolher.', '/admin/financeiro')
        await cena('No alto, escolha o período: hoje, semana, mês, ano, trinta dias, mês passado, ou duas datas quaisquer. Ao lado ficam os filtros de categoria de despesa e de forma de pagamento.', async () => {
          await clicar(pc, '30 dias', 'main button', { espera: 2000 })
          await apontarSel(pc, 'main input[type=date]', { pausa: 1500 }); await apontarSel(pc, 'main select', { pausa: 1500 })
        })
        await cena('O resumo traz o faturamento bruto, que é a soma dos pedidos válidos, sem cancelados nem reembolsados. Mostra o que já foi recebido e o que falta receber, as saídas, e o resultado do período.', async () => {
          await rolar(pc, 260, 3500); await rolar(pc, 300, 3000)
        })
        await cena('O resultado é o faturamento menos o custo dos insumos vendidos, as perdas de estoque e as despesas. É uma estimativa para acompanhar o negócio: só fica fiel se as despesas forem lançadas e as fichas técnicas e as compras estiverem em dia. Não substitui a contabilidade.', async () => {
          await mostrarTexto(pc, 'Resultado do período', 'main', { pausa: 4500 }).catch(() => {})
          await rolar(pc, 320, 4000)
        })
        await cena('A aba faturamento por período mostra o gráfico e a tabela, por dia, semana ou mês. Na visão por dia, cada linha diz se o dia foi bom, médio ou ruim em relação à meta.', async () => {
          await topo(pc)
          await clicar(pc, 'Faturamento por período', 'main [role=tab]', { espera: 2500 })
          await rolar(pc, 420, 3500)
        })
        await cena('Entradas lista os pedidos do período, com a forma de pagamento e se já foram recebidos.', async () => {
          await topo(pc)
          await clicar(pc, 'Entradas', 'main [role=tab]', { espera: 3000 })
        })
        await cena('E saídas é onde você lança os gastos. Clique em nova despesa e informe a descrição, o valor, a data, a categoria e a forma de pagamento.', async () => {
          await clicar(pc, 'Saídas (despesas)', 'main [role=tab]', { espera: 1500 })
          await clicar(pc, 'Nova despesa', 'main button', { espera: 1200 })
          await preencher(pc, 'Descrição', 'Conta de luz'); await preencher(pc, 'Valor', '684,30'); await preencher(pc, 'Categoria', 'Energia')
          await dormir(1500); await fecharJanela(pc)
        })
        await cena('Os botões PDF, Excel e CSV, no alto, geram o relatório do período, com os filtros escolhidos: resultado, entradas por forma de pagamento, faturamento, saídas por categoria e as listas detalhadas. No Excel, cada parte vem em uma aba.', async () => {
          for (const f of ['PDF', 'Excel', 'CSV']) { await mostrar(pc, f, 'main button', { pausa: 1500 }) }
        }, { fala: 'Os botões pê dê efe, Excel e cê esse vê, no alto, geram o relatório do período, com os filtros escolhidos: resultado, entradas por forma de pagamento, faturamento, saídas por categoria e as listas detalhadas. No Excel, cada parte vem em uma aba.' })
      },
    },

    // ===================================================================================== 14 painel
    {
      n: 14, titulo: 'Painel de indicadores',
      async gravar() {
        await abertura(pc, 'Capítulo 14', 'Painel de indicadores', 'Faturamento, metas e gráficos.',
          'Capítulo quatorze: o painel de indicadores. Ele resume o desempenho do período escolhido, e se atualiza conforme os pedidos chegam.', '/admin/painel')
        await cena('Os indicadores são: faturamento, número de pedidos, ticket médio, valor a receber, tempo de preparo, tempo até a entrega, cancelamentos e clientes atendidos. A seta mostra a variação em relação ao período anterior, do mesmo tamanho.', async () => {
          await clicar(pc, '30 dias', 'main button', { espera: 2500 })
          await mostrarTexto(pc, 'Ticket médio', 'main', { pausa: 2500 }).catch(() => {})
          await mostrarTexto(pc, 'Cancelamentos', 'main', { pausa: 2500 }).catch(() => {})
        })
        await cena('A bolinha colorida diz se o número está bom, médio ou ruim, de acordo com as metas que você define em configurações. E a linha logo abaixo conta quantos dias do período foram bons, médios e ruins.', async () => {
          await mostrarTexto(pc, 'Dias do período', 'main', { pausa: 4000 }).catch(() => {})
        })
        await cena('Se algum insumo estiver abaixo do mínimo, uma faixa amarela avisa aqui no topo.', async () => {
          await mostrarTexto(pc, 'abaixo do mínimo', 'main', { pausa: 3000 }).catch(() => {})
        })
        await cena('Abaixo vêm os gráficos: faturamento por dia, pedidos por horário, faturamento por dia da semana, os mais vendidos, os clientes que mais gastaram, as formas de pagamento, os bairros que mais pedem, os canais de venda e as modalidades. Passe o mouse sobre um ponto ou barra para ver o valor.', async () => {
          await rolarAte(pc, 'Faturamento por dia', 'h2', 90); await dormir(2200)
          await rolarAte(pc, 'Pedidos por horário', 'h2', 90); await dormir(2600)
          await rolarAte(pc, 'Mais vendidos', 'h2', 90); await dormir(2600)
          await rolarAte(pc, 'Formas de pagamento', 'h2', 90); await dormir(2600)
          await rolar(pc, 500, 2000)
        })
      },
    },

    // ===================================================================================== 15 análises
    {
      n: 15, titulo: 'Análises',
      async gravar() {
        await abertura(pc, 'Capítulo 15', 'Análises', 'Ranking de produtos e de clientes.',
          'Capítulo quinze: análises. Esta tela responde a perguntas como: qual pizza mais vendeu este mês? E qual cliente mais comprou?', '/admin/analises')
        await cena('Na aba produtos, os quadros do alto mostram o mais vendido, o de maior faturamento e o menos vendido. A tabela lista todos, com a quantidade, o faturamento e a participação nas vendas. Pizza de dois sabores conta meio para cada sabor.', async () => {
          await clicar(pc, '30 dias', 'main button', { espera: 2500 })
          await rolar(pc, 300, 4500)
        })
        await cena('Na aba clientes, o ranking de quem mais gastou e de quem mais pediu.', async () => {
          await topo(pc)
          await clicar(pc, 'Clientes', 'main [role=tab]', { espera: 3000 })
        })
        await cena('Clicando em um cliente, você vê, só daquele período, o número de pedidos e de pizzas, o total gasto, o ticket médio, os produtos comprados e as datas.', async () => {
          await clicarSel(pc, 'main tbody tr', { espera: 2200 })
          await rolarJanela(pc, 350, 3000)
          await fecharJanela(pc)
        })
        await cena('As duas listas podem ser exportadas. Use para decidir promoções: um produto parado pode ganhar desconto, e um cliente sumido pode receber um cupom.', async () => {
          for (const f of ['PDF', 'Excel', 'CSV']) { await mostrar(pc, f, 'main button', { pausa: 900 }) }
        })
      },
    },

    // ===================================================================================== 16 fiscal e impressão
    {
      n: 16, titulo: 'Nota fiscal e impressão',
      async gravar() {
        await abertura(pc, 'Capítulo 16', 'Nota fiscal e impressão', 'O que está pronto e o que ainda precisa ser configurado.',
          'Capítulo dezesseis: nota fiscal e impressão. O sistema está preparado para emitir a nota fiscal de consumidor eletrônica, mas a emissão vem desligada. Enquanto isso, o cupom impresso sai com o aviso: não é documento fiscal.', '/admin/fiscal')
        await cena('Na aba configuração ficam os dados da empresa, o ambiente de testes ou de produção, e os códigos de tributação. Ao lado, o passo a passo do que é preciso: inscrição estadual, certificado digital e conta no serviço emissor.', async () => {
          await clicar(pc, 'Configuração', 'main [role=tab]', { espera: 2500 })
          await mostrarTexto(pc, 'Para emitir nota fiscal', 'main', { pausa: 3000 }).catch(() => {})
          await rolar(pc, 280, 3000)
        })
        await cena('Atenção: a emissão foi programada, mas ainda não foi testada com uma conta de verdade. Confira tudo com a contabilidade e faça os testes no ambiente de homologação antes de usar.', async () => {
          await topo(pc); await dormir(4000)
        })
        await foraDoVideo(async () => {
          await ir(pc, '/admin/configuracoes')
          await pc.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.innerText.includes('Impressão')).click()); await dormir(700)
        })
        await cena('O cupom é impresso pelo navegador, em bobina de oitenta ou de cinquenta e oito milímetros. Em configurações, impressão, você escolhe a largura, se imprime sozinho ao confirmar o pedido, e se sai também a via da cozinha.', async () => {
          await apontarCampo(pc, 'Largura da bobina', { pausa: 2000 })
          await mostrarTexto(pc, 'Imprimir sozinho', 'main', { pausa: 2500 })
          await mostrarTexto(pc, 'via da cozinha', 'main', { pausa: 2000 })
        })
        await cena('O botão imprimir cupom de teste serve para conferir as margens e o corte. A impressão ainda não foi testada em uma impressora térmica de verdade. O passo a passo da instalação está no manual.', async () => {
          await mostrar(pc, 'Imprimir cupom de teste', 'main button', { pausa: 4500 })
        })
      },
    },

    // ===================================================================================== 17 auditoria
    {
      n: 17, titulo: 'Auditoria',
      async gravar() {
        await abertura(pc, 'Capítulo 17', 'Auditoria', 'Quem alterou o quê, e quando.',
          'Capítulo dezessete: auditoria. Ela registra as alterações importantes: quem fez, quando, o valor anterior e o novo. Ninguém apaga esses registros pelo painel, nem a administradora.', '/admin/auditoria')
        await cena('Cada linha mostra a data, o usuário, a ação, o registro alterado, e a mudança: de quanto, para quanto. As alterações que fizemos neste vídeo já estão aqui.', async () => {
          await mostrar(pc, 'USUÁRIO', 'main th', { pausa: 1200 }); await mostrar(pc, 'DE → PARA', 'main th', { pausa: 2000 })
          await rolar(pc, 260, 2500)
        })
        await cena('São registradas as mudanças de preço, as alterações manuais de estoque, as mudanças de situação e de pagamento dos pedidos, cancelamentos, promoções, cupons, taxas de entrega, despesas, configurações, usuários e permissões. Filtre por período e pelo que foi alterado.', async () => {
          await topo(pc)
          await apontarCampo(pc, 'De', { pausa: 1500 }); await apontarCampo(pc, 'O que foi alterado', { pausa: 2500 })
          await preencher(pc, 'O que foi alterado', 'Pedido'); await dormir(2500)
        })
      },
    },

    // ===================================================================================== 18 configurações
    {
      n: 18, titulo: 'Configurações',
      async gravar() {
        const aba = (nome, espera = 1500) => clicar(pc, nome, 'main [role=tab]', { espera })
        await abertura(pc, 'Capítulo 18', 'Configurações', 'Loja, horários, regras de pedido, metas, usuários, permissões e cópia de segurança.',
          'Capítulo dezoito: configurações. Aqui ficam as regras da operação. Quase tudo que varia na pizzaria muda por esta tela, sem programador.', '/admin/configuracoes')
        await cena('Em loja: nome, telefone, WhatsApp, Instagram, chave Pix, endereço, e um aviso opcional que aparece no topo do site, como: hoje abrimos às sete.', async () => {
          await apontarCampo(pc, 'WhatsApp', { pausa: 1200 }); await apontarCampo(pc, 'Chave Pix', { pausa: 1200 })
          await rolar(pc, 300, 2500); await topo(pc)
        })
        await cena('Em horários, marque os dias em que abre e os horários. Se fecha depois da meia-noite, basta informar. Fora do horário, o site mostra fechado e não aceita pedidos. A situação da loja permite forçar aberta ou fechada em um dia fora do normal. Só lembre de voltar para automático.', async () => {
          await aba('Horários')
          await apontarCampo(pc, 'Situação da loja', { pausa: 3500 })
          await apontarCampo(pc, 'Sexta: abre às', { pausa: 2000 })
        })
        await cena('Em pedidos: se aceita pedidos pelo site, e se aceita automaticamente, que confirma, emite a nota e imprime sem ninguém clicar. Para isso o painel precisa estar aberto no computador da loja.', async () => {
          await aba('Pedidos')
          await mostrarTexto(pc, 'Aceitar pedidos pelo site', 'main', { pausa: 2500 })
          await mostrarTexto(pc, 'Aceitar automaticamente', 'main', { pausa: 3500 })
        })
        await cena('Depois: o pedido mínimo, os tempos de preparo e de entrega, que formam a previsão mostrada ao cliente, e a regra de preço da pizza com mais de um sabor: o sabor mais caro, ou a média.', async () => {
          await apontarCampo(pc, 'Pedido mínimo', { pausa: 1500 }); await apontarCampo(pc, 'Tempo de preparo', { pausa: 1500 }); await apontarCampo(pc, 'Preço da pizza com mais de u', { pausa: 2500 })
        })
        await cena('Mais abaixo, os minutos dos alertas de pedido parado: atenção, atrasado e crítico. E as opções de conta do cliente: oferecer entrada com Google ou com Facebook.', async () => {
          await rolarAte(pc, 'Alertas de pedido parado', 'h2, h3', 100)
          await apontarCampo(pc, 'Atenção', { pausa: 900 }); await apontarCampo(pc, 'Atrasado', { pausa: 900 }); await apontarCampo(pc, 'Crítico', { pausa: 1200 })
          await mostrarTexto(pc, 'Oferecer entrada com Google', 'main', { pausa: 2000 })
        })
        await cena('Em metas e indicadores, você define o que é ruim e o que é bom para o faturamento por dia, os pedidos por dia, o ticket médio, o tempo de preparo e os cancelamentos. Entre os dois valores, fica médio. É isso que colore as bolinhas do painel.', async () => {
          await topo(pc)
          await aba('Metas e indicadores', 4500)
        })
        await cena('Em financeiro, a lista de categorias de despesa, uma por linha.', async () => {
          await aba('Financeiro', 2500)
        })
        await cena('Em usuários, só a administradora cria os acessos da equipe: nome, e-mail, senha inicial e função. As funções são: administrador, financeiro, atendimento, cozinha e motoboy.', async () => {
          await aba('Usuários')
          await clicar(pc, 'Novo usuário', 'main button', { espera: 1200 })
          await preencher(pc, 'Nome', 'João Motoboy'); await preencher(pc, 'E-mail', 'joao@teste.local'); await preencher(pc, 'Função', 'Motoboy')
          await dormir(1800); await fecharJanela(pc)
        })
        await cena('Na lista, você muda a função de alguém, e bloqueia ou libera o acesso. Quando alguém sair da equipe, bloqueie o acesso.', async () => {
          await apontarSel(pc, 'main select', { pausa: 2500 })
          await mostrarTexto(pc, 'Liberado', 'main', { pausa: 2500 })
        })
        await cena('Em permissões, marque as telas que cada função pode usar. A regra vale também no banco de dados: quem não tem a tela marcada não consegue ver nem alterar aquelas informações, mesmo tentando por fora do painel.', async () => {
          await aba('Permissões', 2500)
          await rolar(pc, 280, 3500)
        })
        await foraDoVideo(() => gravar(atend))
        await cena('Por exemplo: quem entra com a função atendimento vê só pedidos, novo pedido, cozinha e clientes.', async () => {
          for (const item of ['Pedidos', 'Novo pedido', 'Cozinha', 'Clientes']) { await mostrar(atend, item, 'aside nav a', { pausa: 700 }) }
          await dormir(1200)
        })
        await foraDoVideo(async () => { await topo(pc); await gravar(pc) })
        await cena('Por fim, em sistema, o botão baixar cópia de segurança gera um arquivo com todos os dados: pedidos, clientes, cardápio, estoque, caixa e configurações. Faça isso pelo menos uma vez por semana, e guarde em lugar seguro, porque o arquivo contém dados de clientes.', async () => {
          await aba('Sistema')
          await mostrar(pc, 'Baixar cópia de segurança', 'main button', { pausa: 5000 })
        })
      },
    },

    // ===================================================================================== encerramento
    {
      n: 19, titulo: 'Rotina do dia',
      async gravar() {
        const passo = async (rotulo, titulo, sub, fala) => { await cartao(pc, rotulo, titulo, sub); await cena(fala, null, { depois: 0.7 }) }
        await passo('Para fechar', 'A rotina de um dia', 'Ao abrir · durante o expediente · ao fechar · toda semana',
          'Para fechar, a rotina de um dia de trabalho com o sistema.')
        await passo('Rotina do dia', 'Ao abrir', 'Painel aberto com o som ligado · abrir o caixa com o troco inicial · desligar no cardápio o que não tem hoje · conferir o aviso de estoque baixo',
          'Ao abrir: deixe o painel aberto no computador da loja, com o som ligado. Abra o caixa com o troco inicial. Desligue no cardápio o que não tem hoje. E confira no painel se há aviso de estoque baixo.')
        await passo('Rotina do dia', 'Durante o expediente', 'Aceitar os pedidos novos · cozinha: iniciar preparo e pronto · escolher o motoboy · na retirada: entregue e recebido · atenção aos alertas vermelhos',
          'Durante o expediente: aceite os pedidos novos. A cozinha toca em iniciar preparo, e depois em pronto. Nas entregas, escolha o motoboy responsável. Nas retiradas, clique em entregue e recebido quando o cliente buscar. E fique de olho nos alertas: pedido vermelho pede atenção imediata.')
        await passo('Rotina do dia', 'Ao fechar', 'Nenhum pedido sobrando no quadro · fechar o caixa com o dinheiro contado · lançar as despesas do dia',
          'Ao fechar: confira se não sobrou pedido no quadro. Feche o caixa com o dinheiro contado. E lance as despesas do dia no financeiro.')
        await passo('Rotina do dia', 'Toda semana', 'Registrar as compras no estoque · acerto dos motoboys · baixar a cópia de segurança',
          'Toda semana: registre as compras no estoque, com o custo. Faça o acerto dos motoboys. E baixe a cópia de segurança.')
        await passo('Tia Cê Pizzas', 'Bom trabalho e boas vendas!', 'O manual em PDF traz os detalhes de cada tela e as respostas para as dúvidas mais comuns.',
          'O manual em PDF traz os detalhes de cada tela e as respostas para as dúvidas mais comuns. Bom trabalho, e boas vendas!')
        await dormir(1200)
      },
    },
  ]
}
