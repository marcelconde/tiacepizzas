// Transforma docs/manual/manual.html (com as capturas de docs/manual/capturas/) no PDF do manual.
import puppeteer from 'puppeteer-core'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const origem = join(raiz, 'docs', 'manual', 'manual.html')
const saida = join(raiz, 'docs', 'manual-tia-ce-pizzas.pdf')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] })
const pagina = await navegador.newPage()
await pagina.goto(pathToFileURL(origem).href, { waitUntil: 'networkidle0', timeout: 120000 })
await pagina.evaluate(() => document.fonts.ready)

// uma captura citada no manual que não existe é erro: melhor falhar do que gerar um manual com buracos
const faltando = await pagina.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')))
if (faltando.length) {
  console.error('Capturas que o manual usa e não foram encontradas:\n  ' + faltando.join('\n  '))
  process.exit(1)
}
const usadas = new Set(await pagina.evaluate(() => [...document.images].map((i) => i.getAttribute('src').split('/').pop())))
const pasta = join(raiz, 'docs', 'manual', 'capturas')
const sobrando = existsSync(pasta) ? readdirSync(pasta).filter((f) => f.endsWith('.jpg') && !usadas.has(f)) : []
if (sobrando.length) console.log('Capturas tiradas e não usadas no manual: ' + sobrando.join(', '))

await pagina.pdf({
  path: saida,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font:7.5pt Helvetica,Arial,sans-serif;color:#8a8580;padding:0 14mm;display:flex;justify-content:space-between"><span>Tia Cê Pizzas · Manual de uso</span><span>página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
  outline: true,
  tagged: true,
  timeout: 180000,
})
await navegador.close()
console.log(`Manual gerado: docs/manual-tia-ce-pizzas.pdf (${(statSync(saida).size / 1048576).toFixed(1)} MB)`)
