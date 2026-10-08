# Tia Cê Pizzas

Site de pedidos e sistema de gestão da pizzaria, em [tiacepizzas.com.br](https://tiacepizzas.com.br).

- **Site público** — página inicial editável, cardápio, montagem de pizza (tamanho, vários sabores, borda, adicionais), promoções, sacola, finalização (entrega por bairro ou por distância) e acompanhamento do pedido com mapa. O cliente pode pedir sem cadastro ou entrar com Google/Facebook para guardar endereços e ver seus pedidos.
- **Painel da equipe** (`/admin`) — pedidos em tempo real com alertas de atraso, venda de balcão/telefone, cozinha, clientes, cardápio com ficha técnica, site e promoções, estoque, caixa, entregas, financeiro, indicadores com metas, análises de produtos e clientes, nota fiscal (NFC-e), auditoria e configurações (usuários e permissões por função).
- **Aplicativo do entregador** (`/entregador`) — entregas do motoboy, rota, WhatsApp do cliente, registro de entrega ou problema e envio da localização.

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
- **Confirmar um pedido** dá baixa no estoque pela ficha técnica; **cancelar** devolve o estoque e estorna o caixa; **reembolsar** estorna o caixa de um pedido já entregue.
- **Marcar como pago** lança a venda no caixa aberto.
- **Ninguém se cadastra sozinho com e-mail e senha.** A equipe é criada pela administradora; o banco recusa qualquer outro cadastro por e-mail. Configurações internas (metas, alertas, impressão) não são lidas pelo visitante.
- **Auditoria**: mudanças de preço, estoque, situação de pedido, configurações, usuários e permissões ficam registradas com quem, quando, antes e depois. Ninguém apaga pelo painel.

## Colocar no ar (uma vez)

### 1. Banco de dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. No terminal, dentro desta pasta:

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push --include-seed      # cria as tabelas e o cardápio de exemplo
   npx supabase config push                 # ajusta os links de login e fecha o cadastro público
   npx supabase functions deploy fiscal --use-api           # --use-api dispensa o Docker
   npx supabase functions deploy admin-usuarios --use-api
   ```

3. No painel do Supabase, em **Authentication → Users → Add user**, crie o usuário da dona da loja.
   **O primeiro usuário criado por e-mail vira administrador**; os demais são criados pelo painel em Configurações → Usuários.

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

Sem isto o cliente pede normalmente, só não tem conta.

1. **Google**: no [Google Cloud Console](https://console.cloud.google.com), crie um projeto, configure a tela de consentimento e crie uma credencial *OAuth client ID* do tipo *Web application* com a URL de retorno `https://SEU-PROJETO.supabase.co/auth/v1/callback`.
2. No Supabase, em **Authentication → Providers → Google**, ligue o provedor e cole o *Client ID* e o *Client Secret*.
3. **Facebook**: o mesmo caminho, com um aplicativo em [developers.facebook.com](https://developers.facebook.com) (produto *Facebook Login*) e o provedor Facebook no Supabase.
4. Em `supabase/config.toml`, troque `enable_signup = false` por `true` na seção `[auth]` e rode `npx supabase config push`. Sem isso o primeiro acesso de um cliente é recusado. (O cadastro por e-mail continua barrado pelo banco.)
5. No painel da pizzaria, em **Configurações → Pedidos → Conta do cliente**, ligue os botões que devem aparecer no site.

Quem entra com Google/Facebook é sempre cliente: nunca ganha acesso ao painel.

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

O vídeo é gravado em tempo real seguindo `scripts/video/roteiro.mjs` (o que é dito e o que acontece na tela), com a voz
"Luciana" do macOS, e montado com legendas por `scripts/video/montar.swift` — sem ffmpeg. `npm run video -- --so=3,4`
grava só alguns capítulos, para conferir um ajuste.

Para desenvolver contra o banco de verdade: `cp .env.example .env.local`, preencha com os dados do projeto Supabase e use `npm run dev`.

Mudou o banco? Crie um novo arquivo em `supabase/migrations/`, rode `npm run test:db` e depois `npx supabase db push`.
Mudou uma tela? Rode `npm run manual` (e, se o roteiro for afetado, `npm run video`) para a documentação acompanhar.
