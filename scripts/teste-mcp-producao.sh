#!/usr/bin/env bash
# Hub de Gestão · teste do GATE M2: o Claude Code conclui uma tarefa pelo MCP de produção.
#
# Pré-requisito: scripts/conectar-claude-code.sh (chave nas Chaves do macOS).
# O Claude Code roda sem nenhuma ferramenta do computador, só com as do Hub, e tudo o que
# ele faz fica no histórico do Hub, em nome do agente dono da chave.
set -euo pipefail

readonly CONFIG_FILE="$HOME/.config/hub-gestao/mcp-producao.json"
readonly KEYCHAIN_SERVICE="hub-gestao-producao"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Rode antes: bash scripts/conectar-claude-code.sh"
  exit 1
fi
if ! HUB_API_KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)"; then
  echo "A chave não está nas Chaves do macOS. Rode antes: bash scripts/conectar-claude-code.sh"
  exit 1
fi
export HUB_API_KEY

now="$(date '+%d/%m/%Y às %H:%M')"
prompt="Você é um agente operador do Hub de Gestão da Harmony, conectado pelo MCP de produção. Siga as instruções do servidor.
1. Chame hub_whoami.
2. No projeto HUB, crie a tarefa \"Teste do GATE M2: Claude Code conclui tarefa por MCP em produção\".
3. Inicie a tarefa.
4. Conclua a tarefa com a evidência: \"Criada, iniciada e concluída pelo Claude Code via MCP em produção em ${now}.\"
5. Responda numa linha: o código da tarefa e o estado final."

echo "Rodando o Claude Code só com as ferramentas do Hub..."
# Só o servidor do Hub (nenhum outro conector) e um modelo mais barato: o teste é simples.
result="$(claude -p "$prompt" \
  --model sonnet \
  --mcp-config "$CONFIG_FILE" --strict-mcp-config \
  --tools "" --allowedTools "mcp__hub" \
  --output-format json)"

printf '%s' "$result" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const r = JSON.parse(s);
    console.log("Resposta do Claude Code: " + String(r.result ?? "").trim());
    if (typeof r.total_cost_usd === "number") {
      console.log("Custo do teste: US$ " + r.total_cost_usd.toFixed(2));
    }
    if (r.is_error) process.exit(1);
  });
'
