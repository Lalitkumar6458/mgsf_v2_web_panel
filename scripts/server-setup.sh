#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────
#  MGSF — naye VPS par EK command se poora setup  (Hostinger: AlmaLinux / Rocky 8-9, Ubuntu 22/24, Debian 12)
#
#    root se:   bash server-setup.sh
#               (sawaal poochega: naam, domain … Enter = default)
#
#    bina sawaal ke:
#      bash server-setup.sh --name gsmmf --domain srv2067729.hstgr.cloud \
#           --admin-email trust@mail.com --admin-name "Trust Ka Naam" --yes
#
#  Kya karta hai (dobara chalana safe hai — jo ho chuka wo chhod deta hai, .env kabhi overwrite nahi):
#    swap + timezone → Node 22, PostgreSQL, Caddy (HTTPS), git, cron → linux user <name>
#    → code /opt/<name> (GitHub deploy key, ya isi folder ka code) → database + user (random password)
#    → .env (JWT_SECRET, CONTROL_KEY random) → systemd service <name> → HTTPS site → pehla deploy
#    → pehla admin login → roz raat ka backup
#
#  Ek server par kai trust: har ek ka alag --name aur alag domain/subdomain; port apne aap alag.
#  Purana server (mgsf, /opt/mgsf_v2) bhi isse theek ho jata hai:  --name mgsf --dir /opt/mgsf_v2
# ─────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DEFAULT="git@github.com:Lalitkumar6458/mgsf_v2_web_panel.git"
NAME="" DOMAIN="" DIR="" DB="" PORT="" REPO="$REPO_DEFAULT" BRANCH="main" YES=0
ADMIN_EMAIL="" ADMIN_NAME="" ADMIN_PASS="" SKIP_DEPLOY=0

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { # ask VAR "question" default
  local __v="$1" q="$2" d="${3:-}" a=""
  if [ "$YES" = 1 ] || { [ ! -t 0 ] && [ ! -e /dev/tty ]; }; then printf -v "$__v" '%s' "$d"; return; fi
  read -r -p "  $q${d:+ [$d]}: " a </dev/tty || true
  printf -v "$__v" '%s' "${a:-$d}"
}
rand() { openssl rand -hex "$(( ${1:-32} / 2 ))"; }   # hex only — URL mein safe

usage() { sed -n 2,20p "$0" | sed 's/^# \{0,1\}//'; exit 0; }
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-name) ADMIN_NAME="$2"; shift 2 ;;
    --admin-pass) ADMIN_PASS="$2"; shift 2 ;;
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) usage ;;
    *) die "unknown option: $1  (bash $0 --help)" ;;
  esac
done

[ "$(id -u)" = 0 ] || die "root se chalayein:  sudo bash $0"
[ -r /etc/os-release ] || die "/etc/os-release nahi mila"
# subshell mein padho — os-release apna NAME= rakhta hai jo hamare --name ko overwrite kar deta
OS_PRETTY="$(. /etc/os-release; echo "${PRETTY_NAME:-linux}")"
if command -v dnf >/dev/null 2>&1; then PM=dnf; elif command -v apt-get >/dev/null 2>&1; then PM=apt; else die "sirf AlmaLinux/Rocky (dnf) ya Ubuntu/Debian (apt) supported"; fi
SRC_DIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"   # agar script code ke andar se chali

# ── 0. sawaal ──────────────────────────────────────────────────────────────────────────────
say "Setup — $OS_PRETTY ($PM)"
HOST_FQDN="$(hostname -f 2>/dev/null || hostname)"
[ -n "$NAME" ] || ask NAME "App ka naam (chhote akshar, jaise gsmmf) — linux user, service, database sab isi naam se" "mgsf"
[[ "$NAME" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || die "naam '$NAME' galat — sirf a-z, 0-9, _ (pehla akshar letter)"
[ -n "$DIR" ] || DIR="/opt/$NAME"
[ -n "$DB" ] || DB="$NAME"
[[ "$DB" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || die "database naam '$DB' galat"
ENV_FILE="$DIR/.env"
envval() { { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
if [ -z "$DOMAIN" ]; then
  old="$(envval PUBLIC_BASE_URL)"; old="${old#https://}"; old="${old#http://}"; old="${old%%/*}"
  ask DOMAIN "Domain (DNS A record is server ke IP par ho) — Hostinger naam bhi chalega" "${old:-$HOST_FQDN}"
fi
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
[ -n "$DOMAIN" ] || die "domain chahiye"
echo "  naam=$NAME  folder=$DIR  database=$DB  domain=https://$DOMAIN"

# ── 1. system: swap, timezone, packages ────────────────────────────────────────────────────
say "System packages"
if [ "$PM" = dnf ]; then
  dnf -y -q install git curl tar nano rsync cronie sudo openssl policycoreutils-python-utils >/dev/null 2>&1 \
    || dnf -y install git curl tar nano rsync cronie sudo openssl
  systemctl enable --now crond >/dev/null 2>&1 || true
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl tar nano rsync cron sudo openssl ca-certificates gnupg >/dev/null
  systemctl enable --now cron >/dev/null 2>&1 || true
fi
ok "git, curl, cron"
timedatectl set-timezone Asia/Kolkata 2>/dev/null || true
swap_mb=$(free -m | awk '/^Swap:/{print $2}'); ram_mb=$(free -m | awk '/^Mem:/{print $2}')
if [ "${swap_mb:-0}" -lt 1000 ] && [ "${ram_mb:-0}" -lt 7000 ] && [ ! -e /swapfile ]; then
  (fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none) && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "2 GB swap (build ke liye)"
fi

# ── 2. Node 22 ─────────────────────────────────────────────────────────────────────────────
say "Node.js 22"
node_major() { node -v 2>/dev/null | sed 's/^v//; s/\..*//'; }
if [ "$(node_major || echo 0)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
  if [ "$PM" = dnf ]; then
    # AlmaLinux 10: seedha nodejs (22) · 9/8: module nodejs:22 · warna NodeSource
    dnf -y -q install nodejs npm >/dev/null 2>&1 || true
    if [ "$(node_major || echo 0)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
      { dnf -y -q module reset nodejs && dnf -y -q module enable nodejs:22 && dnf -y -q install nodejs; } >/dev/null 2>&1 || true
    fi
    if [ "$(node_major || echo 0)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
      dnf -y -q remove nodejs npm >/dev/null 2>&1 || true
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null && dnf -y -q install nodejs
    fi
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
  fi
fi
ok "node $(node -v), npm $(npm -v)"

# ── 3. PostgreSQL ──────────────────────────────────────────────────────────────────────────
say "PostgreSQL"
if ! command -v psql >/dev/null || ! systemctl list-unit-files --no-legend 2>/dev/null | grep -q '^postgresql'; then
  if [ "$PM" = dnf ]; then
    { dnf -y -q module reset postgresql && dnf -y -q module enable postgresql:16; } >/dev/null 2>&1 || true
    dnf -y -q install postgresql-server postgresql >/dev/null
  else
    apt-get install -y -qq postgresql postgresql-contrib >/dev/null
  fi
fi
if [ "$PM" = dnf ]; then
  [ -f /var/lib/pgsql/data/PG_VERSION ] || postgresql-setup --initdb >/dev/null
  HBA=/var/lib/pgsql/data/pg_hba.conf
  if grep -Eq '^host.*(ident|md5)$' "$HBA"; then sed -i -E 's/^(host.*)(ident|md5)$/\1scram-sha-256/' "$HBA"; RESTART_PG=1; fi
fi
PG_UNIT="$(systemctl list-unit-files --no-legend 'postgresql*.service' 2>/dev/null | awk '{print $1}' | grep -E '^postgresql(-[0-9]+)?\.service$' | head -1)"
PG_UNIT="${PG_UNIT:-postgresql.service}"
systemctl enable --now "$PG_UNIT" >/dev/null 2>&1
[ "${RESTART_PG:-0}" = 1 ] && systemctl restart "$PG_UNIT"
for i in $(seq 1 15); do sudo -u postgres psql -qtAc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
ok "$(sudo -u postgres psql -qtAc 'show server_version' | cut -d' ' -f1) chal raha hai"

# ── 4. Caddy (HTTPS) + firewall ────────────────────────────────────────────────────────────
say "Caddy (HTTPS) + firewall"
if ! command -v caddy >/dev/null; then
  if [ "$PM" = dnf ]; then
    { dnf -y -q install 'dnf-command(copr)' && dnf -y -q copr enable @caddy/caddy && dnf -y -q install caddy; } >/dev/null 2>&1 || true
  else
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
fi
if ! command -v caddy >/dev/null; then
  # repo nahi mila (jaise naya OS) → official binary + service khud
  case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64) ARCH=arm64 ;; *) die "caddy: CPU $(uname -m) supported nahi" ;; esac
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /usr/bin/caddy.new && chmod 755 /usr/bin/caddy.new && mv /usr/bin/caddy.new /usr/bin/caddy
  command -v restorecon >/dev/null && restorecon /usr/bin/caddy 2>/dev/null || true
  getent group caddy >/dev/null || groupadd --system caddy
  id caddy >/dev/null 2>&1 || useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
  mkdir -p /etc/caddy
  cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
fi
command -v caddy >/dev/null || die "caddy install nahi hua"
ok "caddy $(caddy version 2>/dev/null | cut -d' ' -f1)"
if command -v getenforce >/dev/null && [ "$(getenforce)" = Enforcing ]; then setsebool -P httpd_can_network_connect 1 && ok "SELinux: proxy allowed"; fi
if systemctl is-active -q firewalld 2>/dev/null; then
  firewall-cmd -q --permanent --add-service=http --add-service=https --add-service=ssh && firewall-cmd -q --reload && ok "firewalld: 80/443 khule"
elif command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ok "ufw: 80/443 khule"
fi

# ── 5. user + code ─────────────────────────────────────────────────────────────────────────
say "User '$NAME' + code in $DIR"
id "$NAME" >/dev/null 2>&1 || { useradd -m -s /bin/bash "$NAME"; ok "user bana"; }
UHOME="$(getent passwd "$NAME" | cut -d: -f6)"
as_app() { sudo -u "$NAME" -H bash -lc "$*"; }
mkdir -p "$DIR"; chown "$NAME:$NAME" "$DIR"

if [ -f "$DIR/package.json" ]; then
  ok "code pehle se hai"
elif [ -n "$SRC_DIR" ] && [ -f "$SRC_DIR/package.json" ] && grep -q '"name"' "$SRC_DIR/package.json" && [ "$SRC_DIR" != "$DIR" ]; then
  # script code ke folder ke andar se chali (WinSCP / zip se upload) → wahi code copy
  rsync -a --exclude node_modules --exclude .next --exclude .release --exclude .release.new --exclude .release.old \
    --exclude .env --exclude backups --exclude data "$SRC_DIR/" "$DIR/"
  chown -R "$NAME:$NAME" "$DIR"
  ok "code $SRC_DIR se copy hua"
else
  KEY="$UHOME/.ssh/id_ed25519"
  [ -f "$KEY" ] || as_app "mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -q -t ed25519 -N '' -C '$NAME@$DOMAIN' -f ~/.ssh/id_ed25519"
  as_app "ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts"
  until as_app "git ls-remote -q '$REPO' >/dev/null 2>&1"; do
    echo
    echo "  ┌ GitHub par ye key daalein (ek baar):  repo → Settings → Deploy keys → Add deploy key"
    echo "  │ Title: $NAME@$DOMAIN    'Allow write access' OFF"
    echo "  └ Key:"
    echo
    cat "$KEY.pub"
    echo
    [ "$YES" = 1 ] && die "deploy key add karke dobara chalayein"
    read -r -p "  Key add kar di? Enter dabayein (ya 'q' band karne ke liye): " a </dev/tty || true
    [ "${a:-}" = q ] && exit 1
  done
  [ -z "$(ls -A "$DIR")" ] || die "$DIR khaali nahi hai aur usme code (package.json) nahi — folder check karein"
  as_app "git clone -q -b '$BRANCH' '$REPO' '$DIR'"
  ok "GitHub se clone hua ($BRANCH)"
fi
as_app "mkdir -p '$DIR/data/uploads' '$DIR/backups'"

# ── 6. database + .env ─────────────────────────────────────────────────────────────────────
say "Database '$DB' + .env"
psqlc() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAc "$1"; }
if [ -f "$ENV_FILE" ]; then
  ok ".env pehle se hai — values nahi badli (sirf APP_NAME / PORT ki line na ho to judti hai)"
  URL="$(envval DATABASE_URL)"
  rest="${URL#*://}"; creds="${rest%@*}"; DB_USER="${creds%%:*}"; DB_PASS="${creds#*:}"
  DB="$(echo "${URL##*/}" | cut -d'?' -f1)"
  case "$DB_PASS" in *[@:/?#]*)
    die "DATABASE_URL ke password mein @ : / ? # hai — backup (pg_dump) aur deploy fail honge.
   Theek karein (root se), phir ye script dobara chalayein:
     sudo -u postgres psql -c \"ALTER USER $DB_USER PASSWORD 'SirfLettersNumbers123';\"
     nano $ENV_FILE      # DATABASE_URL=postgresql://$DB_USER:SirfLettersNumbers123@127.0.0.1:5432/$DB
   (ya password wahi rakhein aur .env mein @ ki jagah %40 likhein)" ;; esac
  grep -q '^APP_NAME=' "$ENV_FILE" || echo "APP_NAME=$NAME" >> "$ENV_FILE"
  P_OLD="$(envval PORT)"; [ -n "$PORT" ] || PORT="$P_OLD"
else
  DB_USER="$NAME"; DB_PASS="$(rand 32)"
fi

# port: .env → flag → 3000, 3001 … jo khali ho (dusre app ka bhi nahi)
used_ports() { ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://'; grep -hoE '^(Environment=)?PORT=[0-9]+' /etc/systemd/system/*.service /opt/*/.env 2>/dev/null | sed 's/.*=//'; }
if [ -z "$PORT" ]; then
  if [ -f "/etc/systemd/system/$NAME.service" ]; then PORT="$(grep -oE 'PORT=[0-9]+' "/etc/systemd/system/$NAME.service" | head -1 | cut -d= -f2)"; fi
  if [ -z "$PORT" ]; then PORT=3000; while used_ports | grep -qx "$PORT"; do PORT=$((PORT+1)); done; fi
fi

[ -f "$ENV_FILE" ] && ! grep -q '^PORT=' "$ENV_FILE" && echo "PORT=$PORT" >> "$ENV_FILE"   # deploy.sh / restore.sh isse padhte hain
if [ "$(psqlc "select 1 from pg_roles where rolname='$DB_USER'")" != 1 ]; then
  psqlc "create role \"$DB_USER\" login password '$DB_PASS'"; ok "db user $DB_USER bana"
elif [ ! -f "$ENV_FILE" ]; then
  psqlc "alter role \"$DB_USER\" password '$DB_PASS'"; ok "db user $DB_USER ka naya password"
fi
if [ "$(psqlc "select 1 from pg_database where datname='$DB'")" != 1 ]; then
  psqlc "create database \"$DB\" owner \"$DB_USER\""; ok "database $DB bana"
fi

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
# bana: server-setup.sh $(date '+%F %T') — ye file GitHub par kabhi nahi jaati
APP_NAME=$NAME
PORT=$PORT
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB
DB_POOL_MAX=10
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
ADMIN_LOGIN_OTP=0
# /feature-control page ki secret key (sirf developer ke paas)
CONTROL_KEY=$(rand 24)
STORAGE=local
UPLOAD_DIR=$DIR/data/uploads
PUBLIC_BASE_URL=https://$DOMAIN
UPLOAD_MAX_MB=8
# e-mail (OTP, receipts) — Gmail app password daalein, phir: systemctl restart $NAME
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Trust <no-reply@$DOMAIN>"
EXPO_ACCESS_TOKEN=
EOF
  umask 022
  ok ".env bana (random DB password, JWT_SECRET, CONTROL_KEY)"
fi
chown "$NAME:$NAME" "$ENV_FILE"; chmod 600 "$ENV_FILE"
# is app ke liye password login pakka karo: pg_hba.conf mein sabse upar apni 2 line (pehli matching line jeetti hai)
HBA_FILE="$(psqlc 'show hba_file')"
if [ -n "$HBA_FILE" ] && ! grep -qE "^host\s+$DB\s+$DB_USER\s+127\.0\.0\.1/32\s+scram-sha-256" "$HBA_FILE"; then
  cp "$HBA_FILE" "$HBA_FILE.bak.$(date +%s)"
  { printf '# %s (server-setup.sh)\nhost    %s    %s    127.0.0.1/32    scram-sha-256\nhost    %s    %s    ::1/128    scram-sha-256\n' "$NAME" "$DB" "$DB_USER" "$DB" "$DB_USER"; cat "$HBA_FILE"; } > "$HBA_FILE.new"
  chown --reference="$HBA_FILE" "$HBA_FILE.new"; chmod --reference="$HBA_FILE" "$HBA_FILE.new"; mv "$HBA_FILE.new" "$HBA_FILE"
  command -v restorecon >/dev/null && restorecon "$HBA_FILE" 2>/dev/null || true
  psqlc 'select pg_reload_conf()' >/dev/null
  sleep 1
  ok "pg_hba.conf: $DB_USER ka password login on"
fi
PSQL_ERR="$(cd /tmp && sudo -u "$NAME" psql "$(envval DATABASE_URL)" -qtAc 'select 1' 2>&1 >/dev/null)" && ok "app user database se jud gaya" \
  || die "DATABASE_URL se login nahi hua:
   $PSQL_ERR
   ($ENV_FILE ka DATABASE_URL, aur: grep -v '^#' $HBA_FILE | grep .)"

# ── 7. systemd service + sudo ──────────────────────────────────────────────────────────────
say "Service '$NAME' (port $PORT)"
NODE_BIN="$(command -v node)"; SYSTEMCTL="$(command -v systemctl)"
cat > "/etc/systemd/system/$NAME.service" <<EOF
# bana: server-setup.sh — MGSF trust panel ($DOMAIN)
[Unit]
Description=MGSF panel $NAME ($DOMAIN)
After=network.target $PG_UNIT
Wants=$PG_UNIT

[Service]
Type=simple
User=$NAME
Group=$NAME
WorkingDirectory=$DIR/.release
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=NODE_OPTIONS=--max-old-space-size=1536
EnvironmentFile=$ENV_FILE
Environment=PORT=$PORT
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
SUD="/etc/sudoers.d/$NAME"
echo "$NAME ALL=(root) NOPASSWD: $SYSTEMCTL restart $NAME, $SYSTEMCTL status $NAME, $SYSTEMCTL start $NAME, $SYSTEMCTL stop $NAME" > "$SUD.tmp"
chmod 440 "$SUD.tmp"
visudo -cqf "$SUD.tmp" || { rm -f "$SUD.tmp"; die "sudoers line galat: $SUD"; }
mv "$SUD.tmp" "$SUD"
sudo -u "$NAME" sudo -n -l "$SYSTEMCTL" restart "$NAME" >/dev/null 2>&1 || die "$NAME ko service restart ki permission nahi mili ($SUD) — sudo -l -U $NAME dekhein"
ok "sudo: $NAME apni service restart kar sakta hai (bina password)"
systemctl daemon-reload && systemctl enable -q "$NAME"
ok "systemd: $NAME.service"

# ── 8. HTTPS site ──────────────────────────────────────────────────────────────────────────
say "HTTPS: https://$DOMAIN"
mkdir -p /etc/caddy/sites
CF=/etc/caddy/Caddyfile
# package wala default "Caddy works" page (:80 + /usr/share/caddy) hatao — baaki kisi site ko nahi chhedte
if [ -f "$CF" ] && grep -qE '^\s*:80\s*\{' "$CF" && grep -q '/usr/share/caddy' "$CF"; then cp "$CF" "$CF.bak.$(date +%s)"; : > "$CF"; fi
[ -f "$CF" ] || : > "$CF"
grep -q 'import /etc/caddy/sites/\*.caddy' "$CF" || printf '\n# har app ki site: /etc/caddy/sites/<name>.caddy (server-setup.sh)\nimport /etc/caddy/sites/*.caddy\n' >> "$CF"
if grep -v '^\s*#' "$CF" | grep -qE "^\s*${DOMAIN//./\\.}(:443)?\s*\{"; then
  warn "$DOMAIN pehle se $CF mein hai — wahi rehne diya (port $PORT par point kare, check kar lein)"
else
  cat > "/etc/caddy/sites/$NAME.caddy" <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT {
		transport http {
			read_timeout 10m
		}
	}
}
EOF
fi
caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || die "Caddyfile mein galti: caddy validate --config $CF"
systemctl enable -q --now caddy && systemctl reload caddy
ok "caddy reload"

# ── 9. pehla deploy ────────────────────────────────────────────────────────────────────────
if [ "$SKIP_DEPLOY" = 0 ]; then
  say "Build + migrations + start (pehli baar 5-8 minute)"
  # deploy.sh khud bhi pull karta hai, lekin tab tak purani deploy.sh chal chuki hoti — isliye pehle yahan
  if [ -d "$DIR/.git" ]; then as_app "cd '$DIR' && git pull -q --ff-only" && ok "GitHub se latest code ($(as_app "cd '$DIR' && git log -1 --format='%h %s'"))"; fi
  grep -q 'APP_NAME' "$DIR/scripts/deploy.sh" || die "$DIR/scripts/deploy.sh purana hai — PC se naya code GitHub par push karein (git push), phir ye script dobara chalayein"
  as_app "cd '$DIR' && bash scripts/deploy.sh" || die "deploy fail — upar ka message dekhein; logs: journalctl -u $NAME -n 80 --no-pager"
fi

# ── 10. pehla admin ────────────────────────────────────────────────────────────────────────
accounts="$(sudo -u "$NAME" psql "$(envval DATABASE_URL)" -qtAc 'select count(*) from accounts' 2>/dev/null || echo '?')"
if [ "$accounts" = 0 ]; then
  say "Pehla admin login (khaali chhodein to baad mein)"
  [ -n "$ADMIN_EMAIL" ] || ask ADMIN_EMAIL "Admin e-mail" ""
  if [ -n "$ADMIN_EMAIL" ]; then
    [ -n "$ADMIN_NAME" ] || ask ADMIN_NAME "Trust ka naam" "Trust"
    if [ -z "$ADMIN_PASS" ]; then
      if [ "$YES" = 1 ]; then ADMIN_PASS="$(rand 12)"; SHOW_PASS=1
      else read -r -s -p "  Password (8+ akshar, Enter = random): " ADMIN_PASS </dev/tty || true; echo; [ -n "$ADMIN_PASS" ] || { ADMIN_PASS="$(rand 12)"; SHOW_PASS=1; }; fi
    fi
    printf '%s\n%s\n%s\n' "$ADMIN_EMAIL" "$ADMIN_NAME" "$ADMIN_PASS" > "$DIR/.admin.tmp"; chown "$NAME" "$DIR/.admin.tmp"; chmod 600 "$DIR/.admin.tmp"
    as_app "cd '$DIR' && { read -r e; read -r n; read -r p; } < .admin.tmp && rm -f .admin.tmp && node --env-file=.env scripts/create-account.js admin \"\$e\" \"\$n\" \"\$p\"" \
      && ok "admin bana: $ADMIN_EMAIL${SHOW_PASS:+  password: $ADMIN_PASS  (abhi likh lein)}"
    rm -f "$DIR/.admin.tmp"
  fi
fi

# ── 11. roz ka backup ──────────────────────────────────────────────────────────────────────
MIN=$(( (PORT - 3000) * 7 % 60 ))
as_app "(crontab -l 2>/dev/null | grep -v 'scripts/backup.sh'; echo '$MIN 2 * * * bash $DIR/scripts/backup.sh >> $DIR/backups/backup.log 2>&1') | crontab -"
ok "backup roz raat 2:$(printf %02d $MIN) ($DIR/backups)"

# ── done ───────────────────────────────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────
 ✔ Tayyar:  https://$DOMAIN
   (pehli baar certificate banne mein 1 minute lag sakta hai; DNS A record server IP par ho)

   Update (code push ke baad):   sudo -iu $NAME bash $DIR/scripts/deploy.sh
   Logs:                         journalctl -u $NAME -f
   Settings / secret:            $ENV_FILE   (CONTROL_KEY = /feature-control ki key)
   Backup wapas:                 bash $DIR/scripts/restore.sh --list
────────────────────────────────────────────────────────────────
EOF
