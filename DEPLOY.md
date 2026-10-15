# Hostinger par deploy (VPS + Docker)

Ye app ek **VPS** par chalti hai: PostgreSQL + Next.js app + Caddy (HTTPS) + roz raat backup — sab `docker compose` se.
Hostinger ki shared / "Web hosting" / "Cloud hosting" plans par PostgreSQL aur background worker nahi chalte, isliye **VPS (KVM)** lena hai.

## 1. Hostinger par kya lena hai

| Cheez | Kya chunein |
|---|---|
| Plan | **KVM 2** (2 vCPU, 8 GB RAM) aaram se; chhota trust ho to KVM 1 (4 GB) bhi chalega |
| OS template | **Ubuntu 24.04 with Docker** (Docker pehle se installed aata hai) |
| Location | India (Mumbai) agar milta hai |
| Root password / SSH key | setup ke waqt set karein, sambhal ke rakhein |

VPS ban jaane ke baad hPanel → VPS → Overview mein **IP address** milega.

## 2. Domain ka DNS

Jis domain/subdomain par panel kholna hai (jaise `admin.yourtrust.in`), uske DNS mein:

| Type | Name | Value |
|---|---|---|
| A | `admin` | VPS ka IP |

Domain Hostinger ka hai to hPanel → Domains → DNS / Nameservers → DNS records. 5–30 minute mein lagta hai.

## 3. Server par login

Windows mein PowerShell kholein:

```bash
ssh root@VPS_IP
```

Firewall (hPanel → VPS → Security → Firewall, ya server par):

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
docker --version && docker compose version   # dono chalne chahiye
```

## 4. Code server par daalna

**Tarika A — GitHub (behtar, update aasaan):** `mgsf_v2` ko ek **private** GitHub repo mein push karein (`.env`, `node_modules`, `.next`, `data`, `backups`, `uploads`, `firebase-service-account.json` push **nahi** honge — `.gitignore` mein hain). Phir server par:

```bash
cd /opt && git clone https://github.com/<aap>/mgsf_v2.git && cd mgsf_v2
```

**Tarika B — WinSCP / FileZilla:** `mgsf_v2` folder zip karein (bina `node_modules`, `.next`, `data`, `.env`), `/opt/mgsf_v2` mein upload karke `unzip` karein.

## 5. `.env` banana (server par)

```bash
cd /opt/mgsf_v2
cp .env.example .env
nano .env
```

Ye zaroor bharein:

```ini
POSTGRES_PASSWORD=lamba-mushkil-password        # sirf letters + numbers rakhein
JWT_SECRET=48+ random characters                 # banane ke liye: openssl rand -base64 48
DOMAIN=admin.yourtrust.in
PUBLIC_BASE_URL=https://admin.yourtrust.in
STORAGE=local
ADMIN_LOGIN_OTP=1                                # SMTP set nahi hai to pehle 0 rakhein
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=aapka@gmail.com
SMTP_PASS=gmail-app-password                     # Google account → App passwords
MAIL_FROM="Trust Name <aapka@gmail.com>"
```

`DATABASE_URL` ki chinta na karein — docker-compose khud `db` wala URL deta hai.
Save: `Ctrl+O`, Enter, `Ctrl+X`.

## 6. Data laana (purana data chahiye to — warna step 7 par jaayein)

Aapke PC ke Postgres mein jo data hai (Firestore se migrate kiya hua), wahi server par le jaana sabse aasaan hai:

**PC par** (pgAdmin → database par right click → Backup → Format: *Plain*, "Owner" aur "Privileges" off) ya command:

```bash
pg_dump --no-owner --no-privileges -U postgres -d mgsf -f mgsf.sql
```

`mgsf.sql` aur `uploads` folder (agar photos local save hui hain) WinSCP se `/opt/mgsf_v2/` mein daalein. Phir server par — **app chalane se pehle**, sirf database:

```bash
cd /opt/mgsf_v2
docker compose up -d db
sleep 10
cat mgsf.sql | docker compose exec -T db psql -U mgsf -d mgsf
mkdir -p data/uploads && cp -r uploads/* data/uploads/ 2>/dev/null; chown -R 1000:1000 data/uploads
```

## 7. App chalana

```bash
cd /opt/mgsf_v2
mkdir -p data/uploads && chown -R 1000:1000 data/uploads   # app "node" user (1000) photos / receipts yahan likhta hai
docker compose up -d --build        # pehli baar 5–10 minute
docker compose logs -f app          # "database is up to date" aur "Ready" dikhe to Ctrl+C
```

Migrations app start hote hi apne aap chalti hain. HTTPS certificate Caddy khud banata hai (DNS sahi hona chahiye).
Browser mein kholein: `https://admin.yourtrust.in`

**Naya install hai (step 6 nahi kiya)** to pehla admin login banayein:

```bash
docker compose exec app node scripts/create-account.js admin trust@yourmail.com "Trust Ka Naam" StrongPass123
```

## 8. Roz ka kaam / dhyan rakhne wali baatein

| Kaam | Command |
|---|---|
| App ke logs | `docker compose logs -f app` |
| Restart | `docker compose restart app` |
| Sab band / chalu | `docker compose down` / `docker compose up -d` |
| Naya code (GitHub) | `git pull && docker compose up -d --build` |
| Backup | roz raat `backups/mgsf-YYYY-MM-DD.sql.gz` (14 din rakhta hai) |

- **Backups server se bahar bhi rakhein** — hafte mein ek baar WinSCP se `backups/` PC / Google Drive par copy karein. Hostinger ke VPS snapshot bhi on rakhein.
- Backup se wapas laana: `gunzip -c backups/mgsf-2026-10-15.sql.gz | docker compose exec -T db psql -U mgsf -d mgsf` (khaali database par).
- `.env` aur `data/` folder kabhi GitHub par na daalein.
- Pehle kuch din `ADMIN_LOGIN_OTP=1` ke saath test karein ki email aa raha hai.

## Problem aaye to

| Dikkat | Kya karein |
|---|---|
| Site nahi khulti / certificate error | DNS A record VPS IP par hai? `docker compose logs caddy` dekhein; port 80/443 firewall mein khule? |
| "Database update pending" | `docker compose restart app` (start par migration chalti hai), logs dekhein |
| Login par OTP nahi aata | SMTP details / Gmail app password check karein; tab tak `ADMIN_LOGIN_OTP=0` karke `docker compose up -d` |
| Build mein memory error | KVM 1 par: `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
