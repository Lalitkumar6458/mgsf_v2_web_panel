# Bina Docker ke deploy — Hostinger VPS (AlmaLinux 9) + GitHub

Server: **AlmaLinux 9, KVM 1 (4 GB RAM)**, IP `89.116.33.200`.
Server par chalega: **Node 22** (app) · **PostgreSQL 16** (database) · **Caddy** (HTTPS) · **systemd** (app hamesha chalu) · **cron** (roz backup).
Update ka tarika: **GitHub par push → server par ek command** (`bash scripts/deploy.sh`), ya GitHub Actions se apne aap.

> Commands `#` wale blocks ek-ek karke copy-paste karein. `CHANGE_ME` wali jagah apni value daalein.

---

## 0. Code GitHub par (aapke PC se, ek baar)

Repo: `https://github.com/Lalitkumar6458/mgsf_v2_web_panel` — GitHub → repo → Settings → (neeche) **Change visibility → Private** kar dein (trust ka code public na rahe). PC par `mgsf_v2` folder mein:

```bash
git init
git add .
git commit -m "MGSF v2"
git branch -M main
git remote add origin https://github.com/Lalitkumar6458/mgsf_v2_web_panel.git
git push -u origin main
```

Pehle ek kaam: `.github/workflows/deploy.yml` file (chat mein bheji hai) haath se `mgsf_v2\.github\workflows\` folder mein rakh dein — auto-deploy ke liye (optional).

`.env`, `node_modules`, `.next`, `uploads`, `firebase-service-account.json` push **nahi** honge (`.gitignore` mein hain). Push ke baad GitHub par dekh lein ki `src/workers/receiptWorker.js` dikh raha hai.

## 1. Server par login

PowerShell:

```bash
ssh root@89.116.33.200
```

## 2. Basic setup + swap (4 GB RAM par build ke liye zaroori)

```bash
dnf -y update
dnf -y install git curl tar nano policycoreutils-python-utils
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
timedatectl set-timezone Asia/Kolkata
```

## 3. Node.js 22

```bash
dnf -y module reset nodejs
dnf -y module enable nodejs:22
dnf -y install nodejs
node -v        # v22.x dikhna chahiye
```

`nodejs:22` na mile to: `curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && dnf -y install nodejs`

## 4. PostgreSQL 16

```bash
dnf -y module reset postgresql
dnf -y module enable postgresql:16
dnf -y install postgresql-server postgresql
postgresql-setup --initdb
sed -i 's/ident$/scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf
systemctl enable --now postgresql
```

Database aur user (password mein sirf letters + numbers rakhein — URL mein aata hai):

```bash
sudo -u postgres psql -c "CREATE USER mgsf WITH PASSWORD 'CHANGE_ME_DB_PASS';" -c "CREATE DATABASE mgsf OWNER mgsf;"
```

## 5. Caddy (HTTPS) + firewall

```bash
dnf -y install 'dnf-command(copr)'
dnf -y copr enable @caddy/caddy
dnf -y install caddy
setsebool -P httpd_can_network_connect 1
firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload
```

(`firewall-cmd` "not running" bole to chhod dein; hPanel → VPS → Firewall mein 80, 443, 22 allow karein.)

## 6. App user + code (GitHub se)

```bash
useradd -m -s /bin/bash mgsf
mkdir -p /opt/mgsf_v2 && chown mgsf:mgsf /opt/mgsf_v2
sudo -iu mgsf
```

Ab aap `mgsf` user hain. GitHub ke liye key:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Ye line copy karke GitHub → repo → **Settings → Deploy keys → Add deploy key** (Allow write **off**) mein daalein. Phir:

```bash
ssh -o StrictHostKeyChecking=accept-new -T git@github.com     # "successfully authenticated" aaye
git clone git@github.com:Lalitkumar6458/mgsf_v2_web_panel.git /opt/mgsf_v2
cd /opt/mgsf_v2
mkdir -p data/uploads backups
cp .env.example .env
nano .env
```

`.env` mein ye bharein (baaki jaisa hai rehne dein):

```ini
DATABASE_URL=postgresql://mgsf:CHANGE_ME_DB_PASS@127.0.0.1:5432/mgsf
JWT_SECRET=CHANGE_ME          # banane ke liye: openssl rand -base64 48
ADMIN_LOGIN_OTP=0             # SMTP set ho jaye tab 1 karein
STORAGE=local
UPLOAD_DIR=/opt/mgsf_v2/data/uploads
PUBLIC_BASE_URL=https://admin.yourtrust.in
SMTP_USER=aapka@gmail.com
SMTP_PASS=gmail-app-password
MAIL_FROM="Trust Name <aapka@gmail.com>"
```

Save: `Ctrl+O`, Enter, `Ctrl+X`. Phir `exit` (wapas root).

## 7. Purana data (PC wala database) — chahiye to

PC par pgAdmin → `mgsf` database → Backup → Format **Plain**, Dump options mein *Owner* aur *Privileges* off → `mgsf.sql`.
WinSCP se `mgsf.sql` aur `uploads` folder ka saaman server par `/opt/mgsf_v2/` mein daalein. Phir root se:

```bash
sudo -iu mgsf bash -c 'cd /opt/mgsf_v2 && psql "postgresql://mgsf:CHANGE_ME_DB_PASS@127.0.0.1:5432/mgsf" -f mgsf.sql && cp -r uploads/* data/uploads/ 2>/dev/null; true'
```

## 8. Service + HTTPS

```bash
cp /opt/mgsf_v2/deploy/mgsf.service /etc/systemd/system/mgsf.service
cp /opt/mgsf_v2/deploy/sudoers-mgsf /etc/sudoers.d/mgsf && chmod 440 /etc/sudoers.d/mgsf
systemctl daemon-reload && systemctl enable mgsf
cp /opt/mgsf_v2/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile        # admin.yourtrust.in ki jagah apna domain
systemctl enable --now caddy
```

**Domain:** DNS mein A record — `admin` → `89.116.33.200`.
Domain abhi nahi hai to Caddyfile mein `srv2037475.hstgr.cloud` likh dein (Hostinger ka server naam) — wo bhi HTTPS ke saath khul jayega; domain milne par badal dena (aur `.env` ka `PUBLIC_BASE_URL` bhi).

## 9. Pehla deploy

```bash
sudo -iu mgsf bash /opt/mgsf_v2/scripts/deploy.sh
```

Ye karta hai: `git pull → npm ci → build → migrations → restart`. Aakhir mein `✔ deployed — app is up` aana chahiye (pehli baar 5–8 minute).
Browser: `https://admin.yourtrust.in`

Naya install (step 7 nahi kiya) to pehla admin login:

```bash
sudo -iu mgsf bash -c 'cd /opt/mgsf_v2 && npm run create-account -- admin trust@yourmail.com "Trust Ka Naam" StrongPass123'
```

## 10. Backup (roz ka + har deploy se pehle)

```bash
sudo -iu mgsf bash -c '(crontab -l 2>/dev/null | grep -v scripts/backup.sh; echo "0 2 * * * bash /opt/mgsf_v2/scripts/backup.sh >> /opt/mgsf_v2/backups/backup.log 2>&1") | crontab -'
sudo -iu mgsf bash /opt/mgsf_v2/scripts/backup.sh manual     # abhi ek test backup
cat /opt/mgsf_v2/backups/last-backup.txt                     # OK … dikhna chahiye
bash /opt/mgsf_v2/scripts/restore.sh --test <file>           # backup sach mein wapas lag sakta hai? (live ko nahi chhuta)
```

- Har backup check hota hai (gzip test + "dump complete"); adhoori file kabhi backup nahi maani jaati.
- `backups/db/`: roz raat 2 baje (14 din) · har mahine ki 1 tarikh wala (12 mahine) · har deploy se pehle `_predeploy` (aakhri 10).
- `backups/uploads/`: photos / documents / certificate frame — har Sunday (aakhri 4).
- `deploy.sh` migration se pehle backup leta hai; backup fail = deploy ruk jaata hai, live site nahi chhuti.
- Wapas lagana (root se): `bash /opt/mgsf_v2/scripts/restore.sh --list`, phir `bash /opt/mgsf_v2/scripts/restore.sh <file>` — pehle aaj ke data ka `_prerestore` backup leta hai, `YES` likhne par hi chalta hai.
- **Server se bahar copy zaroori hai** — hafte mein ek baar WinSCP se `backups/` PC / Google Drive par, ya rclone (optional): `.env` mein `BACKUP_RCLONE_REMOTE=gdrive:mgsf-backups` + `mgsf` user se `rclone config`. hPanel VPS snapshot bhi lete rahein.

---

## Update kaise karein (har baar)

PC par code badla → `git add . && git commit -m "..." && git push`. Phir:

```bash
ssh root@89.116.33.200
sudo -iu mgsf bash /opt/mgsf_v2/scripts/deploy.sh
```

Build ke dauran purani site chalti rehti hai; sirf aakhir mein ~5 second restart.

### Apne aap deploy (GitHub Actions — optional)

Repo mein `.github/workflows/deploy.yml` hai. Ek baar setup:

1. Server par (root se):
   ```bash
   sudo -iu mgsf bash -c 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/actions && cat ~/.ssh/actions.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && cat ~/.ssh/actions'
   ```
2. Jo **private key** (BEGIN … END tak) print hui, GitHub → repo → Settings → Secrets and variables → Actions mein:
   `SSH_KEY` = wo key, `SSH_HOST` = `89.116.33.200`, `SSH_USER` = `mgsf`.

Ab har `git push` (main) par server khud update ho jayega — GitHub → Actions tab mein status dikhega.

---

## Kaam ki commands

| Kaam | Command (root se) |
|---|---|
| App ka status / logs | `systemctl status mgsf` · `journalctl -u mgsf -f` |
| App restart | `systemctl restart mgsf` |
| HTTPS / Caddy logs | `journalctl -u caddy -f` |
| Database console | `sudo -u postgres psql mgsf` |
| Backup wapas lagana | `bash /opt/mgsf_v2/scripts/restore.sh --list` · `--test <file>` · `<file>` |

## Problem aaye to

| Dikkat | Kya karein |
|---|---|
| `deploy.sh` mein build "killed" / memory | swap bana? `free -h` mein Swap 2G dikhe |
| `✖ app did not answer` | `journalctl -u mgsf -n 80 --no-pager` — aksar `.env` mein galti (DATABASE_URL / JWT_SECRET) |
| `migration failed: password authentication failed` | `.env` ka DB password step 4 wala hi hai? pg_hba mein `scram-sha-256` laga? (`systemctl restart postgresql`) |
| Site nahi khulti / certificate error | DNS A record IP par hai? `journalctl -u caddy -n 50`; 80/443 firewall mein khule? |
| 502 Bad Gateway | app band hai → `systemctl status mgsf`; SELinux: `setsebool -P httpd_can_network_connect 1` |
| Photos upload nahi | `chown -R mgsf:mgsf /opt/mgsf_v2/data` |
| `git pull` permission denied | Deploy key GitHub mein add hai? `sudo -iu mgsf ssh -T git@github.com` |
