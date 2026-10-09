#!/usr/bin/env bash
# Hub de Gestão · provisionamento da VPS (M2), autorizado pelo Fábio em 2026-10-09.
#
# Uso, como root: /opt/hub-gestao/bin/hub-provision.sh <etapa>
#   banco       cria o papel hub_gestao_app (hub-db-provision.sh) e confere a conexão
#   publicador  cria o usuário hubdeploy, com a chave do GitHub Actions restrita ao comando
#               de publicação, sudo só para hub-deploy.sh e entrada liberada no SSH
#   rede        cria a rede própria hub_proxy (não mexe no Traefik)
#   agenda      instala os timers do relógio (5 min) e do backup diário e roda o 1º backup
#   traefik     liga a rede hub_proxy ao Traefik. ATENÇÃO: reinicia o Traefik e deixa os
#               sites da VPS fora do ar por alguns segundos. Volta sozinho se falhar.
#   rota        instala a rota hub.harmonydigital.com.br no Traefik (exige o DNS no ar)
#   preparar    banco + publicador + rede + agenda (tudo, menos traefik e rota)
#
# Cada etapa confere o que já existe e pode rodar de novo sem estragar nada. Segredos
# nunca aparecem na tela. Arquivos de origem: /opt/hub-gestao/config (cópias do repositório).
set -Eeuo pipefail

readonly ROOT_DIR=/opt/hub-gestao
readonly CONFIG_DIR="$ROOT_DIR/config"
readonly ENV_FILE="$ROOT_DIR/shared/.env.production"
readonly DEPLOY_USER=hubdeploy
readonly DEPLOY_KEY_FILE="$CONFIG_DIR/hub-github-actions.pub"
readonly SSHD_FILE=/etc/ssh/sshd_config.d/00-harmony-hardening.conf
readonly SUDOERS_FILE=/etc/sudoers.d/hubdeploy
readonly TRAEFIK_SERVICE=easypanel-traefik
readonly TRAEFIK_ROUTE=/etc/easypanel/traefik/config/hub.yaml
readonly HUB_HOST=hub.harmonydigital.com.br
readonly VPS_IP=217.196.63.157
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { printf '[hub-provision] %s\n' "$*"; }
fail() { log "ERRO: $*"; exit 1; }

step_banco() {
  if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
    log "banco: DATABASE_URL já existe; papel mantido."
  else
    "$ROOT_DIR/bin/hub-db-provision.sh"
  fi
  local image
  image="$(docker inspect supabase-db --format '{{.Config.Image}}')"
  log "banco: conferindo a conexão do papel do Hub pela rede interna."
  # A consulta vai pela entrada padrão: a senha fica só no ambiente do contêiner temporário.
  docker run --rm -i --network supabase_default --env-file "$ENV_FILE" \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --entrypoint sh "$image" -c 'psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1' <<'SQL'
select format('usuário=%s superusuário=%s ignora_rls=%s workspace_harmony=%s projetos_sem_contexto=%s',
  current_user, r.rolsuper, r.rolbypassrls,
  proj_hub_gestao.workspace_id_by_slug('harmony') is not null,
  (select count(*) from proj_hub_gestao.projects))
from pg_roles r where r.rolname = current_user;
SQL
}

step_publicador() {
  [[ -f "$DEPLOY_KEY_FILE" ]] || fail "falta $DEPLOY_KEY_FILE"
  local key
  key="$(tr -d '\r' < "$DEPLOY_KEY_FILE")"
  [[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+\ [a-z0-9-]+$ ]] || fail "chave pública inválida"

  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$DEPLOY_USER"
    log "publicador: usuário $DEPLOY_USER criado (sem senha)."
  fi
  passwd --lock "$DEPLOY_USER" >/dev/null

  local home
  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
  printf 'restrict,command="%s/bin/hub-deploy-ssh.sh" %s\n' "$ROOT_DIR" "$key" > "$home/.ssh/authorized_keys.new"
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh/authorized_keys.new" "$home/.ssh/authorized_keys"
  rm -f "$home/.ssh/authorized_keys.new"
  log "publicador: chave restrita ao comando de publicação instalada."

  local sudoers_tmp
  sudoers_tmp="$(mktemp)"
  printf '%s ALL=(root) NOPASSWD: %s/bin/hub-deploy.sh *\n' "$DEPLOY_USER" "$ROOT_DIR" > "$sudoers_tmp"
  visudo -cf "$sudoers_tmp" >/dev/null || { rm -f "$sudoers_tmp"; fail "regra de sudo inválida"; }
  install -m 0440 -o root -g root "$sudoers_tmp" "$SUDOERS_FILE"
  rm -f "$sudoers_tmp"
  log "publicador: sudo liberado só para $ROOT_DIR/bin/hub-deploy.sh."

  if grep -Eq "^AllowUsers .*\\b${DEPLOY_USER}\\b" "$SSHD_FILE"; then
    log "publicador: $DEPLOY_USER já está liberado no SSH."
  else
    grep -Eq '^AllowUsers ' "$SSHD_FILE" || fail "linha AllowUsers não encontrada em $SSHD_FILE"
    cp -p "$SSHD_FILE" "$SSHD_FILE.bak-hub-$STAMP"
    sed -i -E "s/^(AllowUsers .*)$/\\1 ${DEPLOY_USER}/" "$SSHD_FILE"
    if ! sshd -t; then
      cp -p "$SSHD_FILE.bak-hub-$STAMP" "$SSHD_FILE"
      fail "configuração do SSH inválida; arquivo anterior restaurado"
    fi
    systemctl reload ssh
    log "publicador: $DEPLOY_USER liberado no SSH (cópia anterior: $SSHD_FILE.bak-hub-$STAMP)."
  fi
}

step_rede() {
  if docker network inspect hub_proxy >/dev/null 2>&1; then
    log "rede: hub_proxy já existe."
  else
    docker network create --driver overlay --attachable hub_proxy >/dev/null
    log "rede: hub_proxy criada (overlay, attachable)."
  fi
}

step_agenda() {
  install -m 0644 -o root -g root \
    "$CONFIG_DIR/systemd/hub-cron.service" "$CONFIG_DIR/systemd/hub-cron.timer" \
    "$CONFIG_DIR/systemd/hub-backup.service" "$CONFIG_DIR/systemd/hub-backup.timer" \
    /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now hub-backup.timer hub-cron.timer
  log "agenda: timers ativos (o relógio só roda quando o contêiner hub-app existir)."
  log "agenda: rodando o primeiro backup."
  if ! systemctl start hub-backup.service; then
    journalctl -u hub-backup.service -n 20 --no-pager -o cat
    fail "o primeiro backup falhou"
  fi
  journalctl -u hub-backup.service -n 5 --no-pager -o cat
  ls -la "$ROOT_DIR/backups"
}

check_site() {
  local url="$1" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)"
  log "traefik: $url respondeu $code."
}

step_traefik() {
  docker network inspect hub_proxy >/dev/null 2>&1 || fail "rode a etapa rede antes"
  local net_id attached
  net_id="$(docker network inspect hub_proxy --format '{{.Id}}')"
  attached="$(docker service inspect "$TRAEFIK_SERVICE" --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}')"
  if [[ " $attached " == *" $net_id "* ]]; then
    log "traefik: já ligado à rede hub_proxy."
    return 0
  fi
  log "traefik: ligando a rede hub_proxy. O Traefik reinicia agora (alguns segundos fora do ar)."
  if ! docker service update --detach=false --quiet --network-add hub_proxy "$TRAEFIK_SERVICE"; then
    log "traefik: a atualização falhou; voltando à configuração anterior."
    docker service rollback --detach=false --quiet "$TRAEFIK_SERVICE" || true
    fail "Traefik restaurado sem a rede hub_proxy"
  fi
  sleep 5
  check_site https://app.certato.com.br/api/health
  check_site https://supabase.harmonydigital.com.br/auth/v1/health
  log "traefik: ligado à rede hub_proxy."
}

step_rota() {
  local resolved
  resolved="$(getent ahostsv4 "$HUB_HOST" | awk 'NR==1 {print $1}')"
  [[ "$resolved" == "$VPS_IP" ]] || fail "o DNS de $HUB_HOST ainda não aponta para $VPS_IP (resolveu: ${resolved:-nada})"
  install -m 0644 -o root -g root "$CONFIG_DIR/hub-traefik.yaml" "$TRAEFIK_ROUTE"
  log "rota: $TRAEFIK_ROUTE instalada; aguardando o certificado."
  local attempt
  for attempt in $(seq 1 24); do
    if curl -s -o /dev/null --max-time 10 "https://$HUB_HOST/"; then
      log "rota: HTTPS válido em https://$HUB_HOST."
      return 0
    fi
    sleep 5
  done
  log "rota: o certificado ainda não ficou pronto; o Traefik continua tentando sozinho."
}

main() {
  [[ $EUID -eq 0 ]] || fail "rode como root (sudo)"
  [[ -f "$ENV_FILE" ]] || fail "falta $ENV_FILE"
  case "${1:-}" in
    banco) step_banco ;;
    publicador) step_publicador ;;
    rede) step_rede ;;
    agenda) step_agenda ;;
    traefik) step_traefik ;;
    rota) step_rota ;;
    preparar) step_banco; step_publicador; step_rede; step_agenda ;;
    *) sed -n '2,17p' "$0"; exit 64 ;;
  esac
}

main "$@"
