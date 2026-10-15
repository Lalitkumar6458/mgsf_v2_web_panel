#!/usr/bin/env bash
# Nightly database backup (cron).  Keeps 14 days in ./backups.
#   0 2 * * *  bash /opt/mgsf_v2/scripts/backup.sh >> /opt/mgsf_v2/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
[ -n "$URL" ] || { echo "✖ DATABASE_URL not found in .env"; exit 1; }
f="backups/mgsf-$(date +%F).sql.gz"
pg_dump --no-owner --no-privileges "$URL" | gzip > "$f"
echo "$(date '+%F %T') backup $f ($(du -h "$f" | cut -f1))"
find backups -name 'mgsf-*.sql.gz' -mtime +14 -delete
