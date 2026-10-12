// O que muda entre Windows, macOS e Linux nos roteiros que sobem o ambiente local e dirigem o Chrome.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const noWindows = ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].map((v) => process.env[v] && join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe'))

/** Google Chrome instalado no computador (CHROME=/caminho/do/chrome para outro local). */
export const CHROME =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ...noWindows, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((c) => c && existsSync(c))
if (!CHROME) throw new Error('Não encontrei o Google Chrome neste computador. Instale-o ou informe o caminho na variável CHROME.')

/** Encerra um processo e os que ele abriu. No Windows, kill() deixaria o Vite rodando e a porta ocupada. */
export function encerrarProcesso(processo) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(processo.pid), '/T', '/F'], { stdio: 'ignore' })
  else processo.kill('SIGTERM')
}
