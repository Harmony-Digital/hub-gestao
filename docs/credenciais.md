# Credenciais e variáveis de ambiente

Nenhum valor secreto entra em chat, commit, log, comentário de tarefa ou documento. Este arquivo diz **onde** cada credencial vive e **quem** a fornece, nunca o valor.

- Desenvolvimento: `app/.env.local` (fora do git), a partir de `app/.env.example`.
- Produção: `/opt/hub-gestao/shared/.env.production` na VPS, dono root, permissão `0600`.
- Build no GitHub Actions: segredos do repositório, só os públicos por natureza ou os de publicação.

| Variável | Para que serve | Onde fica | Quem fornece |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Endereço público do Hub | local, produção e build | definida no M2 |
| `APP_VERSION` | SHA publicado, exibido em `/api/health` | preenchida pelo pipeline | GitHub Actions |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase compartilhado, usado pelo login da equipe (`https://supabase.harmonydigital.com.br`) | `.env.local` e build (entra na imagem, como toda `NEXT_PUBLIC_`) | fixo no workflow de publicação |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública (publishable) do Supabase, usada só pelo login; não é segredo, mas não vai para o repositório | `.env.local` e segredo do build `HUB_NEXT_PUBLIC_SUPABASE_ANON_KEY` | lida no MCP do Supabase; o Fábio cadastra o segredo |
| `SUPABASE_SERVICE_ROLE_KEY` | Não é usada pelo servidor do Hub: o banco é acessado pelo `DATABASE_URL`, com o papel próprio e sem passe livre na RLS. Fica no modelo só como referência | — | — |
| `HUB_API_KEY_PEPPER` | Tempero do hash das chaves de agente | só no servidor | gerado uma vez |
| `HUB_ENCRYPTION_KEY` | Cifra das chaves de IA guardadas no banco (AES-256-GCM) | só no servidor | gerado uma vez; se perder, as chaves de IA precisam ser recadastradas |
| `CRON_SECRET` | Protege as rotas internas do agendador | servidor e timer da VPS | gerado |
| `RESEND_API_KEY` | E-mails do portal do cliente | só no servidor | Fábio, no M6 |
| `GITHUB_WEBHOOK_SECRET` | Valida a assinatura dos eventos do GitHub (`/api/internal/webhooks/github`); 32 caracteres ou mais; sem ele, o webhook recusa tudo | `.env.production` e o campo Secret do webhook em cada repositório (`docs/github-webhook.md`) | Fábio gera e grava (passo do M4) |
| `LLM_MONTHLY_BUDGET_USD` | Teto global de gasto com IA | servidor | 30, decisão D5 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` | Alternativa só para desenvolvimento local | só `.env.local` | Fábio |
| `DATABASE_URL` | Conexão do servidor com o banco (papel próprio do Hub, sem passe livre na RLS) | só `.env.production` | Fábio, no M2, depois de autorizar o papel de banco |
| `HUB_DB_RUNTIME_ROLE` | Papel que o servidor assume em cada transação, se o login for diferente dele | só `.env.production` | definido no M2 |
| `HUB_AUTH_MAGIC_LINK` | Liga o link de acesso por e-mail na tela de login (`on`). Desligado até o Fábio autorizar, no Supabase compartilhado, o endereço de retorno do Hub e o envio de e-mails | servidor | Fábio |
| `HUB_WORKSPACE_SLUG` | Workspace usado pelo relógio dos jobs (padrão `harmony`) | servidor | fixo |
| `HUB_RATE_LIMIT_PER_MIN` | Limite de pedidos por chave de agente (padrão 600) | servidor | opcional |
| `LOG_LEVEL` | Nível do log estruturado (padrão `info`) | servidor | opcional |
| `HUB_DATA_DIR` | Pasta do banco local de desenvolvimento (padrão `.data/pglite`, fora do git) | só `.env.local` | opcional |
| `HUB_DEV_AGENT_KEY` | Chave do "Agente local de teste", registrada no banco local ao subir o servidor | só `.env.local` | gerada localmente; nunca existe em produção |
| `HUB_DEV_LOGIN` | `on` liga o login de teste ("Entrar como dono, sem senha") no `/login`, só fora da produção | só `.env.local` | opcional; o CI confere que a produção recusa |
| `HUB_DEV_LOGIN_SECRET` | Segredo de 32 caracteres ou mais que assina o cookie do login de teste | só `.env.local` | gerado localmente |
| `HUB_DEV_SAMPLE` | `on` cria no banco local o cliente "Clínica Exemplo" e o projeto de exemplo `EXE`, com pedidos de aprovação de exemplo | só `.env.local` | opcional |
| `HUB_DEV_POLL_MS` | Liga a observação de arquivos por consulta periódica no `next dev` (milissegundos, ex.: 1000), para quando o macOS esgota os observadores | ambiente do `next dev` local (a configuração do preview já passa) | opcional; nunca em produção |

## Segredos do GitHub Actions (M2)

`HUB_VPS_HOST`, `HUB_VPS_USER`, `HUB_VPS_SSH_KEY`, `HUB_VPS_KNOWN_HOSTS`, `HUB_NEXT_PUBLIC_SUPABASE_ANON_KEY` e a variável `HUB_DEPLOY_URL`. Quem provisiona é o Fábio.

## Rotação

Suspeita de vazamento: revogar ou trocar primeiro, investigar depois. Registrar a troca no `PLAN.md`, sem o valor.
