#!/usr/bin/env bash
# Comando forçado da chave SSH de publicação (authorized_keys com command=):
# aceita só "load <sha de 40 caracteres>" e chama o script de publicação como root.
set -Eeuo pipefail

if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^load[[:space:]]([0-9a-f]{40})$ ]]; then
  exec sudo -n /opt/hub-gestao/bin/hub-deploy.sh "${BASH_REMATCH[1]}"
fi

printf 'Comando de publicação inválido.\n' >&2
exit 64
