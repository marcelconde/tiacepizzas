// Gera o aplicativo Android do entregador: docs/tia-ce-entregas.apk      (npm run app:android)
// Funciona no Windows, no macOS e no Linux. Precisa do Android Studio instalado (ele traz o Android SDK) e do
// Java 21 (JDK), ou das variáveis JAVA_HOME e ANDROID_HOME apontando para um JDK 21 e um Android SDK.
// O passo a passo está em docs/aplicativo-android.md.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const android = join(raiz, 'android')
const win = process.platform === 'win32'
const primeiro = (...caminhos) => caminhos.find((c) => c && existsSync(c))

// O Gradle deste projeto (8.14) só roda com o Java 21 ao 24. O Android Studio mais novo traz o Java 25, que
// ele recusa ("Unsupported class file major version 69"): por isso procura também um JDK instalado à parte.
const versaoJava = (pasta) => {
  try {
    return Number(/JAVA_VERSION="(\d+)/.exec(readFileSync(join(pasta, 'release'), 'utf8'))?.[1])
  } catch {
    return 0
  }
}
const dentro = (pasta, sufixo = '') => (pasta && existsSync(pasta) ? readdirSync(pasta).sort().reverse().map((n) => join(pasta, n, sufixo)) : [])
const programas = win && process.env.PROGRAMFILES
const javas = [
  process.env.JAVA_HOME,
  ...['Eclipse Adoptium', 'Microsoft', 'Java'].flatMap((f) => dentro(programas && join(programas, f))),
  ...dentro(join(homedir(), '.jdks')),
  ...dentro('/Library/Java/JavaVirtualMachines', join('Contents', 'Home')),
  ...dentro('/usr/lib/jvm'),
  programas && join(programas, 'Android', 'Android Studio', 'jbr'),
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/android-studio/jbr',
].filter((c) => c && versaoJava(c))
const JAVA = javas.find((c) => versaoJava(c) >= 21 && versaoJava(c) <= 24)
const SDK = primeiro(
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  win && join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
  join(homedir(), 'Library', 'Android', 'sdk'),
  join(homedir(), 'Android', 'Sdk'),
)
const faltas = []
if (!JAVA) {
  faltas.push(
    'Falta o Java 21 (JDK).' +
      (javas.length ? ` Achei só ${javas.map((c) => `o Java ${versaoJava(c)} (${c})`).join(' e ')}; este projeto aceita do 21 ao 24.` : '') +
      '\n  Windows: winget install --id EclipseAdoptium.Temurin.21.JDK -e' +
      '\n  macOS:   brew install --cask temurin@21' +
      '\n  ou baixe em https://adoptium.net/temurin/releases/?version=21' +
      '\n  Se ele já estiver instalado em outro lugar, informe a variável JAVA_HOME.',
  )
}
if (!SDK) {
  faltas.push(
    'Falta o Android SDK.' +
      '\n  Instale o Android Studio (https://developer.android.com/studio), abra-o uma vez e conclua o assistente inicial:' +
      '\n  é ele que baixa o SDK e pede o aceite das licenças. Se o SDK estiver em outro lugar, informe a variável ANDROID_HOME.',
  )
}
if (faltas.length) {
  console.error(`Ainda não dá para gerar o aplicativo neste computador.\n\n${faltas.join('\n\n')}\n\nDepois rode de novo: npm run app:android`)
  process.exit(1)
}
const ambiente = { ...process.env, JAVA_HOME: JAVA, ANDROID_HOME: SDK }
function rodar(comando, args, pasta = raiz, descricao = `${comando} ${args.join(' ')}`) {
  console.log(`\n› ${descricao}`)
  // No Windows, npm, npx e gradlew são arquivos .cmd/.bat e só rodam pelo interpretador de comandos.
  // Um .exe é chamado direto, para o caminho e os argumentos com espaço chegarem inteiros.
  const opcoes = { cwd: pasta, stdio: 'inherit', env: ambiente }
  const r = win && !comando.endsWith('.exe') ? spawnSync(`${comando} ${args.join(' ')}`, { ...opcoes, shell: true }) : spawnSync(comando, args, opcoes)
  if (r.status !== 0) {
    console.error(`\nParou em "${descricao}".`)
    process.exit(r.status ?? 1)
  }
}

// 1. o site que vai embutido no aplicativo (usa o banco de .env.production, o mesmo do site publicado)
rodar('npm', ['run', 'build'])
rodar('npx', ['cap', 'sync', 'android'])

// 2. onde está o Android SDK
writeFileSync(join(android, 'local.properties'), `sdk.dir=${SDK.replaceAll('\\', '\\\\')}\n`)

// 3. chave de assinatura: criada uma vez. Uma versão nova só instala por cima da antiga se for assinada
//    com a MESMA chave — por isso os dois arquivos precisam ser guardados.
const propriedades = join(android, 'keystore.properties')
if (!existsSync(propriedades)) {
  const senha = randomBytes(18).toString('base64url')
  rodar(join(JAVA, 'bin', win ? 'keytool.exe' : 'keytool'), [
    '-genkeypair', '-keystore', 'tia-ce-entregas.keystore', '-alias', 'entregas', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-storepass', senha, '-keypass', senha, '-dname', 'CN=Tia Ce Pizzas, C=BR',
  ], android, 'keytool -genkeypair (chave de assinatura)') // sem mostrar a senha na tela
  writeFileSync(propriedades, `storeFile=tia-ce-entregas.keystore\nstorePassword=${senha}\nkeyAlias=entregas\nkeyPassword=${senha}\n`)
  console.log('\n⚠ Criei a chave de assinatura do aplicativo. GUARDE UMA CÓPIA destes dois arquivos em lugar seguro (eles não vão para o GitHub):')
  console.log('   android/tia-ce-entregas.keystore\n   android/keystore.properties')
}

// 4. o aplicativo
rodar(win ? '.\\gradlew.bat' : './gradlew', ['assembleRelease'], android)
const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
copyFileSync(apk, join(raiz, 'docs', 'tia-ce-entregas.apk'))
console.log('\n✓ Aplicativo gerado: docs/tia-ce-entregas.apk')
console.log('  Envie o arquivo para o celular do entregador (WhatsApp, cabo ou Google Drive) e instale. Veja docs/aplicativo-android.md.')
