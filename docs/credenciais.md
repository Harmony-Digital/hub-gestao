# Credenciais e variáveis de ambiente

Nenhum valor secreto entra em chat, commit, log, comentário de tarefa ou documento. Este arquivo diz **onde** cada credencial vive e **quem** a fornece, nunca o valor.

- Desenvolvimento: `app/.env.local` (fora do git), a partir de `app/.env.example`.
- Produção: `/opt/hub-gestao/shared/.env.production` na VPS, dono root, permissão `0600`.
- Build no GitHub Actions: segredos do repositório, só os públicos por natureza ou os de publicação.

| Variável | Para que serve | Onde fica | Quem fornece |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Endereço público do Hub | local, produção e build | definida no M2 |
| `APP_VERSION` | SHA publicado, exibido em `/api/health` | preenchida pelo pipeline | GitHub Actions |
| `NEXT_PUBLIC_SUPABASE_URL` | API do Supabase compartilhado | local, produção e build | Fábio |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública do Supabase, sempre com RLS | local, produção e segredo do build | Fábio |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso total do servidor ao banco | só `.env.local` e `.env.production` | Fábio |
| `HUB_API_KEY_PEPPER` | Tempero do hash das chaves de agente | só no servidor | gerado uma vez |
| `HUB_ENCRYPTION_KEY` | Cifra das chaves de IA guardadas no banco (AES-256-GCM) | só no servidor | gerado uma vez; se perder, as chaves de IA precisam ser recadastradas |
| `CRON_SECRET` | Protege as rotas internas do agendador | servidor e timer da VPS | gerado |
| `RESEND_API_KEY` | E-mails do portal do cliente | só no servidor | Fábio, no M6 |
| `GITHUB_WEBHOOK_SECRET` | Valida os webhooks do GitHub | servidor e configuração do webhook | gerado no M4 |
| `LLM_MONTHLY_BUDGET_USD` | Teto global de gasto com IA | servidor | 30, decisão D5 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` | Alternativa só para desenvolvimento local | só `.env.local` | Fábio |

## Segredos do GitHub Actions (M2)

`HUB_VPS_HOST`, `HUB_VPS_USER`, `HUB_VPS_SSH_KEY`, `HUB_VPS_KNOWN_HOSTS`, `HUB_NEXT_PUBLIC_SUPABASE_ANON_KEY` e a variável `HUB_DEPLOY_URL`. Quem provisiona é o Fábio.

## Rotação

Suspeita de vazamento: revogar ou trocar primeiro, investigar depois. Registrar a troca no `PLAN.md`, sem o valor.
