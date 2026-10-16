#!/usr/bin/env bash
# Put a database backup back. Run as ROOT (it stops/starts the app and recreates the database).
#
#   bash /opt/mgsf_v2/scripts/restore.sh --list                 backups on this server, newest first
#   bash /opt/mgsf_v2/scripts/restore.sh --test  <file.sql.gz>  restore into a TEMPORARY database, show counts,
#                                                               delete it — the live site is not touched
#   bash /opt/mgsf_v2/scripts/restore.sh <file.sql.gz>          REAL restore: safety backup of today's data first,
#                                                               app stopped, database replaced, app started
#
# <file> = a name from --list (mgsf-2026-10-15_0200.sql.gz) or a full path.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
B="$APP/backups/db"

envval() { { grep -E "^$1=" "$APP/.env" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
# server-setup.sh writes APP_NAME / PORT into .env (one name = linux user = service); old servers: mgsf / 3000
APP_NAME="$(envval APP_NAME)"
APP_USER="${APP_USER:-${APP_NAME:-mgsf}}"
SERVICE="${SERVICE:-${APP_NAME:-mgsf}}"
PORT="${PORT:-$(envval PORT)}"
URL="$(envval DATABASE_URL)"
[ -n "$URL" ] || { echo "✖ DATABASE_URL not found in $APP/.env"; exit 1; }
rest="${URL#*://}"; creds="${rest%%@*}"; DB_USER="${creds%%:*}"
DB="${URL##*/}"; DB="${DB%%\?*}"
url_for() { echo "${URL%/*}/$1"; }

list() {
  echo "Backups in $B (newest first):"
  ls -lt "$B"/*.sql.gz 2>/dev/null | awk '{printf "  %-48s %6s  %s %s %s\n", $9, $5, $6, $7, $8}' | sed "s#$B/##" || echo "  (none)"
}

[ "${1:-}" = "--list" ] && { list; exit 0; }
[ "$(id -u)" = "0" ] || { echo "✖ run as root:  bash $0 $*"; exit 1; }

MODE=real
[ "${1:-}" = "--test" ] && { MODE=test; shift; }
FILE="${1:-}"
[ -n "$FILE" ] || { echo "usage: restore.sh --list | --test <file> | <file>"; list; exit 2; }
[ -f "$FILE" ] || FILE="$B/$FILE"
[ -f "$FILE" ] || { echo "✖ file not found: $1"; list; exit 1; }

echo "▶ checking $(basename "$FILE")"
gzip -t "$FILE" || { echo "✖ file is corrupt"; exit 1; }
[ "$(zcat "$FILE" | tail -n 10 | grep -c 'PostgreSQL database dump complete' || true)" -ge 1 ] || { echo "✖ dump is incomplete — choose another file"; exit 1; }

load() { # $1 = database name
  zcat "$FILE" | psql "$(url_for "$1")" -q -v ON_ERROR_STOP=1 -o /dev/null
}
counts() {
  psql "$(url_for "$1")" -Atqc "SELECT 'members ' || (SELECT count(*) FROM members) || ' · payments ' || (SELECT count(*) FROM transactions) || ' · agents ' || (SELECT count(*) FROM agents) || ' · yojna ' || (SELECT count(*) FROM programs)"
}

if [ "$MODE" = test ]; then
  T="${DB}_restore_test"
  sudo -u postgres dropdb --if-exists "$T"
  sudo -u postgres createdb -O "$DB_USER" "$T"
  trap 'sudo -u postgres dropdb --if-exists "$T"' EXIT
  echo "▶ restoring into temporary database $T"
  load "$T"
  echo "✔ backup is good — it holds: $(counts "$T")"
  echo "  live database now:        $(counts "$DB")"
  exit 0
fi

echo
echo "  This REPLACES the live database '$DB' with $(basename "$FILE")."
echo "  Live now:    $(counts "$DB" 2>/dev/null || echo '?')"
echo "  Everything entered after that backup is lost (a safety backup is taken first)."
read -r -p "  Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "cancelled"; exit 1; }

echo "▶ safety backup of the current data"
sudo -u "$APP_USER" bash "$APP/scripts/backup.sh" prerestore
SAFE="$(ls -t "$B"/*_prerestore.sql.gz | head -1)"

echo "▶ stopping $SERVICE"
systemctl stop "$SERVICE"
trap 'echo "✖ restore failed — the app is stopped. Put the safety backup back with:  bash $0 $(basename "$SAFE")"' ERR

echo "▶ recreating database $DB"
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);"
sudo -u postgres createdb -O "$DB_USER" "$DB"
echo "▶ loading $(basename "$FILE")"
load "$DB"
trap - ERR

echo "▶ migrations (an older backup may need newer tables)"
sudo -u "$APP_USER" bash -c "cd '$APP' && node --env-file=.env scripts/db-migrate.js"

echo "▶ starting $SERVICE"
systemctl start "$SERVICE"
sleep 4
curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null && echo "✔ restored — $(counts "$DB")" \
  || echo "⚠ restored, but the app did not answer yet: journalctl -u $SERVICE -n 50 --no-pager"
echo "  safety backup of the data before restore: $(basename "$SAFE")"
