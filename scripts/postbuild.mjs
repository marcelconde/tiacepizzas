// O GitHub Pages só serve arquivos estáticos. Para que /cardapio, /pedido, /admin/pedidos etc.
// abram direto (e ao recarregar a página), copiamos o index.html para cada rota do site.
// O 404.html cobre qualquer outro endereço.
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const rotas = [
  'cardapio', 'checkout', 'pedido', 'entrar', 'conta', 'entregador', 'admin',
  ...['painel', 'pedidos', 'pdv', 'cozinha', 'clientes', 'cardapio', 'estoque', 'caixa', 'entregas', 'financeiro', 'fiscal', 'configuracoes', 'analises', 'conteudo', 'auditoria'].map((r) => `admin/${r}`),
]

for (const rota of rotas) {
  mkdirSync(join(dist, rota), { recursive: true })
  copyFileSync(join(dist, 'index.html'), join(dist, rota, 'index.html'))
}
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
console.log(`postbuild: ${rotas.length} rotas + 404.html`)
