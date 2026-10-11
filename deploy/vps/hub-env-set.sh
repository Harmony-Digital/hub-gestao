#!/bin/sh
# Hub de Gestão · grava uma variável no .env.production da VPS (roda como root).
#
# Uso, sempre por um script do Fábio (ex.: hub-alert-secret.sh):
#   printf '%s\n' "<valor>" | sudo sh hub-env-set.sh NOME
#
# O valor vem pela entrada padrão, nunca como argumento (argumento aparece na lista de
# processos). Só aceita os nomes da lista abaixo e valor hexadecimal de 32 a 128
# caracteres. Troca a linha anterior do mesmo nome, se houver, e mantém o dono e a
# permissão do arquivo. Para sem mudar nada se o arquivo não existir, estiver vazio ou
# se a conferência do resultado falhar. Nunca mostra o valor.
set -eu

ENV_FILE="${HUB_ENV_FILE:-/opt/hub-gestao/shared/.env.production}"
name="${1:-}"

case "$name" in
  HUB_ALERT_SECRET | GITHUB_WEBHOOK_SECRET) ;;
  *)
    echo "Variável não permitida: '$name'." >&2
    exit 64
    ;;
esac

if [ ! -s "$ENV_FILE" ]; then
  echo "O arquivo $ENV_FILE não existe ou está vazio: nada foi mudado." >&2
  exit 66
fi

value=""
IFS= read -r value || true
case "$value" in
  "" | *[!0-9a-f]*)
    echo "Valor inválido (só hexadecimal minúsculo): nada foi mudado." >&2
    exit 65
    ;;
esac
if [ "${#value}" -lt 32 ] || [ "${#value}" -gt 128 ]; then
  echo "Valor com tamanho fora de 32 a 128 caracteres: nada foi mudado." >&2
  exit 65
fi

tmp="$(mktemp "$ENV_FILE.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# Copia tudo menos a linha antiga; grep devolve 1 quando não sobra linha, 2 em erro.
status=0
grep -v "^$name=" "$ENV_FILE" >"$tmp" || status=$?
if [ "$status" -gt 1 ]; then
  echo "Falha ao ler $ENV_FILE: nada foi mudado." >&2
  exit 74
fi
printf '%s=%s\n' "$name" "$value" >>"$tmp"

# Conferência: as outras linhas continuam (inclusive a do banco) e a nova aparece uma vez.
before="$(grep -cv "^$name=" "$ENV_FILE" || true)"
after="$(grep -cv "^$name=" "$tmp" || true)"
if [ "$before" != "$after" ] ||
  [ "$(grep -c "^$name=" "$tmp")" != 1 ] ||
  ! grep -q '^DATABASE_URL=' "$tmp"; then
  echo "A conferência do arquivo novo falhou: nada foi mudado." >&2
  exit 70
fi

chown "$(stat -c '%u:%g' "$ENV_FILE")" "$tmp"
chmod "$(stat -c '%a' "$ENV_FILE")" "$tmp"
mv -f "$tmp" "$ENV_FILE"
trap - EXIT
echo "$name gravado em $ENV_FILE (o valor não é mostrado)."
