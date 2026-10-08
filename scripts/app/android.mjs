// Gera o aplicativo Android do entregador: docs/tia-ce-entregas.apk      (npm run app:android)
// Funciona no Windows, no macOS e no Linux. Precisa do Android Studio instalado (ele traz o JDK e o Android SDK),
// ou das variáveis JAVA_HOME e ANDROID_HOME apontando para um JDK 21 e um Android SDK.
// O passo a passo está em docs/aplicativo-android.md.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const android = join(raiz, 'android')
const win = process.platform === 'win32'
const primeiro = (...caminhos) => caminhos.find((c) => c && existsSync(c))

const JAVA = primeiro(
  process.env.JAVA_HOME,
  win && 'C:\\Program Files\\Android\\Android Studio\\jbr',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/android-studio/jbr',
)
const SDK = primeiro(
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  win && join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
  join(homedir(), 'Library', 'Android', 'sdk'),
  join(homedir(), 'Android', 'Sdk'),
)
if (!JAVA || !SDK) {
  console.error(
    `Não encontrei ${[!JAVA && 'o Java (JDK)', !SDK && 'o Android SDK'].filter(Boolean).join(' nem ')} neste computador.\n` +
      'Instale o Android Studio (https://developer.android.com/studio), abra-o uma vez para ele baixar o SDK e rode de novo.\n' +
      'Se estiverem em outro lugar, informe as variáveis JAVA_HOME e ANDROID_HOME.',
  )
  process.exit(1)
}
const ambiente = { ...process.env, JAVA_HOME: JAVA, ANDROID_HOME: SDK }
function rodar(comando, args, pasta = raiz) {
  console.log(`\n› ${comando} ${args.join(' ')}`)
  const r = spawnSync(comando, args, { cwd: pasta, stdio: 'inherit', env: ambiente, shell: win })
  if (r.status !== 0) {
    console.error(`\nParou em "${comando} ${args.join(' ')}".`)
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
  ], android)
  writeFileSync(propriedades, `storeFile=tia-ce-entregas.keystore\nstorePassword=${senha}\nkeyAlias=entregas\nkeyPassword=${senha}\n`)
  console.log('\n⚠ Criei a chave de assinatura do aplicativo. GUARDE UMA CÓPIA destes dois arquivos em lugar seguro (eles não vão para o GitHub):')
  console.log('   android/tia-ce-entregas.keystore\n   android/keystore.properties')
}

// 4. o aplicativo
rodar(win ? 'gradlew.bat' : './gradlew', ['assembleRelease'], android)
const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
copyFileSync(apk, join(raiz, 'docs', 'tia-ce-entregas.apk'))
console.log('\n✓ Aplicativo gerado: docs/tia-ce-entregas.apk')
console.log('  Envie o arquivo para o celular do entregador (WhatsApp, cabo ou Google Drive) e instale. Veja docs/aplicativo-android.md.')
