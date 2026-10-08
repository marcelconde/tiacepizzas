# Aplicativo Android do entregador — Tia Cê Entregas

É a mesma tela de `tiacepizzas.com.br/entregador`, dentro de um aplicativo de verdade. A diferença é o GPS:
um site só consegue enviar a posição com a tela aberta; o aplicativo continua enviando com o **Waze aberto ou a
tela apagada**, mostrando um aviso fixo nas notificações — como nos aplicativos de corrida.

> **Ainda não foi testado em um celular.** Faça o teste da seção "Testar" antes de contar com ele.

## 1. Gerar o aplicativo (no Windows, no Mac ou no Linux)

Instale uma vez:

1. **Git** — https://git-scm.com
2. **Node.js** (versão LTS) — https://nodejs.org
3. **Android Studio** — https://developer.android.com/studio
   Abra-o uma vez e conclua o assistente inicial: é ele que baixa o Android SDK e pede o aceite das licenças.

Depois, no terminal (PowerShell no Windows):

```bash
git clone https://github.com/marcelconde/tiacepizzas.git
cd tiacepizzas
npm install
npm run app:android
```

A primeira vez demora alguns minutos (o Gradle baixa as dependências). No fim aparece
`docs/tia-ce-entregas.apk`.

- Se reclamar que falta uma versão do Android ("platform android-36"): Android Studio → *More Actions* →
  *SDK Manager* → marque a versão pedida → *Apply*, e rode de novo.
- Se o Android Studio estiver instalado fora do lugar padrão, informe `JAVA_HOME` e `ANDROID_HOME`.

### Guarde a chave de assinatura

Na primeira vez o comando cria dois arquivos que **não vão para o GitHub**:

- `android/tia-ce-entregas.keystore`
- `android/keystore.properties`

Guarde uma cópia dos dois (pen drive, nuvem pessoal). Uma versão nova só instala por cima da antiga se for
assinada com a mesma chave; sem eles, o entregador teria de desinstalar e instalar de novo.

## 2. Instalar no celular do entregador

1. Envie o `tia-ce-entregas.apk` para o celular (WhatsApp, Google Drive ou cabo) e toque no arquivo.
2. O Android avisa que é um aplicativo de fora da loja: toque em **Configurações** → **Permitir desta fonte** → **Instalar**.
3. Abra o **Tia Cê Entregas** e entre com o e-mail e a senha do entregador (os mesmos do site).
4. Na primeira entrega ele pede duas permissões — aceite as duas:
   - **Localização**: "Durante o uso do app" e **localização precisa**.
   - **Notificações**: é o aviso fixo que mantém o envio funcionando.
5. Em Xiaomi, Samsung e Motorola, vale tirar a economia de bateria deste aplicativo
   (Configurações → Apps → Tia Cê Entregas → Bateria → **Sem restrições**): alguns aparelhos encerram
   aplicativos em segundo plano por conta própria.

## 3. Testar (antes de confiar)

1. No painel, crie um pedido de **entrega**, escolha o entregador em *Motoboy responsável* e leve até **Pronto**.
2. No aplicativo, toque em **Saí para entregar**. Deve aparecer nas notificações:
   *Tia Cê Entregas — Enviando sua localização ao cliente durante a entrega.*
3. Toque em **Waze** e ande alguns minutos, inclusive com a tela apagada.
4. Em outro aparelho, abra o link de acompanhamento do pedido: o mapa deve mostrar a moto andando.
   (Ou, no painel, *Entregas → Entregadores*: a coluna **Última posição** deve mudar a cada 15 a 30 segundos.)
5. Volte ao aplicativo e toque em **Entreguei e recebi**: o aviso das notificações some e o envio para.

Se a posição parar de chegar depois de alguns minutos, o motivo quase sempre é a economia de bateria (passo 5 da
instalação).

## 4. Nova versão

Quando a tela do entregador mudar:

1. Em `android/app/build.gradle`, some 1 em `versionCode` e ajuste `versionName`.
2. `git pull`, `npm install`, `npm run app:android`.
3. Envie o novo APK; ele instala por cima do antigo.

## Limites

- **iPhone**: não há aplicativo. No iPhone o entregador usa o site, e o envio pausa enquanto o Waze estiver aberto.
  Um aplicativo para iPhone exige um Mac com Xcode e conta de desenvolvedor da Apple (US$ 99 por ano).
- **Play Store**: por enquanto a instalação é pelo arquivo. Publicar na loja exige conta de desenvolvedor do Google
  (US$ 25, uma vez) e uma revisão do uso de localização.
- O site vai embutido no aplicativo: ele funciona mesmo se o domínio estiver fora do ar, mas mudanças na tela só
  chegam com uma versão nova.

## Como funciona (para quem for mexer)

- `capacitor.config.ts` e a pasta `android/`: o projeto Android (Capacitor).
- `src/lib/rastreio.ts`: dentro do aplicativo usa `@capacitor-community/background-geolocation` (serviço em primeiro
  plano); no navegador usa o GPS da página.
- `CapacitorHttp` fica ligado porque, em segundo plano, o Android segura as chamadas de rede feitas pela página.
- `scripts/app/android.mjs`: empacota o site, sincroniza e chama o Gradle. `scripts/app/icones.mjs` refaz os ícones.
