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
4. **Java 21 (JDK)** — o Android Studio mais novo traz o Java 25, que o Gradle deste projeto (8.14) recusa.
   No Windows: `winget install --id EclipseAdoptium.Temurin.21.JDK -e`. No Mac: `brew install --cask temurin@21`.
   Ou baixe em https://adoptium.net/temurin/releases/?version=21. O comando abaixo acha o Java 21 sozinho.

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
- Se o Java 21 ou o Android SDK estiverem fora do lugar padrão, informe `JAVA_HOME` e `ANDROID_HOME`.
- **No Windows**, prefira uma pasta curta, sem acento e que não seja sincronizada com a nuvem: a compilação cria
  milhares de arquivos com caminhos longos, que o Windows limita a 260 letras.

### Guarde a chave de assinatura

Na primeira vez o comando cria dois arquivos que **não vão para o GitHub**:

- `android/tia-ce-entregas.keystore`
- `android/keystore.properties`

Guarde uma cópia dos dois (pen drive, nuvem pessoal). Uma versão nova só instala por cima da antiga se for
assinada com a mesma chave; sem eles, o entregador teria de desinstalar e instalar de novo.

## 2. Instalar no celular do entregador

1. Envie o `tia-ce-entregas.apk` para o celular (WhatsApp, Google Drive ou cabo) e toque no arquivo.
2. O Android avisa que é um aplicativo de fora da loja: toque em **Configurações** → **Permitir desta fonte** → **Instalar**.
3. Abra o **Tia Cê Entregas**. Ele pede para enviar **notificações**: toque em **Permitir** — é o aviso fixo que
   aparece enquanto a localização é enviada. Depois entre com o e-mail e a senha do entregador (os mesmos do site).
4. Na primeira entrega ele pede a **localização**: escolha "Durante o uso do app" e **localização precisa**.
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

## 5. Avisos de pedido pronto

Quando o painel marca um pedido de entrega como **Pronto** (ou escolhe o motoboy de um pedido que já está pronto), o
celular do motoboy toca e mostra **"Pedido #123 está pronto — Pode retirar na pizzaria."**, com o aplicativo aberto,
em segundo plano ou fechado. O aviso viaja pelo Firebase, o serviço gratuito do Google para notificações no Android.

> **Escrito e testado só no ambiente local** (o painel chama o servidor e o servidor acha o aparelho do motoboy).
> O envio de verdade pelo Firebase e a chegada no celular ainda não foram testados.

Para ligar (uma vez):

1. **Projeto no Firebase** — em https://console.firebase.google.com, *Adicionar projeto* (pode desligar o Google
   Analytics). Dentro dele, *Adicionar app* → **Android**, com o nome do pacote `br.com.tiacepizzas.entregas`.
   Baixe o **`google-services.json`** e coloque em `android/app/`. Ele não vai para o GitHub; se perder, baixa de novo.
2. **Chave do servidor** — no mesmo projeto: engrenagem → *Configurações do projeto* → *Contas de serviço* →
   **Gerar nova chave privada**. Vem um arquivo `.json`: é uma **senha**. No Supabase, em *Edge Functions* → *Secrets*,
   crie o segredo **`FIREBASE_CONTA`** e cole o conteúdo inteiro do arquivo. Depois apague o arquivo do computador.
   Nunca o coloque na pasta do projeto.
3. **Banco e servidor** — `npx supabase db push` (cria o cadastro dos aparelhos) e
   `npx supabase functions deploy avisar-entregador --use-api`.
4. **Aplicativo** — `npm run app:android` e instale o APK novo. Sem o `google-services.json` o comando avisa que o
   aplicativo vai sair sem os avisos.

No celular: ao entrar no aplicativo, o motoboy aceita as **notificações**. Para testar, deixe um pedido de entrega
com ele escolhido como motoboy e marque **Pronto** no painel.

- O aviso só sai para quem **entrou** no aplicativo naquele celular; ao **sair** da conta, o celular para de receber.
- Quem usa pelo navegador (iPhone) não recebe aviso.
- Aparelhos com economia de bateria agressiva podem atrasar o aviso com o aplicativo fechado (passo 5 de "Instalar").

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
- `android.useLegacyBridge: true` (em `capacitor.config.ts`) é exigência do plugin de GPS: sem isso as posições
  param de chegar à página depois de uns 5 minutos em segundo plano.
- `scripts/app/android.mjs`: empacota o site, sincroniza e chama o Gradle. `scripts/app/icones.mjs` refaz os ícones.
- Aviso de pedido pronto: `src/lib/avisos.ts` (o aplicativo registra o aparelho com `@capacitor/push-notifications`) →
  função do banco `entrega_aparelho` e tabela `entregador_aparelhos` (fechada para o site) → `src/lib/pedidos.ts`
  chama a função de servidor `avisar-entregador` quando o pedido fica pronto → ela confere o pedido e envia pelo
  Firebase. O painel nunca trava nem mostra erro por causa do aviso.

## O que já foi comprovado

Em 2026-10-12, num Windows 11 com Node 24, Android Studio 2026.2 e Java 21 (Temurin):

- **`npm run app:android` gera o APK no Windows** (primeira compilação do projeto, cerca de 2 minutos): 4,2 MB,
  assinado com a chave do projeto (`CN=Tia Ce Pizzas, C=BR`), para o Android 16 (`targetSdk 36`), com as
  permissões de localização, serviço em primeiro plano e notificações. Funcionou com o projeto numa pasta com
  espaços no caminho.
- O Gradle do projeto (8.14.3) **não roda com o Java 25** que vem no Android Studio atual: para logo no começo
  com "Unsupported class file major version 69". Por isso o Java 21 entrou na lista do que instalar, e
  `scripts/app/android.mjs` procura um JDK do 21 ao 24 e avisa com clareza quando não acha.
- O assistente do Android Studio baixou a versão 37 do Android; a 36, que o projeto pede, o Gradle baixou sozinho
  na primeira compilação (as licenças já estavam aceitas).
- `npm run build`, `npm run test:db`, `npm run test:e2e` e `npm run manual` passam no Windows.

Ainda **não** comprovado: tudo o que depende do celular. O que conferir nele:

- **Notificações:** o plugin de GPS declara a permissão, mas não a pede (conferido no código dele). O aplicativo
  passou a pedi-la ao abrir (`MainActivity.java`). Falta ver no celular se o pedido aparece e se o aviso fixo
  aparece durante a entrega.
- **`useLegacyBridge`:** aplicado; o efeito só se vê no teste de 15 minutos com a tela apagada.
- Tela de ponta a ponta do Android 16, botão voltar, teclado sobre o login, links para Waze, Google Maps,
  WhatsApp e telefone, e renovação da sessão com o aplicativo em segundo plano.

O emulador do Android Studio não serve para esses testes neste Windows sem ligar a virtualização (ele avisa que o
"hypervisor driver" não está instalado), e de qualquer forma GPS em segundo plano se comprova é no aparelho.
