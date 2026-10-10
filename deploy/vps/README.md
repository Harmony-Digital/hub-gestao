# Publicação do Hub de Gestão na VPS

O Hub roda em um contêiner Docker isolado na KVM4 da Harmony (`1821299`, `vps-harmony-digital`), no endereço `https://hub.harmonydigital.com.br`, e usa o Supabase compartilhado (schema `proj_hub_gestao`). O padrão é o mesmo do Certato, com nomes `hub-*`.

## Fluxo de publicação

1. Um commit chega à `main` de `Harmony-Digital/hub-gestao`, sempre por merge de um pull request aprovado.
2. O workflow **Qualidade** confere formato, lint, tipos, testes e build, e constrói e testa a imagem de produção.
3. Só com o CI verde, o workflow **Publicação na VPS** constrói a imagem daquele commit, sem segredos de runtime.
4. Uma chave SSH restrita entrega a imagem à VPS, que confere a revisão, troca o contêiner e espera ficar saudável.
5. Se a nova versão não ficar saudável, a anterior volta sozinha.
6. O workflow confirma que `/api/health` responde com o SHA publicado.

A publicação fica **desligada** até a variável do repositório `HUB_DEPLOY_ENABLED` valer `true`.

## Limite de autonomia

O que está nesta pasta é a fonte canônica, versionada. As cópias ativas ficam sob `root` na VPS e só mudam com autorização do Fábio:

| Arquivo do repositório | Cópia ativa na VPS |
|---|---|
| `docker-compose.yml` | `/opt/hub-gestao/config/docker-compose.yml` |
| `hub-deploy.sh` | `/opt/hub-gestao/bin/hub-deploy.sh` |
| `hub-deploy-ssh.sh` | `/opt/hub-gestao/bin/hub-deploy-ssh.sh` |
| `hub-backup.sh` | `/opt/hub-gestao/bin/hub-backup.sh` |
| `hub-traefik.yaml` | `/etc/easypanel/traefik/config/hub.yaml` |
| `hub-cron.service`, `hub-cron.timer` | `/etc/systemd/system/` |
| `hub-backup.service`, `hub-backup.timer` | `/etc/systemd/system/` |
| `hub-db-role.sql`, `hub-db-verifier.py` | `/opt/hub-gestao/config/` (usados no provisionamento do banco) |
| `hub-db-provision.sh` | `/opt/hub-gestao/bin/hub-db-provision.sh` |
| `hub-provision.sh` | `/opt/hub-gestao/bin/hub-provision.sh` (unidades systemd copiadas antes para `/opt/hub-gestao/config/systemd/`) |

O Dockerfile roda só no runner descartável do GitHub e nunca recebe os segredos de runtime. O publicador automático não tem shell: a chave dele aceita somente `load <sha>` e recebe a imagem pela entrada padrão.

## Isolamento

- Rede própria `hub_proxy` entre o Traefik e o Hub, sem ligação com Hermes ou Certato.
- Rede `supabase_default` só para falar com o banco (`supabase-db:5432`), como os outros apps da VPS.
- Sem volumes, sem modo privilegiado e sem `docker.sock`.
- Processo sem root, todas as capabilities removidas, sistema de arquivos somente leitura.
- Limites iniciais: 1,5 CPU, 2 GB de RAM e 256 processos.
- Segredos só em `/opt/hub-gestao/shared/.env.production`, dono root, permissão `0600`.
- O servidor recusa abrir o banco com papel que passe por cima da RLS (`app/src/lib/db/guard.ts`).
- Cabeçalhos de segurança e `noindex` aplicados pelo Traefik; limite de 60 pedidos por segundo por origem.

## Variáveis do `.env.production`

Nomes e origem em `docs/credenciais.md`. As principais para o M2: `DATABASE_URL` (papel próprio do Hub), `HUB_API_KEY_PEPPER`, `HUB_ENCRYPTION_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`. O endereço e a chave pública do Supabase entram no build da imagem, não neste arquivo. Os segredos são gerados na própria VPS e nunca passam por chat, commit ou log.

## Segredos do GitHub Actions

Segredos do repositório: `HUB_VPS_HOST`, `HUB_VPS_USER`, `HUB_VPS_SSH_KEY`, `HUB_VPS_KNOWN_HOSTS` e `HUB_NEXT_PUBLIC_SUPABASE_ANON_KEY`. Variáveis: `HUB_DEPLOY_URL` e `HUB_DEPLOY_ENABLED`. O plano Free da organização não tem ambientes em repositório privado; por isso são segredos do repositório. Nunca documentar os valores.

## Provisionamento (uma vez, com autorização do Fábio)

A parte que envolve contas de acesso (o papel no banco e o usuário de publicação, com a chave do GitHub Actions) o Fábio roda no próprio Mac com `hub-provision-local.sh`: o script gera a chave, roda as etapas `banco` e `publicador` na VPS, confere que a chave só aceita o comando de publicação e só então guarda a parte privada no GitHub.

Os passos de root ficam em `hub-provision.sh`, por etapa (`banco`, `publicador`, `rede`, `agenda`, `traefik`, `rota`; `preparar` junta as quatro primeiras). Cada etapa confere o que já existe e pode rodar de novo. A etapa `traefik` reinicia o Traefik e deixa os sites da VPS fora do ar por alguns segundos; se a atualização falhar, ela volta sozinha à configuração anterior.

1. DNS: registro `hub` na zona `harmonydigital.com.br`, CNAME para `srv1821299.hstgr.cloud`.
2. Banco: papel próprio do Hub no Supabase compartilhado, com login, sem `BYPASSRLS`, com acesso só ao schema `proj_hub_gestao` (seção "Papel de banco").
3. VPS: pastas `/opt/hub-gestao/{bin,config,shared,backups}` (root), `.env.production` gerado na própria VPS, rede `hub_proxy` ligada ao Traefik.
4. Usuário de publicação com a chave restrita ao comando `hub-deploy-ssh.sh` e `sudo` só para `/opt/hub-gestao/bin/hub-deploy.sh`.
5. Rota do Traefik instalada; certificado emitido pelo Let's Encrypt.
6. Timers `hub-cron` (a cada 5 minutos) e `hub-backup` (diário) habilitados; primeiro backup conferido.
7. Segredos e variáveis no GitHub; `HUB_DEPLOY_ENABLED=true`; primeira publicação acompanhada.
8. Login: o Fábio cria o próprio usuário no Supabase Auth (seção "Login da equipe") e entra em `https://hub.harmonydigital.com.br`.

## Papel de banco (com autorização específica do Fábio)

O servidor do Hub entra no banco com um papel só dele, `hub_gestao_app`: com login, sem passe livre na RLS, sem poder criar papel ou banco, e com acesso só ao schema `proj_hub_gestao`. A senha é gerada na própria VPS e vai direto para o `.env.production`; o banco recebe só o verificador SCRAM-SHA-256, então a senha não aparece em tela, em log do Postgres nem em argumento de processo. Ensaiado no banco local em 2026-10-09 (papel criado, `guard.ts` aceitou, sem contexto de ator nada aparece).

```bash
sudo install -m 0644 hub-db-role.sql hub-db-verifier.py /opt/hub-gestao/config/
sudo install -m 0750 hub-db-provision.sh /opt/hub-gestao/bin/
sudo /opt/hub-gestao/bin/hub-db-provision.sh
```

O contêiner do Hub fala com o banco pela rede interna `supabase_default`; a porta 5432 não é aberta para fora. Ao subir, o Hub recusa abrir o banco se o papel passar por cima da RLS (`app/src/lib/db/guard.ts`).

## Login da equipe (Supabase Auth)

O login usa o Supabase Auth compartilhado da Harmony, com cadastro aberto desligado. O Hub confere a sessão no próprio GoTrue a cada tela e, no primeiro login, liga o usuário ao perfil da equipe pelo e-mail confirmado (migration `hub_gestao_0010_auth_login.sql`). Login sem perfil ativo e vínculo ativo com o workspace é encerrado na hora.

- **Usuário do Fábio:** se já existe login no Supabase da Harmony com `contato@harmonydigital.com.br`, é o mesmo. Se não existe, o próprio Fábio cria no Studio (Authentication, Users, Add user, Create new user), com a senha dele e "Auto Confirm User" marcado. Nenhum agente digita ou guarda essa senha.
- **Primeiro login:** liga o usuário ao perfil `owner` do seed e registra `profile.login_linked` no histórico.
- **Cookies da sessão:** só do domínio do Hub, invisíveis para scripts da página (`HttpOnly`), só por HTTPS em produção.
- **Link de acesso por e-mail (opcional):** desligado. Para ligar, com autorização do Fábio, porque muda o Supabase compartilhado: incluir `https://hub.harmonydigital.com.br/auth/confirmar` na lista de endereços de retorno do GoTrue, conferir o envio de e-mails e pôr `HUB_AUTH_MAGIC_LINK=on` no `.env.production`.
- **Limite de tentativas:** além do que o GoTrue já aplica, o Hub aceita 20 tentativas por origem e 8 por e-mail a cada 15 minutos.

## Backup (decisão D8)

`hub-backup.sh` gera todo dia um dump do schema `proj_hub_gestao`, confere que ele abre e guarda 14 dias em `/opt/hub-gestao/backups`. A cópia fora da VPS espera o destino que o Fábio escolher; o snapshot semanal da VPS e o teste mensal de restauração ficam no M8.

## Operação

```bash
sudo docker ps --filter name=hub-app
sudo docker logs --tail 100 hub-app
sudo systemctl status hub-cron.timer hub-backup.timer
curl --fail https://hub.harmonydigital.com.br/api/health
```

Ao encerrar uma entrega: run verde no GitHub, `/api/health` com o SHA publicado, login do Fábio na tela e um teste real pelo MCP em produção.
