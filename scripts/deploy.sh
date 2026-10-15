#!/usr/bin/env bash
# One-command update on the server (no Docker):  bash scripts/deploy.sh
#   git pull → npm ci → build → database migrations → restart the app service
# Run as the app user (mgsf) from the project folder. The service restart uses sudo (see DEPLOY-ALMALINUX.md).
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
SERVICE="${SERVICE:-mgsf}"

echo "▶ $(date '+%F %T')  deploying in $APP_DIR"
[ -f .env ] || { echo "✖ .env missing in $APP_DIR"; exit 1; }

if [ -d .git ] && [ "${SKIP_PULL:-0}" != "1" ]; then
  echo "▶ git pull"
  git pull --ff-only
fi

echo "▶ npm ci"
npm ci --no-audit --no-fund

echo "▶ build"
NEXT_TELEMETRY_DISABLED=1 npm run build          # also bundles workers/ (prebuild)

echo "▶ prepare release"
# the running app uses .release/ (a copy), so the build above never breaks the live site
STANDALONE=.next/standalone
cp -r .next/static "$STANDALONE/.next/"
[ -d public ] && cp -r public "$STANDALONE/"
rm -rf "$STANDALONE/workers" && cp -r workers "$STANDALONE/workers"   # receipts PDF worker (path = cwd/workers)
rm -rf .release.new && cp -r "$STANDALONE" .release.new

echo "▶ backup before migrations"
bash scripts/backup.sh predeploy || { echo "✖ backup failed — deploy stopped, live site not touched (see message above)"; exit 1; }

echo "▶ database migrations"
node --env-file=.env scripts/db-migrate.js

echo "▶ switch release + restart $SERVICE"
rm -rf .release.old; [ -d .release ] && mv .release .release.old; mv .release.new .release
if command -v systemctl >/dev/null 2>&1 && { [ -f "/etc/systemd/system/$SERVICE.service" ] || systemctl cat "$SERVICE" >/dev/null 2>&1; }; then
  sudo systemctl restart "$SERVICE"
  sleep 4
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then
    echo "✔ deployed — app is up"
  else
    echo "✖ app did not answer on /api/health — check: sudo journalctl -u $SERVICE -n 80 --no-pager"
    exit 1
  fi
else
  echo "(no systemd service '$SERVICE' — start it with: cd .release && node server.js)"
fi
