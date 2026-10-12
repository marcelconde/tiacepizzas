# Tia Cê Pizzas

Site de pedidos e sistema de gestão da pizzaria, em [tiacepizzas.com.br](https://tiacepizzas.com.br).

- **Site público** — página inicial editável (seções prontas ou montada em blocos arrastáveis: textos, imagens clicáveis, botões), cardápio, montagem de pizza (tamanho, vários sabores, borda, adicionais), promoções, sacola, finalização (entrega por bairro ou por distância) e acompanhamento do pedido com mapa. O cliente pode pedir sem cadastro, criar uma conta com e-mail e senha ou entrar com Google/Facebook para guardar endereços e ver seus pedidos. Quem escolhe Pix recebe a chave na tela de acompanhamento, com o botão de enviar o comprovante pelo WhatsApp.
- **Painel da equipe** (`/admin`) — pedidos em tempo real com alertas de atraso e de entrega pronta sem motoboy, rastreio do motoboy no mapa, venda de balcão/telefone, clientes, cardápio com ficha técnica, site e promoções, estoque, caixa, entregas, pagamentos a motoboys e funcionários, financeiro, indicadores com metas, análises de produtos e clientes, nota fiscal (NFC-e), auditoria e configurações (usuários e permissões por função).
- **Aplicativo do entregador** (`/entregador`) — entregas do motoboy, atalho para o Waze e o Google Maps, WhatsApp do cliente, registro de entrega ou problema e envio da localização. No navegador o envio pausa enquanto o Waze estiver aberto; o **aplicativo Android** (`npm run app:android`, passo a passo em [docs/aplicativo-android.md](docs/aplicativo-android.md)) continua enviando em segundo plano.

O **manual de uso**, com capturas de todas as telas, é gerado por `npm run manual` em `docs/manual-tia-ce-pizzas.pdf`.
O **vídeo-tutorial** narrado, que percorre todas as telas, é gerado por `npm run video` em `docs/video-tia-ce-pizzas.mp4`.

## Como é montado

| Parte | Onde roda | Pasta |
| --- | --- | --- |
| Site, painel e app do entregador (React + Vite + Tailwind) | GitHub Pages | `src/` |
| Banco, login, tempo real e fotos | Supabase (Postgres) | `supabase/migrations/` |
| Nota fiscal e criação de usuários | Supabase Edge Functions | `supabase/functions/` |
| Mapas e localização de endereços | OpenStreetMap (Leaflet + Nominatim), sem chave nem custo | `src/lib/geo.ts`, `src/components/Mapa.tsx` |
| DNS | Cloudflare → GitHub Pages | — |

Regras que valem a pena conhecer:

- **Preço, promoção, cupom e taxa de entrega são sempre calculados no banco** (`criar_pedido`), nunca confiados ao navegador. Um reenvio do mesmo pedido não o duplica.
- **O visitante só lê o cardápio.** O cliente com conta só enxerga os próprios dados. A equipe enxerga o que a função dela permite (tabela `permissoes`, aplicada no banco por RLS — não é só o menu que some). O motoboy não lê tabela nenhuma: usa funções que só devolvem as entregas dele.
- **Desperdício** (ingrediente que caiu, queimou ou foi usado errado) é registrado na aba própria do Estoque ou pelo botão da tela de Pedidos, sempre com o motivo; sai do estoque e entra no resultado junto com as perdas.
- **Confirmar um pedido** dá baixa no estoque pela ficha técnica; **cancelar** devolve o estoque e estorna o caixa; **reembolsar** estorna o caixa de um pedido já entregue.
- **Marcar como pago** lança a venda no caixa aberto.
- **Quem cria conta no site é sempre cliente.** O acesso ao painel só existe para quem a administradora cadastra em Configurações → Usuários: o papel fica em `app_metadata`, que só o servidor grava. Configurações internas (metas, alertas, impressão) não são lidas pelo visitante.
- **Motoboy recebe diária + entregas** (a taxa de cada pedido ou um valor fixo, por entregador). O acerto mostra o que cada um tem a receber, e o **pagamento** registrado em Pagamentos vira uma saída do dia; se o dinheiro saiu do caixa, a sangria é lançada junto.
- **Rastrear entrega** (quadro de Pedidos e detalhes do pedido): o painel lê a última posição do entregador (`entregadores.lat/lng/posicao_em`, gravada pelo aplicativo com `entrega_posicao`) a cada 10 s e avisa "sem sinal" quando ela tem mais de 2 minutos. Se o aplicativo passar a enviar em intervalos maiores, ajuste `SEM_SINAL_MS` em `src/admin/Rastreio.tsx`.
- **Não existe mais a tela Cozinha**: o preparo é acompanhado no quadro de Pedidos. A função Cozinha continua existindo e usa a tela de Pedidos.
- **Página inicial em dois modos** (Site e promoções → Página inicial): o padrão, com as seções prontas, e o livre, em que a administradora
  arrasta blocos de texto, imagem, botão e as próprias seções. Tudo fica no mesmo registro (`site_conteudo.dados`: `modo` e `blocos`); a prévia do
  painel é o próprio site dentro de um quadro (`/?previa=1`), recebendo o rascunho antes de salvar. Imagens enviadas pelo painel são reduzidas no
  navegador (até 1920 px, WebP) antes de subir.
- **Auditoria**: mudanças de preço, estoque, situação de pedido, configurações, usuários e permissões ficam registradas com quem, quando, antes e depois. Ninguém apaga pelo painel.

## Colocar no ar (uma vez)

### 1. Banco de dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. No terminal, dentro desta pasta:

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push --include-seed      # cria as tabelas e o cardápio de exemplo
   npx supabase config push                 # ajusta os links de login e o cadastro de clientes por e-mail
   npx supabase functions deploy fiscal --use-api           # --use-api dispensa o Docker
   npx supabase functions deploy admin-usuarios --use-api
   ```

3. No painel do Supabase, em **Authentication → Users → Add user**, crie o usuário da dona da loja.
   **O primeiro usuário criado por e-mail vira administrador** (uma única vez); os demais são criados pelo painel em Configurações → Usuários.
   Faça isso logo depois do passo anterior, antes de divulgar o site: enquanto não houver administrador, o primeiro cadastro por e-mail ganha esse acesso.

### 2. Site (GitHub Pages)

O site é publicado sozinho a cada `git push` na branch `main` (`.github/workflows/deploy.yml`).
Ele precisa de duas variáveis públicas do projeto Supabase (Project Settings → API Keys; a chave é a *publishable*):

```bash
gh variable set VITE_SUPABASE_URL --body "https://SEU-PROJETO.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "sb_publishable_..."
gh workflow run "Publicar site"
```

### 3. Domínio (Cloudflare)

Com o domínio adicionado na Cloudflare e os nameservers trocados na HostGator, crie os registros
(todos como **DNS only**, nuvem cinza, para o GitHub emitir o certificado HTTPS):

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `marcelconde.github.io` |

Depois, no GitHub: Settings → Pages → marque **Enforce HTTPS**.

### 4. Entrada do cliente com Google ou Facebook (opcional)

Sem isto o cliente pede normalmente e pode criar conta com e-mail e senha; só não aparecem os botões do Google e do Facebook
(o site confere sozinho se cada um está ligado no Supabase).

1. **Google**: no [Google Cloud Console](https://console.cloud.google.com), crie um projeto, configure a tela de consentimento e crie uma credencial *OAuth client ID* do tipo *Web application* com a URL de retorno `https://SEU-PROJETO.supabase.co/auth/v1/callback`.
2. No Supabase, em **Authentication → Providers → Google**, ligue o provedor e cole o *Client ID* e o *Client Secret*.
3. **Facebook**: o mesmo caminho, com um aplicativo em [developers.facebook.com](https://developers.facebook.com) (produto *Facebook Login*) e o provedor Facebook no Supabase.
4. No painel da pizzaria, em **Configurações → Pedidos → Conta do cliente**, ligue os botões que devem aparecer no site.

Quem entra com Google/Facebook é sempre cliente: nunca ganha acesso ao painel.

### 5. E-mails do login (Resend)

Os e-mails de **esqueci a senha** saem pelo [Resend](https://resend.com), com o remetente `Tia Cê Pizzas <contato@tiacepizzas.com.br>`
e o texto em português que está em `supabase/templates/`. O envio que vem com o Supabase gratuito não serve: só entrega para
quem é da própria organização e não deixa mudar os textos.

Para ligar em um projeto novo:

1. No Resend, em **Domains → Add domain**, cadastre o domínio (região São Paulo). Com a Cloudflare ligada à conta, os registros de
   DNS (`resend._domainkey`, `send` e `rsend`) são criados sozinhos; espere aparecer **Verified**.
2. Em **Settings → Integrations → Supabase → Connect to Supabase**, autorize, escolha o projeto e o domínio, deixe o assistente criar
   a chave e informe o remetente. Ele grava o SMTP no Supabase (Authentication → Emails → SMTP Settings); a chave nunca passa por este repositório.
3. Rode `npx supabase config push` para enviar os textos em português (só é aceito depois que o SMTP próprio está ligado).

Mudou um texto? Edite o arquivo em `supabase/templates/` e rode `npx supabase config push` de novo.

A conta do cliente é criada **sem e-mail de confirmação** (`enable_confirmations = false` em `supabase/config.toml`), para ele já sair
pedindo. O texto de confirmação já está pronto: para exigir, troque para `true` e rode `npx supabase config push`.
O plano gratuito do Resend envia até 100 e-mails por dia.

## Nota fiscal (NFC-e)

A emissão usa a API da [Focus NFe](https://focusnfe.com.br) e fica **desligada** até ser configurada.
Enquanto isso o sistema imprime um cupom simples, marcado como "não é documento fiscal".

1. Com a contabilidade: CNPJ com Inscrição Estadual credenciado para NFC-e na SEFAZ do estado, certificado digital A1 e CSC.
2. Na Focus NFe: cadastre a empresa, envie o certificado e o CSC, e copie os tokens.
3. Grave os tokens no servidor (nunca no código nem no navegador):

   ```bash
   npx supabase secrets set FOCUS_NFE_TOKEN_HOMOLOGACAO=... FOCUS_NFE_TOKEN_PRODUCAO=...
   ```

4. No painel, em **Fiscal → Configuração**: preencha CNPJ, razão social e IE, ligue a emissão e teste em **homologação**.
   Confira NCM, CFOP e CSOSN com a contabilidade antes de mudar para **produção**.

Observações: a SEFAZ só aceita cancelar uma NFC-e até 30 minutos após a emissão. Em entregas, a nota só sai como
"entrega em domicílio" quando o cliente informa CPF; sem CPF sai como venda presencial e a taxa vai como outras despesas.

## Impressora térmica

O cupom é impresso pelo navegador, em 80 mm ou 58 mm (Configurações → Impressão). Para sair direto, sem a janela de impressão:

1. Instale o driver da impressora e defina-a como **impressora padrão** do computador da loja.
2. No driver, escolha o tamanho do papel (80 mm) e ative o corte ao fim de cada página.
3. Crie um atalho do Chrome só para o painel:
   - **Windows:** `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://tiacepizzas.com.br/admin`
   - **macOS:** `open -a "Google Chrome" --args --kiosk-printing https://tiacepizzas.com.br/admin`

   (Feche todas as janelas do Chrome antes de abrir pelo atalho.)

Com "Aceitar automaticamente os pedidos do site" ligado em Configurações → Pedidos, o computador da loja confirma,
emite a nota e imprime sem ninguém clicar — basta o painel estar aberto.

## Cópia de segurança

O plano gratuito do Supabase não faz backup automático. Em **Configurações → Sistema → Baixar cópia de segurança** o
administrador baixa um arquivo com todos os dados; faça isso toda semana. Quando a operação depender do sistema,
vale o plano Pro (backup diário e projeto que não pausa).

## Desenvolvimento

```bash
npm install
npm run dev:local     # site + banco de teste em memória, só com o cardápio de exemplo
npm run dev:demo      # o mesmo, com um mês de pedidos, clientes e despesas fictícios
npm run test:db       # migrações e regras do banco (acesso por função, preço, estoque, caixa…)
npm run test:e2e      # usa o sistema pelas telas, num Chrome sem janela, e confere o banco
npm run manual        # refaz as capturas de tela e o PDF do manual
npm run video         # regrava o vídeo-tutorial narrado (cerca de meia hora; só no macOS)
npm run build
```

`dev:local` e `dev:demo` abrem o site em http://localhost:5173 sem Docker e sem tocar em dados reais (os dados somem ao
encerrar). Há um usuário de teste por função — administradora, financeiro, atendimento, cozinha e motoboy —, listados
com a senha no começo de `scripts/dev-local.mjs`; "Continuar com Google" entra como uma cliente fictícia. Esse modo
não tem tempo real (o painel atualiza a cada 45 s) nem nota fiscal.

`test:e2e`, `manual` e `video` usam o Google Chrome instalado (`CHROME=/caminho` para outro local) e sobem o próprio
ambiente em portas separadas, sem atrapalhar um `dev:local` aberto.

O vídeo é gravado em tempo real seguindo `scripts/video/roteiro.mjs` (o que é dito e o que acontece na tela), narrado
pela voz neural da Siri instalada no Mac ("Voz 2" em português; sem ela, cai na voz "Luciana", mais robótica — veja
`scripts/video/voz.swift`), e montado com legendas por `scripts/video/montar.swift` — sem ffmpeg. `npm run video -- --so=3,4`
grava só alguns capítulos, para conferir um ajuste.

O endereço e a chave pública do banco de produção ficam em `.env.production` (são valores públicos, os mesmos que vão no
JavaScript do site): `npm run build` em qualquer computador gera o site ligado ao banco real.
Para desenvolver contra o banco de verdade: `cp .env.production .env.local` e use `npm run dev`.

Mudou o banco? Crie um novo arquivo em `supabase/migrations/`, rode `npm run test:db` e depois `npx supabase db push`.
Mudou uma tela? Rode `npm run manual` (e, se o roteiro for afetado, `npm run video`) para a documentação acompanhar.
