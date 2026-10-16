# Naya server — 2 command mein (Hostinger VPS)

Kisi bhi naye Hostinger VPS par (AlmaLinux / Rocky 8-9, Ubuntu 22/24, Debian 12) poora panel ek script se lag jaata hai:
Node, PostgreSQL, HTTPS (Caddy), database, `.env`, service, pehla deploy, pehla admin aur roz ka backup.
Kuch bhi haath se `nano` karne ki zaroorat nahi.

## 1. PC se script server par bhejein aur chalayein

PowerShell, `mgsf_v2` folder mein (IP apne server ka):

```powershell
scp scripts\server-setup.sh root@1.2.3.4:/root/
ssh -t root@1.2.3.4 "bash /root/server-setup.sh"
```

Script ye poochegi (Enter dabane par default value le leti hai):

| Sawaal | Kya daalein |
|---|---|
| App ka naam | chhote akshar, jaise `gsmmf`. Linux user, service, database aur folder `/opt/gsmmf` sab isi naam se banenge |
| Domain | `admin.trust.in`, ya Hostinger ka naam `srv2067729.hstgr.cloud` (default yahi aata hai) |
| GitHub deploy key | script ek key print karegi → GitHub repo → **Settings → Deploy keys → Add deploy key** (write access OFF) → Enter |
| Admin e-mail / naam / password | pehla login. Password khaali chhodenge to random banakar dikha degi, likh lein |

Aakhir mein `✔ Tayyar: https://…` aayega (pehli baar 5-8 minute). Bas.

Database password, `JWT_SECRET` aur `CONTROL_KEY` script khud random banati hai. Ye sab server ki `/opt/<naam>/.env` mein rehte hain; GitHub par kabhi nahi jaate.
E-mail (OTP / rasid) chahiye to baad mein `.env` mein `SMTP_USER` aur `SMTP_PASS` bharein, phir `systemctl restart <naam>`.

Bina sawaal ke chalana ho to:

```bash
bash /root/server-setup.sh --name gsmmf --domain srv2067729.hstgr.cloud \
     --admin-email trust@mail.com --admin-name "Trust Ka Naam" --yes
```

(`--yes` mein deploy key GitHub par pehle se add honi chahiye. Pehli baar bina `--yes` chalayein.)

## 2. Update — saare server ek saath

Ek baar `deploy\servers.example.txt` ko copy karke `deploy\servers.txt` banayein, aur har server ki ek line likhein:

```
root@89.116.33.200   mgsf    /opt/mgsf_v2
root@1.2.3.4         gsmmf
```

Phir har baar code badalne ke baad:

```powershell
git push
powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1          # sab server
powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1 gsmmf    # sirf ek
```

Aakhir mein table dikhegi ki kaun sa server OK hua aur kaun sa FAILED.
Har server par `git pull → build → backup → migrations → restart` hota hai, aur build ke dauran purani site chalti rehti hai.

## Ek server par do trust

Dono baar script chalayein, har baar **alag naam** aur **alag domain/subdomain** ke saath (jaise `mgsf.trust.in` aur `gsmmf.trust.in`, dono ka DNS A record usi server IP par).
Port script khud alag chunti hai (3000, 3001 …). Hostinger wala `srv….hstgr.cloud` naam ek server par ek hi app ko milta hai.

## Purana server

Purana server (`mgsf`, `/opt/mgsf_v2`) bhi isi script se theek ho jaata hai. Uski `.env` nahi badalti; sirf `APP_NAME` aur `PORT` ki line judti hai:

```bash
bash /opt/mgsf_v2/scripts/server-setup.sh --name mgsf --dir /opt/mgsf_v2
```

## Dikkat aaye to

| Dikkat | Kya karein |
|---|---|
| `password mein @ : / ? #` | `.env` ke `DATABASE_URL` password mein ye akshar URL tod dete hain (backup aur deploy fail). Script fix ki command dikhati hai: password sirf letters + numbers, ya `@` ki jagah `%40` |
| Deploy key wala sawaal baar-baar aata hai | key poori copy hui? Repo sahi hai? Ek key ek hi repo mein lagti hai, har server ki apni key |
| `✖ app did not answer` | `journalctl -u <naam> -n 80 --no-pager` |
| Site nahi khulti / certificate | domain ka DNS A record server IP par hai? hPanel → VPS → Firewall mein 80/443 khule? `journalctl -u caddy -n 50` |
| Script beech mein ruk gayi | dobara chalayein. Jo ho chuka wo chhod deti hai, aur `.env` kabhi overwrite nahi karti |

Baaki commands (logs, backup, restore, feature-control): `DEPLOY-ALMALINUX.md`.
