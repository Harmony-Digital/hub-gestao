#!/bin/sh
# Hub de Gestão · grava uma variável no .env.production da VPS (roda como root).
#
# Uso, sempre por um script do Fábio (ex.: hub-alert-secret.sh):
#   printf '%s\n' "<valor>" | sudo sh hub-env-set.sh NOME
#
# O valor vem pela entrada padrão, nunca como argumento (argumento aparece na lista de
# processos). Só aceita os nomes da lista abaixo, cada um com o formato dele: segredo
# hexadecimal de 32 a 128 caracteres, chave do Resend (re_...) ou endereço de e-mail
# simples (sem nome nem espaço). Troca a linha anterior do mesmo nome, se houver, e mantém o dono e a
# permissão do arquivo. Para sem mudar nada se o arquivo não existir, estiver vazio ou
# se a conferência do resultado falhar. Nunca mostra o valor.
set -eu

ENV_FILE="${HUB_ENV_FILE:-/opt/hub-gestao/shared/.env.production}"
name="${1:-}"

invalid() {
  echo "Valor inválido ($1): nada foi mudado." >&2
  exit 65
}

case "$name" in
  HUB_ALERT_SECRET | GITHUB_WEBHOOK_SECRET) kind=hex ;;
  RESEND_API_KEY) kind=resend ;;
  HUB_EMAIL_FROM | HUB_EMAIL_REPLY_TO) kind=address ;;
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
case "$kind" in
  hex)
    case "$value" in
      "" | *[!0-9a-f]*) invalid "só hexadecimal minúsculo" ;;
    esac
    if [ "${#value}" -lt 32 ] || [ "${#value}" -gt 128 ]; then
      invalid "tamanho fora de 32 a 128 caracteres"
    fi
    ;;
  resend)
    case "$value" in
      re_*) ;;
      *) invalid "a chave do Resend começa com re_" ;;
    esac
    case "${value#re_}" in
      "" | *[!A-Za-z0-9_]*) invalid "a chave do Resend só tem letras, números e _" ;;
    esac
    if [ "${#value}" -lt 20 ] || [ "${#value}" -gt 200 ]; then
      invalid "tamanho fora de 20 a 200 caracteres"
    fi
    ;;
  address)
    case "$value" in
      "" | *[!A-Za-z0-9._%+@-]* | *@*@* | @* | *@) invalid "um endereço simples, como hub@dominio.com.br" ;;
    esac
    case "$value" in
      *@*.*) ;;
      *) invalid "um endereço simples, como hub@dominio.com.br" ;;
    esac
    if [ "${#value}" -gt 254 ]; then
      invalid "endereço longo demais"
    fi
    ;;
esac

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
