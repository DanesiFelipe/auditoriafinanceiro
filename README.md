# Freshservice Auditoria Financeira

Uma aplicação web standalone (HTML, JS, CSS puro) com design Premium Dark Mode para auditar solicitações de pagamento do Freshservice.

## Como funciona?

Como o Freshservice bloqueia chamadas via browser (CORS), usamos o **GitHub Actions** para fazer a ponte:
1. O GitHub Actions roda o script Node.js a cada X horas.
2. O script usa sua `API_KEY` para buscar os tickets no Freshservice.
3. O script salva os dados formatados em `data/tickets.json`.
4. O GitHub Pages hospeda gratuitamente o site HTML, que apenas lê esse arquivo estático.

## Como configurar no seu GitHub

1. **Suba este código** para um repositório no seu GitHub (público ou privado).
2. Vá na aba **Settings** > **Secrets and variables** > **Actions**.
3. Crie os seguintes **New repository secrets**:
   - `FRESHSERVICE_DOMAIN`: (ex: `trinus.freshservice.com`)
   - `FRESHSERVICE_API_KEY`: A chave da sua API (Pegue no seu perfil do Freshservice).
   - `WORKSPACE_ID`: (Opcional) O ID do workspace de Backoffice Financeiro se quiser filtrar.
4. Vá em **Settings** > **Pages** e ative o GitHub Pages usando a branch `main` (pasta root `/`).
5. Vá na aba **Actions** e rode manualmente o workflow `Fetch Freshservice Tickets` a primeira vez.

## Estrutura

- `index.html`, `style.css`, `app.js` -> Interface do usuário
- `data/tickets.json` -> O "banco de dados" falso, atualizado pelo bot do GitHub
- `scripts/fetch-tickets.js` -> O robô que fala com o Freshservice
- `.github/workflows/fetch-data.yml` -> O agendador que manda o robô trabalhar

## Funcionalidades
- **Design Premium**: Visual moderno e dark mode que impressiona.
- **Filtros Ágeis**: Busque por status, tipo de pgto, empresa e data. Busca global ultrarrápida.
- **Exportação**: Exporte os dados em tela para Excel (.xlsx) e CSV.
- **Detalhes Completos**: Clique no "olho" para ver os dados e baixar os anexos.
