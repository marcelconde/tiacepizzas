// Gera o manual de uso em PDF, do zero:
//   1. sobe o ambiente de demonstração (portas próprias, sem atrapalhar um "npm run dev:local" aberto);
//   2. percorre o sistema tirando as capturas de tela;
//   3. monta o PDF a partir de docs/manual/manual.html.
// Uso: npm run manual        (npm run manual -- --so-pdf  refaz só o PDF com as capturas que já existem)
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = 54341
const SITE = 5193
const rodar = (arquivo, env = {}) =>
  new Promise((ok, falha) => spawn(process.execPath, [join(raiz, arquivo)], { cwd: raiz, stdio: 'inherit', env: { ...process.env, ...env } }).on('exit', (c) => (c ? falha(new Error(`${arquivo} terminou com erro`)) : ok())))

if (!process.argv.includes('--so-pdf')) {
  // As capturas ficam com cara de expediente: escolhe um fuso em que agora são cerca de 20h.
  const h = (new Date().getUTCHours() - 20 + 24) % 24
  const FUSO = h === 0 ? 'Etc/GMT' : h <= 12 ? `Etc/GMT+${h}` : `Etc/GMT-${24 - h}`
  const servidor = spawn(process.execPath, [join(raiz, 'scripts/dev-local.mjs')], {
    cwd: raiz, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, DEMO: '1', FUSO, TZ: FUSO, PORTA_API: String(API), PORTA_SITE: String(SITE) },
  })
  const encerrar = () => servidor.kill('SIGTERM')
  process.on('exit', encerrar)
  try {
    for (let i = 0; ; i++) {
      if (i > 90) throw new Error('o ambiente de demonstração não respondeu')
      await new Promise((r) => setTimeout(r, 1000))
      if (await fetch(`http://localhost:${SITE}/`).then((r) => r.ok, () => false)) break
    }
    await rodar('scripts/manual/capturar.mjs', { BASE: `http://localhost:${SITE}`, API: `http://localhost:${API}`, FUSO })
  } finally {
    encerrar()
  }
}
await rodar('scripts/manual/pdf.mjs')
