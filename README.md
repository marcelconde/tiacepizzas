# Tia Cê Pizzas

Site de pedidos e sistema de gestão da pizzaria, em [tiacepizzas.com.br](https://tiacepizzas.com.br).

- **Site público** — cardápio, montagem de pizza (tamanho, meio a meio, borda, adicionais), sacola, finalização e acompanhamento do pedido.
- **Painel da equipe** (`/admin`) — pedidos em tempo real, venda de balcão/telefone, tela da cozinha, clientes, cardápio, estoque com ficha técnica, caixa, entregas, financeiro, nota fiscal (NFC-e) e configurações.

## Como é montado

| Parte | Onde roda | Pasta |
| --- | --- | --- |
| Site e painel (React + Vite + Tailwind) | GitHub Pages | `src/` |
| Banco, login, tempo real e fotos | Supabase (Postgres) | `supabase/migrations/` |
| Nota fiscal e criação de usuários | Supabase Edge Functions | `supabase/functions/` |
| DNS | Cloudflare → GitHub Pages | — |

Regras que valem a pena conhecer:

- **Preço é sempre calculado no banco** (`criar_pedido`), nunca confiado ao navegador.
- **O visitante só lê o cardápio.** Pedidos, clientes, caixa e estoque exigem usuário ativo do painel (RLS em todas as tabelas).
- **Confirmar um pedido** dá baixa no estoque pela ficha técnica; **cancelar** devolve o estoque e estorna o caixa.
- **Marcar como pago** lança a venda no caixa aberto.

## Colocar no ar (uma vez)

### 1. Banco de dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. No terminal, dentro desta pasta:

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push --include-seed      # cria as tabelas e o cardápio de exemplo
   npx supabase config push                 # desliga o autocadastro e ajusta os links de e-mail
   npx supabase functions deploy fiscal
   npx supabase functions deploy admin-usuarios
   ```

3. No painel do Supabase, em **Authentication → Users → Add user**, crie o usuário da dona da loja.
   **O primeiro usuário criado vira administrador**; os demais são criados pelo painel em Configurações → Usuários.

### 2. Site (GitHub Pages)

O site é publicado sozinho a cada `git push` na branch `main` (`.github/workflows/deploy.yml`).
Ele precisa de duas variáveis públicas do projeto Supabase (Project Settings → API):

```bash
gh variable set VITE_SUPABASE_URL --body "https://SEU-PROJETO.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "CHAVE-PUBLICA-ANON"
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

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha com os dados do projeto Supabase
npm run dev                  # http://localhost:5173
npm run test:db              # testa migrações e regras do banco num Postgres em memória
npm run build
```

Mudou o banco? Crie um novo arquivo em `supabase/migrations/`, rode `npm run test:db` e depois `npx supabase db push`.
