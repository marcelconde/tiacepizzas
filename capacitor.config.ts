import type { CapacitorConfig } from '@capacitor/cli'
import { existsSync } from 'node:fs'

// O aplicativo abre a tela do motoboy direto do site publicado: cada publicação chega ao celular sem
// reinstalar (só mudança nativa — ícone, permissões, plugins — pede um APK novo). "avisos=1" diz à tela que
// este APK tem o Firebase ("avisos=0", que não tem); sem ele, ligar os avisos derrubaria o aplicativo.
// Sem internet, abre sem-conexao.html.
const avisos = existsSync('android/app/google-services.json')

// Aplicativo do entregador (Android): a mesma tela de /entregador dentro de um aplicativo de verdade,
// para o GPS continuar funcionando com o Waze aberto ou a tela apagada — coisa que um site não consegue.
const config: CapacitorConfig = {
  appId: 'br.com.tiacepizzas.entregas',
  appName: 'Tia Cê Entregas',
  webDir: 'dist',
  server: {
    url: `https://tiacepizzas.com.br/entregador?avisos=${avisos ? 1 : 0}`,
    errorPath: 'sem-conexao.html',
  },
  android: {
    backgroundColor: '#261912',
    // Exigência do plugin de GPS: sem a ponte antiga, o Android para de entregar as posições à página
    // depois de uns 5 minutos em segundo plano.
    useLegacyBridge: true,
  },
  plugins: {
    // Em segundo plano o Android segura as chamadas de rede feitas pela página; por aqui elas saem pelo
    // lado nativo do aplicativo e a posição chega ao servidor na hora.
    CapacitorHttp: { enabled: true },
    // O aviso "pedido pronto" também aparece e toca com o aplicativo aberto na tela.
    PushNotifications: { presentationOptions: ['alert', 'sound'] },
  },
}

export default config
