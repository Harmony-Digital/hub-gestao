#!/usr/bin/env bash
# Hub de Gestão · cria o papel de banco próprio do servidor (hub_gestao_app).
#
# MUDANÇA GLOBAL no Supabase compartilhado: só roda com autorização específica do Fábio.
# Uso, como root na VPS: /opt/hub-gestao/bin/hub-db-provision.sh
#
# A senha é gerada aqui e vai direto para o .env.production. O banco recebe só o
# verificador SCRAM-SHA-256 (hub-db-verifier.py): a senha não aparece na tela, no log do
# Postgres nem em argumento de processo. Não sobrescreve um DATABASE_URL que já exista.
set -euo pipefail
umask 077

CONFIG_DIR=/opt/hub-gestao/config
ENV_FILE=/opt/hub-gestao/shared/.env.production

if [[ $EUID -ne 0 ]]; then
  echo "Rode como root." >&2
  exit 1
fi
for file in "$CONFIG_DIR/hub-db-role.sql" "$CONFIG_DIR/hub-db-verifier.py" "$ENV_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "Falta $file." >&2
    exit 1
  fi
done
if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  echo "DATABASE_URL já existe em $ENV_FILE; nada foi alterado." >&2
  exit 1
fi

senha="$(openssl rand -hex 32)"
verificador="$(printf '%s\n' "$senha" | python3 -I "$CONFIG_DIR/hub-db-verifier.py")"

{
  printf '\\set hub_verifier '"'"'%s'"'"'\n' "$verificador"
  cat "$CONFIG_DIR/hub-db-role.sql"
} | docker exec -i supabase-db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1

printf 'DATABASE_URL=postgresql://hub_gestao_app:%s@supabase-db:5432/postgres\n' "$senha" >>"$ENV_FILE"
echo "Papel hub_gestao_app pronto. DATABASE_URL gravada em $ENV_FILE (valor não exibido)."
