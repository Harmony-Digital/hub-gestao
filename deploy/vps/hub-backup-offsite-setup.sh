#!/usr/bin/env bash
# Hub de Gestão · liga a cópia diária do backup no Google Drive (decisão D8, 2026-10-11).
# O próprio Fábio roda no Mac, uma vez, com o botão Rodar. Faz, em ordem, e para no
# primeiro erro:
#   1. Confere o rclone no Mac (instala pelo Homebrew se faltar).
#   2. Abre o navegador para o Fábio autorizar o rclone no Google Drive da Harmony, só com
#      acesso aos arquivos que o próprio rclone criar (escopo drive.file).
#   3. Senha das cópias: reaproveita a do Keychain do Mac (serviço hub-gestao-backup,
#      conta senha-da-copia) ou gera uma nova e guarda lá. Sem ela, nenhuma cópia abre: o
#      Keychain é o lugar dela fora da VPS. Ela nunca aparece na tela.
#   4. Na VPS: instala o rclone (pacote do Ubuntu), grava a autorização do Drive e a senha
#      em /opt/hub-gestao/shared (root, 0600), instala o hub-backup-offsite.sh e o timer
#      diário (06:45 UTC) e atualiza o hub-backup.sh (a limpeza do temporário quando o
#      dump falha), mostrando a diferença.
#   5. Envia a primeira cópia, confere a volta (baixa, decifra e o dump abre) e a idade.
# Rodar de novo renova a autorização do Drive e mantém a senha: as cópias antigas
# continuam abrindo. Se a VPS já tiver outra senha, para sem trocar nada.
set -euo pipefail

readonly KEYCHAIN_SERVICE=hub-gestao-backup
readonly KEYCHAIN_ACCOUNT=senha-da-copia
readonly SHARED=/opt/hub-gestao/shared
here="$(cd "$(dirname "$0")" && pwd)"

echo "1/5 Conferindo o rclone no Mac."
if ! command -v rclone >/dev/null 2>&1; then
  echo "    Instalando o rclone pelo Homebrew."
  brew install rclone
fi

echo "2/5 Autorizando o Google Drive. O navegador vai abrir: entre com a conta Google da Harmony e permita."
# Só o escopo drive.file (o rclone enxerga apenas o que ele mesmo criar). O segundo
# argumento é o JSON das opções em base64 sem "=", o formato que o rclone lê.
blob="$(printf '%s' '{"scope":"drive.file"}' | base64 | tr -d '=\n')"
saida="$(rclone authorize drive "$blob")"
token="$(printf '%s\n' "$saida" | sed -n '/--->/,/<---End paste/p' | sed '1d;$d' | tr -d '[:space:]' |
  python3 -c '
import base64, json, sys
s = sys.stdin.read().strip()
s += "=" * (-len(s) % 4)
token = json.loads(base64.b64decode(s))["token"]
if not json.loads(token).get("refresh_token"):
    sys.exit("A autorização do Drive veio sem refresh_token.")
print(token)
')"
unset saida
echo "    Autorização recebida."

echo "3/5 Senha das cópias (Keychain do Mac)."
# A senha da VPS, se já existir, manda: as cópias antigas só abrem com ela. Compara só o
# resumo (sha256), nunca o valor.
vazio="$(printf '' | shasum -a 256 | cut -d' ' -f1)"
remote_hash="$(ssh vps-harmony "sudo cat $SHARED/backup-passphrase 2>/dev/null | sha256sum | cut -d' ' -f1")"
if senha="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null)"; then
  echo "    Reaproveitando a senha que já está no Keychain."
elif [[ "$remote_hash" != "$vazio" ]]; then
  echo "A VPS já tem uma senha de cópia e o Keychain não. Não gerei outra nem mudei nada:" >&2
  echo "primeiro traga a senha da VPS para o Keychain (docs/operacao.md, Cópia no Google Drive)." >&2
  exit 1
else
  senha="$(openssl rand -base64 48 | tr -d '\n=+/')"
  # Pela entrada do security (modo interativo), para a senha não ir para a linha de comando.
  printf 'add-generic-password -s %s -a %s -l %s -w %s\n' \
    "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT" "$KEYCHAIN_SERVICE" "$senha" | security -i >/dev/null
  if [[ "$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w)" != "$senha" ]]; then
    echo "Não consegui guardar a senha no Keychain; nada foi mudado na VPS." >&2
    exit 1
  fi
  echo "    Senha nova guardada no Keychain (serviço ${KEYCHAIN_SERVICE})."
fi
local_hash="$(printf '%s' "$senha" | shasum -a 256 | cut -d' ' -f1)"
if [[ "$remote_hash" != "$vazio" && "$remote_hash" != "$local_hash" ]]; then
  echo "A senha da VPS é diferente da do Keychain. Não troquei nada: as cópias antigas só abrem" >&2
  echo "com a senha da VPS (docs/operacao.md, Cópia no Google Drive)." >&2
  exit 1
fi

echo "4/5 Preparando a VPS."
ssh vps-harmony 'command -v rclone >/dev/null || { sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rclone >/dev/null; }'
echo "    rclone na VPS: $(ssh vps-harmony 'rclone version | head -n 1')"

printf '[hubdrive]\ntype = drive\nscope = drive.file\ntoken = %s\n' "$token" |
  ssh vps-harmony "sudo sh -c 'umask 077 && cat > $SHARED/rclone.conf.novo && mv -f $SHARED/rclone.conf.novo $SHARED/rclone.conf'"
printf '%s' "$senha" |
  ssh vps-harmony "sudo sh -c 'umask 077 && cat > $SHARED/backup-passphrase.novo && mv -f $SHARED/backup-passphrase.novo $SHARED/backup-passphrase'"
unset token senha
echo "    Autorização do Drive e senha gravadas em ${SHARED} (root, 0600)."

ssh vps-harmony 'mkdir -p ~/hub-gestao-staging'
scp -q "$here/hub-backup-offsite.sh" "$here/hub-backup.sh" \
  "$here/hub-backup-offsite.service" "$here/hub-backup-offsite.timer" \
  vps-harmony:hub-gestao-staging/
ssh vps-harmony 'sudo bash -s' <<'REMOTO'
set -euo pipefail
casa="$(getent passwd "${SUDO_USER:?rodar com sudo}" | cut -d: -f6)"
s="$casa/hub-gestao-staging"
echo "    Diferença do hub-backup.sh (ativo → novo):"
diff -u /opt/hub-gestao/bin/hub-backup.sh "$s/hub-backup.sh" | sed 's/^/      /' || true
install -m 0750 -o root -g root "$s/hub-backup.sh" /opt/hub-gestao/bin/hub-backup.sh
install -m 0750 -o root -g root "$s/hub-backup-offsite.sh" /opt/hub-gestao/bin/hub-backup-offsite.sh
install -m 0644 -o root -g root "$s/hub-backup-offsite.service" "$s/hub-backup-offsite.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hub-backup-offsite.timer >/dev/null 2>&1
echo "    Timer: $(systemctl list-timers hub-backup-offsite.timer --no-legend | head -n 1)"
REMOTO

echo "5/5 Primeira cópia e conferência da volta."
ssh vps-harmony 'sudo bash -s' <<'REMOTO'
set -euo pipefail
if ! systemctl start hub-backup-offsite.service; then
  journalctl -u hub-backup-offsite.service -n 20 --no-pager -o cat
  exit 1
fi
journalctl -u hub-backup-offsite.service -n 3 --no-pager -o cat
/opt/hub-gestao/bin/hub-backup-offsite.sh --testar-volta
/opt/hub-gestao/bin/hub-backup-offsite.sh --conferir
REMOTO
echo "Pronto: a cópia diária do backup vai cifrada para a pasta hub-gestao-backups do Google Drive."
echo "A senha que abre as cópias está no Keychain do Mac (serviço ${KEYCHAIN_SERVICE})."
