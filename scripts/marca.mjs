// Aplica a logo da pizzaria no site: recorta o círculo (o fundo de fora fica transparente) e gera, a partir dele,
// a logo do cabeçalho, o ícone da aba, os ícones de "adicionar à tela inicial" e a imagem de compartilhamento.
// Uso: node scripts/marca.mjs caminho/da/logo.png     (sem o caminho, refaz tudo a partir de public/logo.png)
// Depois, para o aplicativo Android: node scripts/app/icones.mjs e npm run app:android.
import puppeteer from 'puppeteer-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME } from './plataforma.mjs'

const publico = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const origem = process.argv[2] ?? join(publico, 'logo.png')
const dados = (arquivo) => 'data:image/png;base64,' + readFileSync(arquivo).toString('base64')

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true })
const pagina = await navegador.newPage()

// 1. o círculo da logo, sem o fundo branco em volta
const recortada = await pagina.evaluate(async (src) => {
  const img = new Image()
  img.src = src
  await img.decode()
  const tela = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
  const ctx = tela.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, img.width, img.height)
  // limites do desenho: o primeiro e o último ponto que não são (quase) brancos nem transparentes
  let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (data[i + 3] > 40 && (data[i] < 225 || data[i + 1] < 225 || data[i + 2] < 225)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  const lado = Math.max(x1 - x0, y1 - y0) + 1
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2
  const saida = Object.assign(document.createElement('canvas'), { width: lado, height: lado })
  const s = saida.getContext('2d')
  s.beginPath()
  s.arc(lado / 2, lado / 2, lado / 2 - 0.5, 0, Math.PI * 2)
  s.clip()
  s.drawImage(img, lado / 2 - cx, lado / 2 - cy)
  return saida.toDataURL('image/png')
}, dados(origem))
writeFileSync(join(publico, 'logo.png'), Buffer.from(recortada.split(',')[1], 'base64'))

// 2. os outros tamanhos
async function desenhar(arquivo, largura, altura, html) {
  await pagina.setViewport({ width: largura, height: altura, deviceScaleFactor: 1 })
  await pagina.setContent(`<body style="margin:0;background:transparent">${html}</body>`)
  await pagina.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]))
  await pagina.screenshot({ path: join(publico, arquivo), omitBackground: true })
}
const logo = (lado) => `<img src="${recortada}" style="display:block;width:${lado}px;height:${lado}px">`
await desenhar('favicon.png', 64, 64, logo(64))
await desenhar('icone-192.png', 192, 192, logo(192))
await desenhar('icone-512.png', 512, 512, logo(512))
// imagem que aparece quando o endereço do site é enviado pelo WhatsApp e pelas redes sociais
await desenhar('og.png', 1200, 630, `
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&display=swap" rel="stylesheet">
  <div style="width:1200px;height:630px;background:#261912;display:flex;align-items:center;justify-content:space-between;padding:0 90px 0 80px;box-sizing:border-box">
    <div>
      <div style="font:700 112px/1 Fraunces,Georgia,serif;color:#fdfaf5">Tia Cê</div>
      <div style="font:700 84px/1.25 Fraunces,Georgia,serif;color:#f0b93f">Pizzas</div>
      <div style="font:400 34px/1.6 'Helvetica Neue',Arial,sans-serif;color:#ecd9b4;margin-top:22px">Peça online e acompanhe seu pedido</div>
    </div>
    ${logo(440)}
  </div>`)
await navegador.close()
console.log('logo aplicada: public/logo.png, favicon.png, icone-192.png, icone-512.png e og.png')
