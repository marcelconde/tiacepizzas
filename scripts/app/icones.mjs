// Gera os ícones do aplicativo Android do entregador a partir de public/icone-512.png.
// Uso: node scripts/app/icones.mjs   (só é preciso rodar de novo se o ícone mudar)
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const res = join(raiz, 'android/app/src/main/res')
const pizza = 'data:image/png;base64,' + readFileSync(join(raiz, 'public/icone-512.png')).toString('base64')
const FUNDO = '#261912'
const densidades = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

const navegador = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const pagina = await navegador.newPage()
async function desenhar(arquivo, lado, { proporcao, fundo = 'transparent', redondo = false }) {
  await pagina.setViewport({ width: lado, height: lado, deviceScaleFactor: 1 })
  await pagina.setContent(`<body style="margin:0;background:transparent"><div style="width:${lado}px;height:${lado}px;display:grid;place-items:center;background:${fundo};${redondo ? 'border-radius:50%;' : ''}"><img src="${pizza}" style="width:${proporcao * 100}%;height:${proporcao * 100}%"></div></body>`)
  await pagina.screenshot({ path: arquivo, omitBackground: true })
}
for (const [nome, escala] of Object.entries(densidades)) {
  const pasta = join(res, `mipmap-${nome}`)
  // ícone adaptável (Android 8+): a pizza no centro, com folga para os recortes de cada fabricante
  await desenhar(join(pasta, 'ic_launcher_foreground.png'), 108 * escala, { proporcao: 0.56 })
  // ícones antigos
  await desenhar(join(pasta, 'ic_launcher.png'), 48 * escala, { proporcao: 0.8, fundo: FUNDO, redondo: true })
  await desenhar(join(pasta, 'ic_launcher_round.png'), 48 * escala, { proporcao: 0.8, fundo: FUNDO, redondo: true })
}
await navegador.close()
console.log('ícones gerados em android/app/src/main/res/mipmap-*')
