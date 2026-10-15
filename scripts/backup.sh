#!/usr/bin/env bash
# Database + uploads backup. Run as the app user (mgsf).
#   cron, nightly:   0 2 * * *  bash /opt/mgsf_v2/scripts/backup.sh >> /opt/mgsf_v2/backups/backup.log 2>&1
#   deploy.sh runs:  bash scripts/backup.sh predeploy      (before every migration)
#   by hand:         bash scripts/backup.sh manual
#
# Every dump is CHECKED before it counts: written to *.part, gzip test, must end with pg_dump's
# "dump complete" line, then renamed. A half-written file never looks like a good backup.
#
# Kept:   backups/db/       nightly 14 days · 1st of each month 12 months · predeploy/manual newest 10
#         backups/uploads/  photos, documents, certificate frames — weekly (Sunday) + first run, newest 4
# Status: backups/last-backup.txt (OK / FAILED + time) — check it, or `tail backups/backup.log`.
# Off-server copy (optional): BACKUP_RCLONE_REMOTE=gdrive:mgsf-backups in .env + `rclone config` done
# as the mgsf user → every run also copies new files there.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LABEL="${1:-nightly}"
case "$LABEL" in nightly|predeploy|manual|prerestore) ;; *) echo "usage: backup.sh [nightly|predeploy|manual|prerestore]"; exit 2 ;; esac

B="$ROOT/backups"
mkdir -p "$B/db" "$B/uploads"
STATUS="$B/last-backup.txt"
now() { date '+%F %T'; }
fail() { echo "$(now) ✖ backup FAILED ($LABEL): $*"; echo "FAILED $(now) $LABEL: $*" > "$STATUS"; exit 1; }

# one backup at a time (cron + a deploy at the same moment)
exec 9>"$B/.lock"
flock -w 600 9 || fail "another backup is still running"

envval() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
URL="$(envval DATABASE_URL)"
[ -n "$URL" ] || fail "DATABASE_URL not found in .env"
command -v pg_dump >/dev/null || fail "pg_dump not installed (dnf -y install postgresql)"

# old layout (backups/mgsf-*.sql.gz) → backups/db/
for old in "$B"/mgsf-*.sql.gz; do [ -e "$old" ] && mv "$old" "$B/db/"; done

# ── database ────────────────────────────────────────────────────────────────
stamp="$(date +%F_%H%M)"
name="mgsf-${stamp}"; [ "$LABEL" != "nightly" ] && name="${name}_${LABEL}"
f="$B/db/${name}.sql.gz"
tmp="$f.part"
rm -f "$B"/db/*.part

# enough disk? need ~2× the last dump, at least 200 MB
last="$({ ls -t "$B"/db/mgsf-*.sql.gz 2>/dev/null || true; } | head -1)"
need=$(( ${last:+$(du -k "$last" | cut -f1)} + 0 )); need=$(( need * 2 )); [ "$need" -lt 204800 ] && need=204800
free=$(df -Pk "$B" | awk 'NR==2 {print $4}')
[ "$free" -gt "$need" ] || fail "disk almost full ($(( free / 1024 )) MB free) — delete old files in backups/ or upgrade disk"

pg_dump --no-owner --no-privileges --encoding=UTF8 "$URL" | gzip -6 > "$tmp" || { rm -f "$tmp"; fail "pg_dump error (database down? wrong password in .env?)"; }
gzip -t "$tmp" || { rm -f "$tmp"; fail "gzip file is corrupt"; }
[ "$(zcat "$tmp" | tail -n 10 | grep -c 'PostgreSQL database dump complete' || true)" -ge 1 ] || { rm -f "$tmp"; fail "dump is incomplete"; }
mv "$tmp" "$f"

counts="$(psql "$URL" -Atqc "SELECT 'members=' || (SELECT count(*) FROM members) || ' payments=' || (SELECT count(*) FROM transactions) || ' closings=' || (SELECT count(*) FROM members WHERE closing_date IS NOT NULL)" 2>/dev/null || echo "counts n/a")"
echo "$(now) ✔ db backup ($LABEL) $(basename "$f") $(du -h "$f" | cut -f1) · $counts"

# ── uploads (photos, documents, certificate frames) ─────────────────────────
UP="$(envval UPLOAD_DIR)"; UP="${UP:-./uploads}"; [[ "$UP" = /* ]] || UP="$ROOT/${UP#./}"
if [ -d "$UP" ] && { [ "$(date +%u)" = "7" ] || ! ls "$B"/uploads/uploads-*.tar.gz >/dev/null 2>&1; }; then
  u="$B/uploads/uploads-$(date +%F).tar.gz"
  if tar -czf "$u.part" -C "$(dirname "$UP")" "$(basename "$UP")" && gzip -t "$u.part"; then
    mv "$u.part" "$u"; echo "$(now) ✔ uploads backup $(basename "$u") $(du -h "$u" | cut -f1)"
  else
    rm -f "$u.part"; echo "$(now) ⚠ uploads backup failed (database backup is fine)"
  fi
fi

# ── keep / delete ───────────────────────────────────────────────────────────
# nightly: 14 days, except the 1st of a month (kept 400 days)
find "$B/db" -name 'mgsf-*.sql.gz' ! -name '*_*_*' -mtime +14 ! -name 'mgsf-????-??-01_*' -delete
find "$B/db" -name 'mgsf-????-??-01_*.sql.gz' -mtime +400 -delete
# predeploy / manual / prerestore: newest 10 of each
for l in predeploy manual prerestore; do
  { ls -t "$B"/db/mgsf-*_"$l".sql.gz 2>/dev/null || true; } | tail -n +11 | xargs -r rm -f
done
{ ls -t "$B"/uploads/uploads-*.tar.gz 2>/dev/null || true; } | tail -n +5 | xargs -r rm -f
# old-layout daily files (mgsf-YYYY-MM-DD.sql.gz) age out after 14 days too
find "$B/db" -regex '.*/mgsf-[0-9-]*\.sql\.gz' -mtime +14 -delete

# ── optional off-server copy ────────────────────────────────────────────────
REMOTE="$(envval BACKUP_RCLONE_REMOTE)"
if [ -n "$REMOTE" ]; then
  if command -v rclone >/dev/null && rclone copy "$B/db" "$REMOTE/db" --max-age 3d --quiet && rclone copy "$B/uploads" "$REMOTE/uploads" --max-age 8d --quiet; then
    echo "$(now) ✔ copied to $REMOTE"
  else
    echo "OK-LOCAL $(now) $LABEL $(basename "$f") — off-server copy to $REMOTE FAILED" > "$STATUS"
    echo "$(now) ⚠ off-server copy to $REMOTE failed (local backup is fine)"; exit 0
  fi
fi

echo "OK $(now) $LABEL $(basename "$f") $counts" > "$STATUS"
