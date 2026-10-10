#!/usr/bin/env bash
# Hub de Gestão · liga o Claude Code deste Mac ao MCP de produção.
#
# Use depois de criar a chave do agente na tela Agentes (https://hub.harmonydigital.com.br/agentes).
# 1. Pede a chave sem mostrar na tela.
# 2. Confere a chave no próprio Hub (GET /api/v1/me) antes de guardar.
# 3. Guarda a chave nas Chaves do macOS (Keychain), serviço "hub-gestao-producao".
# 4. Escreve ~/.config/hub-gestao/mcp-producao.json, sem segredo: o arquivo lê a chave
#    da variável HUB_API_KEY, que o teste preenche a partir das Chaves na hora de rodar.
set -euo pipefail

readonly HUB_URL="https://hub.harmonydigital.com.br"
readonly KEYCHAIN_SERVICE="hub-gestao-producao"
readonly CONFIG_DIR="$HOME/.config/hub-gestao"
readonly CONFIG_FILE="$CONFIG_DIR/mcp-producao.json"
readonly KEY_PATTERN='^hub_ak_[a-z0-9]{8,16}\.[A-Za-z0-9_-]{32,128}$'

printf 'Cole a chave do agente (ela não aparece na tela) e tecle Enter: '
IFS= read -rs key
echo
key="${key//[[:space:]]/}"
if [[ ! "$key" =~ $KEY_PATTERN ]]; then
  echo "Isso não parece uma chave do Hub (começa com hub_ak_). Nada foi guardado."
  exit 1
fi

# O cabeçalho vai pela entrada padrão do curl, para a chave não aparecer na lista de processos.
if ! me="$(printf 'header = "Authorization: Bearer %s"\n' "$key" |
  curl -sS --fail --max-time 20 --config - "$HUB_URL/api/v1/me")"; then
  echo "O Hub recusou a chave (revogada, vencida ou digitada errada). Nada foi guardado."
  exit 1
fi

security add-generic-password -U -a "$USER" -s "$KEYCHAIN_SERVICE" \
  -l "Hub de Gestão (produção)" -w "$key"
unset key

install -d -m 0700 "$CONFIG_DIR"
umask 077
cat >"$CONFIG_FILE" <<'JSON'
{
  "mcpServers": {
    "hub": {
      "type": "http",
      "url": "https://hub.harmonydigital.com.br/mcp",
      "headers": { "Authorization": "Bearer ${HUB_API_KEY}" }
    }
  }
}
JSON

printf '%s' "$me" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const me = JSON.parse(s);
    const projects = me.all_projects ? "todos" : (me.projects ?? []).map((p) => p.code).join(", ");
    console.log(`Pronto. Chave do agente "${me.actor?.name}" guardada nas Chaves do macOS.`);
    console.log(`Permissões: ${(me.key?.scopes ?? []).join(", ")}`);
    console.log(`Projetos: ${projects}`);
  });
'
