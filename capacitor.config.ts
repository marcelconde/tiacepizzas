import type { CapacitorConfig } from '@capacitor/cli'

// Aplicativo do entregador (Android): a mesma tela de /entregador dentro de um aplicativo de verdade,
// para o GPS continuar funcionando com o Waze aberto ou a tela apagada — coisa que um site não consegue.
const config: CapacitorConfig = {
  appId: 'br.com.tiacepizzas.entregas',
  appName: 'Tia Cê Entregas',
  webDir: 'dist',
  android: { backgroundColor: '#261912' },
  plugins: {
    // Em segundo plano o Android segura as chamadas de rede feitas pela página; por aqui elas saem pelo
    // lado nativo do aplicativo e a posição chega ao servidor na hora.
    CapacitorHttp: { enabled: true },
  },
}

export default config
