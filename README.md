# MGSF v2 (Firebase ke bina)

Same MGSF project (yojna, members, agents, closing/vivah, payments, reports), lekin **Firebase hata kar**:

| Kaam | Purana (Firebase) | Naya (v2) |
|---|---|---|
| Database | Firestore (har read/write ka paisa) | **PostgreSQL 16**, fixed cost, unlimited reads |
| Backend | Cloud Functions + Next API routes | **Next.js 15 API routes** (isi folder mein) |
| ORM | – | **Drizzle ORM** (pure JS, koi binary nahi) |
| Login | Firebase Auth | Apna: bcrypt password + JWT, OTP DB mein |
| Files | Firebase Storage | **Cloudflare R2** (10 GB free, download free) ya server disk |
| Push | FCM + service account | **Expo Push** (free) |
| Hosting | Vercel + Firebase | **1 VPS** (Docker: Postgres + app + HTTPS + daily backup) |

## Firebase ka bill kyun badh raha tha

Aapke purane code mein ye cheezein sabse zyada reads kha rahi thi:

1. **`payment_pending`**: har closing pe har member ka ek document (700 members × 100 closings = 70,000 docs). Har report, PDF aur status screen inhe baar-baar padhti thi.
2. **Add Member modal** khulte hi *saare* members fetch hote the, sirf next application number nikalne ke liye.
3. **Agent report** ke liye 1 GiB wala Cloud Function aur hazaaron reads, har click pe.
4. Member list, closing list aur transactions: sab browser mein poora data load karke filter hota tha.

Postgres mein ye sab **ek SQL query** hai (`GROUP BY`, `JOIN`, `count`), aur reads ka koi bill nahi hai. VPS ka kharcha fixed rehta hai, chahe kitne bhi click hon.

**Andaazan kharcha:** VPS 2 vCPU / 4 GB RAM ≈ ₹500–1,200 per month (Hetzner, DigitalOcean Bangalore, Hostinger KVM, etc.; khareedne se pehle current rate check kar lein). Domain ≈ ₹800 per year. R2 ke pehle 10 GB free hain.

## Folder structure

```
mgsf_v2/
├─ src/db/schema.js          ← poora database schema (tables, indexes)
├─ drizzle/                  ← SQL migrations (auto-generated)
├─ src/services/             ← business logic (UI se alag, test kiya hua)
│   ├─ closings.js           closing record / edit / revert, dues banana, "Correct Payments"
│   ├─ payments.js           single / bulk (custom + waterfall) payment, reverse, transaction list
│   ├─ members.js            add, accept, reject/remove, block, delete, search, application no.
│   ├─ reports.js            agent report (purana getAgentMarriagePaymentReport), member dues, dashboard
│   └─ agents.js, programs.js
├─ src/app/api/              ← REST API (web panel + mobile app dono yahi use karenge)
├─ src/lib/                  ← auth (JWT), OTP, mail, file upload, push, dates
├─ client/mgsfApi.js         ← chhota fetch client (web + Expo app ke liye)
├─ scripts/
│   ├─ migrate-from-firestore.js   ← Firestore → Postgres data shift (one-time)
│   ├─ create-account.js           ← pehla admin / owner login banana
│   └─ db-migrate.js               ← tables banana / update karna
├─ tests/                    ← 18 tests (asli Postgres pe chalte hain)
├─ Dockerfile, docker-compose.yml  ← VPS deploy (Postgres + app + HTTPS + backup)
└─ .env.example
```

## Database: purana → naya

| Firestore | Postgres table | Note |
|---|---|---|
| `users/{adminUid}` + organizations / contact / policies | `admins` | ek row = ek trust |
| Firebase Auth users | `accounts` | admin/agent: email se login, member: **registration number** se |
| `agents` | `agents` | `programCounts` ab store nahi hota, SQL se ginta hai |
| `programs` | `programs` | `memberCount` / `inactivemembercount` ab live count hain |
| `members` | `members` | `marriage_flag` + `marriage_date` → `closing_date` (null = closed nahi) |
| `closing_groups` | `closing_groups` | `members[]` array ki jagah `members.closing_group_id` |
| `payment_pending` | `dues` | ek row = ek payer × ek closing; `memberDetails` copy ab nahi (JOIN se aata hai) |
| `transactions` | `transactions` | delete ki jagah `status = 'reversed'` (audit ke liye) |

Document ids same rehte hain, isliye purane references (`closingMemberId`, `agentId` …) kaam karte rahenge.

## Business rule (closing ka paisa kaun dega)

Closing C (date D) ke liye member P tab dega jab:
same program, P ≠ C, P deleted/blocked/inactive nahi, status accepted/closed, **P.dateJoin ≤ D**, aur P khud D se pehle ya D ko closed nahi hua.

Ye wahi rule hai jo purane Cloud Function aur "Correct Payments" screen mein tha.
- Naya member add / accept hone pe: uski **join date ke baad ki saari closings** ka due banta hai (same rule). Join date badlo to dues usi hisaab se jud / hat jaate hain. Jis closing ka paisa jama ho chuka hai aur nayi date se wo banti nahi, wahan badlav mana hota hai.
- Ek program mein dues badalne wale kaam (closing, accept, join date, pay amount, delete) ek-ek karke chalte hain (program lock). Isse ek saath do kaam hone par koi due chhootta nahi.
- Payment reverse hone par jo due sirf paise ki wajah se bacha tha (rule ke hisaab se banta nahi), wo hat jaata hai.
- Rakam sirf poore rupaye mein (₹100.5 mana).
- Live data check (kuch nahi badalta): `node --env-file=.env scripts/audit-dues.js`. Ye MISSING / EXTRA due, paisa mismatch aur bina due ke transaction dikhata hai.
- Test: `tests/core-audit.test.js` hazaron random operation chalata hai aur har step ke baad poora hisaab check karta hai: dues = rule, jama = transactions, status sahi.

**Purane bugs jo yahan theek hain:**
- Closing member ko khud ki closing ka due nahi banta (pehle `{id}_{id}` ban jata tha).
- Paid closing dobara pay nahi ho sakti (dues `FOR UPDATE` lock hote hain).
- Revert closing ab member ke *dusri closings ke paid dues* delete nahi karta. Paise aa chuke hon toh `force` maangta hai, aur transactions delete hone ki jagah `reversed` mark hote hain.
- Partial payment ka baaki hissa baad mein pay ho sakta hai.
- Saari API routes pe login check hai (pehle `/api/user`, `/api/members`, `/api/email-send` khule the).
- OTP DB mein hai (pehle memory mein tha, server restart pe kho jata tha).
- Passwords bcrypt hash hain (pehle Firestore mein plaintext the).

## Local pe chalana (Windows / Mac)

1. Node 22 aur PostgreSQL 16 install karein (ya `docker compose up -d db`).
2. Ye commands chalaayein:

```bash
cd mgsf_v2
npm install
copy .env.example .env          # Mac/Linux: cp .env.example .env  → DATABASE_URL aur JWT_SECRET bharein
npm run db:migrate              # tables banengi
npm run create-account -- admin trust@example.com "Mera Ghanchi Samaj Foundation" StrongPass123
npm run dev                     # http://localhost:3000/api/health
npm test                        # (test DB pe chalayein, tables khaali karta hai)
```

## Firestore se data laana

1. Firebase Console → Project settings → Service accounts → **Generate new private key**. File ko `mgsf_v2/firebase-service-account.json` naam se save karein (git mein mat daalein).
2. Pehle check run karein (kuch likha nahi jata):
   ```bash
   npm run migrate:firestore -- --dry-run --export-json=backup-firestore.json
   ```
   `migration-output/report-*.json` mein counts aur warnings dekhein: galat date, bina agent ke member, duplicate payment_pending, apne aap ka due, etc.
3. Asli import:
   ```bash
   npm run migrate:firestore -- --admin-password=NayaAdminPass123
   ```
   - Members ka purana password chalta rahega (Firestore mein plaintext tha, ab hash ho gaya). Jinka nahi mila, unka purana default rule lagega (naam ka pehla shabd, max 5 akshar + janm saal; jaise "ram1999").
   - Agents ka password bhi same. Jinka nahi mila, unka naya password `migration-output/new-logins-*.csv` mein milega. Ise private rakhein aur kaam hone ke baad delete kar dein.
   - Dobara chalana ho toh `--fresh` lagayein.
4. Photos aur documents ke Firebase Storage URLs abhi waise hi chalte rahenge. Baad mein unhe R2 pe copy karne ki script alag se banegi.

Firestore se ek baar poora data padhne ka kharcha bahut kam hai (100k documents ≈ $0.06).

## Server pe deploy (VPS)

```bash
# Ubuntu VPS pe, Docker install karke:
git clone <repo> mgsf_v2 && cd mgsf_v2
cp .env.example .env        # POSTGRES_PASSWORD, JWT_SECRET, DOMAIN, SMTP_* bharein
docker compose up -d        # db + app + HTTPS (caddy) + roz raat backup
docker compose exec app node scripts/db-migrate.js
```
Domain ka A-record VPS ke IP pe point karein, HTTPS certificate apne aap ban jayega.
`backups/` folder ko hafte mein ek baar server se bahar (Google Drive, laptop) copy zaroor karein.

## API (short)

Sab requests mein login token chahiye (web: cookie, app: `Authorization: Bearer <token>`).

| Method | Path | Kaam |
|---|---|---|
| POST | `/api/auth/login` | `{loginId, password, otp?}` → token |
| POST | `/api/auth/logout` | |
| GET / PATCH | `/api/auth/me` | profile / Expo `pushToken` save |
| POST | `/api/auth/password` | password badalna |
| GET / DELETE | `/api/auth/sessions` | logged-in devices |
| GET / PATCH | `/api/trust` | trust info, contact, policies |
| GET / POST | `/api/programs` | yojna list / nayi yojna |
| GET / PATCH / DELETE | `/api/programs/:id` | |
| GET | `/api/programs/:id/dashboard` | counts + collected / outstanding |
| GET / POST | `/api/programs/:id/members` | search (`q, status, agentId, closed, page, sort`) / add |
| GET | `/api/programs/:id/members/next-application-number` | |
| GET | `/api/programs/:id/members/check-aadhaar?aadhaarNo=` | |
| GET / PATCH / DELETE | `/api/members/:id` | |
| POST | `/api/members/:id/accept` | request accept → reg no. + login + dues |
| POST | `/api/members/:id/status` | `{status: rejected/removed}` ya `{blocked: true/false}` |
| POST / PATCH / DELETE | `/api/members/:id/closing` | closing record / edit / revert (`?force=1`) |
| GET | `/api/members/:id/dues` | member ka due / paid list |
| GET / POST | `/api/members/:id/dues/check` | "Correct Payments" check / apply |
| POST | `/api/members/:id/reset-password` | |
| GET | `/api/programs/:id/closings` | closings + payment progress |
| GET / POST | `/api/programs/:id/closing-groups` | |
| POST | `/api/programs/:id/payments` | `{type: "single"/"bulk", …}` |
| GET | `/api/programs/:id/transactions` | filters + paging |
| POST | `/api/transactions/:id/reverse` | galat entry wapas |
| GET | `/api/programs/:id/agents/:agentId/report` | agent report (purane jaisa response) |
| GET / POST, GET / PATCH / DELETE | `/api/agents`, `/api/agents/:id` | |
| POST | `/api/upload` | photo / document upload → URL |
| GET / POST / PATCH | `/api/notifications` | list / bhejna (push + in-app) / read |
| POST · GET · GET | `/api/notifications/send` · `/audience` · `/sent` | panel se Expo push bhejna · kitne phone tak · history |
| GET · GET / DELETE | `/api/app-logins` · `/api/app-logins/:accountId` | app login ginti + list · phones / logout |
| GET / PUT | `/api/trust/app-settings` | Settings → Mobile App (maintenance, update, bhugtan, sampark, auto-notification) |
| — | `/api/app/*` | mobile app: status, config, session, refresh, family, member khata, agent tabs, requests, PDFs, payment, upload, logo, push-test |
| GET / POST | `/api/owner/trusts` | owner: trusts list / naya trust |

## Admin panel (Phase 2) — kya port ho chuka hai

Purane `mgsf_web_panel` ke screens yahan copy hain. Firebase ki jagah ab `src/lib/client/api.js` aur
`src/lib/services/firebaseService.js` (same function names, data API se aata hai) use hote hain.

| Screen | Status |
|---|---|
| Login (email → password → OTP agar `ADMIN_LOGIN_OTP=1`), Forgot password (OTP se) | ✅ |
| Layout, sidebar, top bar, yojna select, logout | ✅ |
| Dashboard + Closed Cases list (edit, PDF data, banner, pay status, revert) | ✅ |
| Members: list, add, edit, details, block, delete, requests (accept / reject) | ✅ |
| Members: Close Form (closing), Payment Details, Correct Payments, Join Fees | ✅ |
| Add Payment (top bar) | ✅ |
| Yojna (programs) | ✅ |
| Settings: organization, contact, policies, password, sessions | ✅ |
| Agents page + agent details (members, pay status, rasid, all-pay-status PDF, transactions) | ✅ |
| Payments (transactions) page, Closing Payments page | ✅ |
| Owner page (trusts list, enable/disable) | ✅ |
| Mobile app (Expo) — agent + member, alag repo `mgsf_mobile` | ✅ (neeche "Mobile app" dekhein) |

"Create Payment Entry" (purana GenerateRasidEntry) ki ab zaroorat nahi: closing record hote hi server entries bana deta hai.

## Members page (`/members`)

- **Status tabs** (live count ke saath): All · Active · Inactive · Blocked · Closed · Requests · Rejected — dashboard wale hi niyam (closed > blocked > inactive > active).
- **Filters:** search (naam, reg no, pita, phone, gaon, Aadhaar, agent), agent (ya "No agent"), gender, join fees paid/pending, dues hai/nahi, join date range (presets ke saath); **More filters:** age group, state, district, village, added by (admin/agent), kist. Lage hue filter chips mein dikhte hain (× se hatao, "Clear all").
- **Summary line:** kitne dikh rahe, male/female, join fees pending, kitno par dues + kitna.
- **Columns** button se columns chuno (yaad rehta hai). Checkbox se members select karo → PDF / CSV / Certificates sirf selected ke.
- **Export:** *Download PDF* (asli PDF file — title, columns, landscape/portrait, agent-wise group + sub-total, filter text PDF pe chhapta hai), *CSV/Excel*, *Print view*.
- Row: 👁 details (ya double-click), ✎ edit, ⋯ → close form, certificate, payment details, registration form, delete.

PDF mein Hindi: react-pdf "ई" jaise shuru ke swar ko galat jodta tha ("ॅशा"); `src/lib/pdfDevanagariFix.js` sab PDFs mein ise theek karta hai.

## Closed Members page (`/closedMembers`)

Sidebar → **Closed Members**. Sirf woh members jinki closing (vivah) ho chuki hai.

- **Filters:** closing date range (This month / Last month / 3 months / This year presets), closing group (ya "No group"), agent (closed member ka agent, ya "No agent"), payment status (Fully collected / Pending / No payers), search (naam, reg no, gaon, phone).
- **Upar cards:** kitne closed members, payer entries (paid / pending), collected, due, overall progress — sab filter ke hisaab se.
- **Har row:** member, closing date + group, agent, payers (kitne paid / pending), collected / due + progress bar.
  Actions: **Pay status** (us closing ke saare payers aur kisne diya / baaki), **Closing form PDF**, **Banner image**, ⋮ → banner/PDF data edit.
- **Poori list:** **Download PDF** (trust header ke saath, A4 landscape, totals), **CSV**, aur **All members payment status** (filtered closings ke saare payers ek saath).
- API: `GET /api/programs/:id/closings?from=&to=&closingGroupId=&closingAgentId=` (`none` = bina group / bina agent).

## Dashboard (advanced)

Home page (`src/components/screen/home/dashboard/AdvancedDashboard.js`) ek hi API call se banta hai: `GET /api/programs/:id/analytics?agentId=` (`src/services/analytics.js`).

- **Members:** Total, Active, Inactive, Blocked, Closed, Pending requests (+ rejected, deleted alag). Buckets ek-doosre mein overlap nahi karte: closed > blocked > inactive > active — isliye jod ke Total banta hai.
- **Collections:** total collected, is mahine, aaj, outstanding (dues + kitne members), join fees, collection rate %, cash vs online. Reversed payments nahi gine jaate.
- **Trend:** pichhle 12 mahine — collection, members joined vs closed (hover pe exact number).
- **Agent-wise table:** har agent ke members (status bar), active/inactive/blocked/closed/pending, collected, outstanding, collection %; sort, search, CSV export. Row pe click → poora dashboard sirf us agent ka. "No agent (admin)" row bhi aati hai.
- **Recent closings / payments**, aur neeche purana Closed Cases table.

## Trust details (naam, address, logo, PDF header) — ek jagah se

**Settings → Organization** mein jo bhi badlo (naam, short name, address, phone, registration no., top titles, logo, right logo, stamp, founder line), woh turant har jagah lag jata hai:

- sidebar, browser tab, login page
- har PDF: receipt (रसीद), certificate, member registration form, closing form, payment report, all-pay-status, transactions report, member/join-fees export
- jo tab pehle se khule hain woh bhi bina refresh update ho jaate hain

Jab tak Settings mein kuch save nahi kiya, har jagah neutral **"Trust Manager"** dikhta hai (koi logo, phone ya address nahi) — MGSF ki details code mein ab fixed nahi hain. Logo na ho to sidebar/login pe naam ke initials (jaise "MG") dikhte hain.

PDF header ab picture nahi hai — trust ki details se banta hai (logo | naam, address, phone, रजिस्ट्रेशन | right logo). Purani tarah picture chahiye to Settings mein "Use a header picture" chuno aur picture upload karo.

Code:
- `src/lib/trust/profile.js` — saare fields + default values (`normalizeTrust`)
- `src/services/trust.js` — server: DB se profile, images ko data-URI mein badalna (server PDFs ke liye)
- `src/lib/client/trust.js` — browser: profile load, save, sab tabs ko "changed" signal
- `src/components/screen/agents/agentDetails/component/pdfcom/HeaderCom.js` — PDF letterhead; `src/lib/trust/htmlHeader.js` — print-window letterhead
- API: `GET/PATCH /api/trust` (`{ profile: {...} }`), `GET /api/trust/public` (login page ke liye sirf naam + logo)

## Receipts (रसीद) — pending / paid, closing group wise

- **Closed Members → "Receipts (रसीद)"** button: Pending ya Paid chunein, closing group, closing date range, agent (sab / ek / bina agent), pehla रसीद no. aur prefix → **Generate**.
- Agent page → Members Pay Status ke receipt buttons bhi ab yahi system use karte hain.
- Data browser se nahi, seedha DB se aata hai. Ek member = ek रसीद, sirf filter wali closings ke saath.
- Bada run **parts** mein banta hai (har part ~300 pages, लगभग 30 sec). रसीद number parts ke beech chalte rehte hain (Part 1: 1–150, Part 2: 151–240 …).
- PDF ek alag worker thread mein banti hai, isliye banate waqt baaki app slow nahi hoti. Files 24 ghante tak "Recent runs" mein rehti hain.
- 20,000 pages se bade run mana ho jaate hain (`RECEIPT_MAX_PAGES`). Tab group / date / agent chunein. Part ka size `RECEIPT_PART_PAGES` se badal sakte hain.
- Worker `npm run dev` / `npm run build` ke saath apne aap ban jaata hai (`npm run build:workers`).
- Dhyan rahe: chal rahe runs memory mein hain, server restart pe list khaali ho jaati hai (bani hui files 24 ghante disk pe rehti hain).

## Amount chhupana (👁 eye)

- Dashboard ke counts aur amounts, aur Members, Closed Members, Closing Payments, Payments, Reports, Agents / Commission ke amounts **default chhupe** rehte hain (`₹ ••••`).
- Upar top bar mein 👁 button (ya Dashboard par "Show amounts") dabane se sab jagah dikhte hain; dobara dabane se chhup jaate hain. Ye pasand isi browser mein yaad rehti hai.
- PDF / CSV download mein hamesha asli amount aate hain.

## Reports — late payments, agent performance, member history (Sidebar → Reports)

- **Payment ki aakhri tarikh:** closing date (ya jis din closing record hui, jo baad mein ho) + **45 din**. Yojna edit form mein "Payment ke din" se badal sakte hain. Late accept hua member / join date peeche gayi to us purani closing ke liye aaj se 45 din.
- Har entry ek hi khane mein: **Time par** (aakhri tarikh tak poora bhara), **Late bhara** (baad mein bhara — kitne din late), **Baki (overdue)** (tarikh nikal gayi, abhi nahi bhara), **Abhi time hai**.
- **Late / baki payments:** filter — agent, closing group, closing date, kam se kam X din late, search; sort — sabse zyada late / amount / due date. CSV (poori list) aur PDF (top 1000).
- **Agent performance:** har agent ka time par %, vasooli %, avg late din, baki raashi, commission; Score = 60% time par + 40% vasooli se Rank 🥇🥈🥉. Best agent / sabse zyada vasooli / sabse zyada commission / sabse zyada baki. PDF / CSV.
- **Member history:** member chunein (ya Members → ⋯ → "Payment history report") — har closing: aakhri tarikh, kab bhara, kitne din late, rasid/transaction no. PDF / CSV.
- Agent login ko sirf apne members ki late list milti hai. Staff ke liye role mein naya "Reports" permission.
- DB: `drizzle/0006_due_days_paid_date.sql` — `programs.due_days`, `dues.paid_date` (purane paid entries ki date transactions se bharti hai), purani due dates = closing + 45. Bade database par 1–2 minute lag sakta hai. **`npm run db:migrate` zaroor chalayein.**

## Closing payment sahi rakhna (date / group badalne par)

Rule: member X closing C ka paisa tab dega jab X ki join date ≤ C ki closing date, X khud C se **pehle** close na hua ho (same din close hue members ek-dusre ko dete hain), aur X ki pay amount (किस्त) ₹0 na ho.
- **Pay amount ₹0:** us member ki koi pending entry nahi banti. Edit karke ₹0 kiya to uski khaali pending entries hat jaati hain (jama paisa wali rehti hain); wapas ₹0 se zyada kiya to entries phir ban jaati hain. Age group ki kist ₹0 rakhne se us group ke members kuch nahi dete. Migration 0005 purane ₹0 (jo pehle "set nahi" maane jaate the) ko program default bana deta hai.
- **Naya member / request accept:** join date ke baad ki **saari** closings ki entry banti hai (pehle sirf aaj ke baad wali banti thi).
- **Edit Member mein join date badli:** nayi date ke hisaab se jo closing ab banti hai uski entry judti hai, jo nahi banti uski khaali (unpaid) entry hatti hai. Agar kisi aisi closing ka paisa pehle se jama hai jo nayi date se nahi banti, to badlav **mana** ho jaata hai aur message batata hai kaun si — pehle wo payment reverse karein.
- **Closing date badli:** naye payers jude, purane (jo ab eligible nahi) ki unpaid entry hati; jama paisa wale payer ho to badlav mana. Closing member ki khud ki payer entries bhi nayi date ke hisaab se.
- **Sirf closing group badla:** payments par koi asar nahi.
- **Closing revert:** member phir se usi rule se payer ban jaata hai.
- Sab kuch ek hi DB transaction mein — aadha-adhura kabhi nahi. Tests: `tests/dues-sync.test.js`.

## Users, roles aur Master Data

- **Super Admin:** trust ka main admin login — sab screens, sab actions. Ise koi role nahi diya ja sakta.
- **Staff users:** Master Data → **Users** (ya Settings → Users & Roles). Email + password se normal admin login page par login.
- **Roles:** Master Data → **Roles**. Har screen ke liye View / Add / Edit / Delete (Members, Agents, Yojna, Closing, Payments & Receipts, Commission, Master Data, Users & Roles, Trust Settings). Ready templates: Manager, Accountant, Data entry, Viewer.
- Jo screen allowed nahi wo sidebar se gayab, URL kholne par "permission nahi hai" dikhta hai, aur API bhi 403 deti hai (server par check, sirf button chhupana nahi).
- Staff user kisi role ko utni hi permission de sakta hai jitni uske paas khud hai; apna role khud nahi badal sakta. User block / password badalne par wo sab jagah se logout.
- **Master Data lists:** States, Districts (state ke andar), Relations (वारिस संबंध), Castes (जाति), Gotras. Add, "Add many" (ek line mein ek), rename, order, Active/Inactive, Delete (jo member use kar rahe hon wo delete nahi — Inactive karein). Pehli baar purani built-in lists apne aap aa jaati hain.
- Add / Edit Member form inhi lists se chalta hai (State → District, Relation, Gotra, naya **Caste** field). Lists badalne par khule tabs mein bhi turant update.
- DB: `drizzle/0004_roles_master_data.sql`. **`npm run db:migrate` zaroor chalayein.**

## Agent commission

- **Setting:** Add / Edit Agent form → "Agent Commission" card. Commission Allowed on/off. Join fees aur Closing payment alag-alag on/off, har ek mein **Percent %** ya **Fixed ₹**. Naye agent ka default: join fees 20%, closing 5%. Purane agents Off rehte hain jab tak aap on na karein.
- **Kab judta hai:**
  - Join fees jama hone par (Add Member form, Accept request, Edit member, ya join fees drawer).
  - Member ke har closing payment par (single / bulk / Add Payment).
  - Commission member ke agent ko milta hai. Fixed ₹ poori payment par milta hai; aadhi payment par aadha.
- **History:** Agent → View → **Commission** tab. Har entry: member, closing member, payment, rate, commission, status (Pending / Paid / Cancelled). Filter, search, CSV.
- **Agent ko payment:** "Pay agent" → All pending / Up to amount (purani entries pehle) / Selected rows. Payout number `COM-YYYYMMDD-0001` banta hai. Galti ho to **Revert** (entries wapas pending).
- **Payment reverse / delete / closing revert:** commission pending ho to Cancelled. Agent ko pehle hi de diya ho to ek minus (reversal) entry banti hai, jo agle payout se kat jaati hai.
- **Old payments:** commission on karne se pehle ki payments ke liye "Old payments" button (current rate se, double nahi judta).
- Rate badalne se purani entries nahi badalti. Agent apne member ki join fees khud nahi badal sakta (sirf admin).
- Agents list mein har agent ka rate aur baki commission dikhta hai.
- DB: `drizzle/0003_agent_commission.sql` (`agents.commission`, `agent_commissions`, `agent_commission_payouts`). **`npm run db:migrate` zaroor chalayein.**

## Demo / test data (5000 members)

```bash
npm run seed:demo                                   # 5000 members, 500 closings, 20 agents, 25 groups (~2 min)
npm run seed:demo -- --members=2000 --closings=100  # apni ginti
npm run seed:demo -- --admin=trust@example.com      # kis trust mein (default: pehla trust)
npm run seed:demo -- --remove                       # demo data hatao
```
- Ek nayi yojna **"Demo Yojna (5000)"** banti hai. Usme agents, closing groups, closings, dues (purani closings ~80% paid, pichhle 3 mahine ki pending), payments, join fees aur agent commission hote hain (odd number wale demo agents ka commission on).
- Sab ids `DEMO-` se shuru hoti hain, asli data ko haath nahi lagta. Dobara chalane par purana demo hat kar naya banta hai.
- Bade test ke liye alag database (jaise `mgsf_demo`) behtar hai.

## Load test (5000 members, 500 closings)

Test DB: 5000 members, 20 agents, 25 closing groups, 500 closings, ~11.9 lakh dues, ~8 lakh transactions.

| Kaam | Pehle | Ab |
|---|---|---|
| Dashboard analytics | 5 s | ~1 s |
| Closed Members list | 3 s | 0.23 s |
| Closing revert | 370 s | 0.04 s |
| Members (1000 ka page) | 1.4 s | 0.33 s |
| Members page poora load | 7.5 s | ~4 s |
| Closing Payments API | 1.76 s / 8.5 MB | 0.9 s / 5.6 MB |
| Transactions (bhara mahina) | 15 s, 92 requests | 2.9 s, 1 request |
| Receipts, 1 agent + 1 group (240 रसीद, 476 pages) | timeout | ~50 s, 2 parts |
| Member history | — | ~20 ms |
| Nayi closing record / 50 dues pay | — | ~0.2 s / ~0.08 s |

Iske liye kya badla:
- `drizzle/0002_performance_indexes.sql` naye indexes jodta hai. **`npm run db:migrate` zaroor chalayein.**
- Dashboard, closing list aur members ki queries ab per-member aggregate karti hain (LATERAL), har row pe alag sub-query nahi.
- Transactions ek hi request mein aate hain (max 50,000 per range; isse zyada ho toh page chhoti range chunne ko bolta hai).
- Server pe `Caddyfile` gzip/zstd compression chalu karta hai, isse badi lists 5–8 guna chhoti ho jaati hain.

## Mobile app (agent + member) — naye features

App: alag repo **`mgsf_mobile`** (Expo). Server ki saari app API `src/app/api/app/*` mein, logic `src/services/mobileApp.js`.
Har feature ko developer **`/feature-control` → "Mobile app"** group se trust-wise band / chalu kar sakta hai.

| Feature | Admin panel mein kahan | App mein | Feature control switch |
|---|---|---|---|
| App ki settings — maintenance, naya / zaroori update, sampark, "trust ke baare mein" | Settings → **Mobile App** | maintenance screen, update banner, Settings | `mobileApp` |
| **App se bhugtan** — UPI QR (raashi ke saath), UPI ID, bank khata, trust ka apna QR, steps, WhatsApp suchna | Settings → Mobile App → "App se bhugtan" | member: "भुगतान करें" + Pay tab · agent: "ट्रस्ट को जमा" | `appPayment` |
| **Push notification (Expo, free)** — panel se bhejna: sab / members / agents / bakaya wale (raashi apne aap) / chune hue; history + kitno ne padhi | Settings → **Notifications** | phone tray + "सूचनाएँ" list, tap → sahi screen | `appNotifications` |
| Apne aap jaane wali suchna — bhugtan jama, nayi closing (member: apni raashi + antim tithi, agent: kul vasooli) | Settings → Notifications → "Apne aap jaane wali" (har ek band ho sakti hai) | — | `appNotifications` |
| **App logins** — kitne member / agent ne login kiya, kis phone par (model, Android, app version, aakhri baar), notification chalu?, ek phone / sab phone se logout | Settings → **App logins** | logout hote hi app login screen par | `appLogins` |
| Member / agent login app mein | — | band = login screen par wo tab hi nahi dikhta | `memberLogin`, `agentLogin` |
| Parivaar (ek mobile number) — sab sadasya ek saath, suchna parivaar ke phone par bhi | — | member home "मेरा परिवार" | — |
| Varisdar ka Aadhaar no. + Aadhaar aage / peeche photo | Add / Edit member (pehle se) | agent request form + member ka khata → विवरण → दस्तावेज़ | — |
| Trust ka logo / rang app mein | Settings → Organization / **Theme** (ab 17 theme) | login, loading, settings — logo na mile to trust ke rang ka badge | `theme` |
| Telephone test — "टेस्ट नोटिफिकेशन भेजें" (kahan atka: token / Expo / FCM key) | — | App → Settings → सूचनाएँ | — |

Notification: server par Firebase **nahi** chahiye (sirf Expo ko bhejta hai). Android app ke build mein ek baar
`google-services.json` aur Expo par FCM V1 key — sab trust ke liye ek hi Firebase project (`mgsf_mobile/trusts/README.md`).

Ek hi app code se har trust ka alag app (naam, package, server, icon): `mgsf_mobile/trusts/<naam>.json` +
`eas build --profile <naam>-apk`. Naya server ek command se: `DEPLOY-NEW-SERVER.md` (`scripts/server-setup.sh`),
saare server ek saath update: `scripts/deploy-all.ps1`.

## WhatsApp (Gupshup) — join / baki / jama message + inbox

Har trust apna Gupshup app jodta hai (**Settings → WhatsApp**). Feature-control switch: `whatsappApi`. Poora setup: [WHATSAPP-GUPSHUP.md](WHATSAPP-GUPSHUP.md).

- 3 automatic message, har ek ka apna **Template ID** + template text. Har `{{n}}` ke liye variable chunte hain (`{name}`, `{regNo}`, `{pendingAmount}`, `{lastDate}`, `{paidAmount}` …).
  1. member jodte / accept karte waqt "WhatsApp bhejein" tick (default off) → certificate PDF
  2. nayi closing / bulk button → baki rasid PDF
  3. payment → us payment ki jama rasid PDF
- PDF ka signed public link: `/api/wa/file/<token>/<naam>.pdf` (30 din). Gupshup ise download karta hai.
- Callback URL (sab trust ka ek): `/api/whatsapp/callback`. Trust ki pehchaan key header `x-webhook-key` se hoti hai (optional), ya Gupshup payload ke `app` = trust ka app name. Purane `/callback/<trustId>` aur `/callback/<trustId>/<key>` bhi chalte hain.
- **Settings → WhatsApp inbox**: baatcheet. Reply sirf member ke aakhri message ke 24 ghante andar.
- Table `whatsapp_messages` (migration 0011). Code: `src/services/whatsapp.js`, `src/lib/gupshup.js`, `src/lib/whatsappSettings.js`. Tests: `tests/whatsapp.test.js`.

| API | Kya |
|---|---|
| `GET/PUT /api/whatsapp/settings` | Gupshup + templates (API key wapas nahi aati) + callback URL |
| `POST /api/whatsapp/test` | `{ event, phone }` test message |
| `GET/POST /api/whatsapp/send` | baki walon ki ginti / bulk bhejna |
| `GET /api/whatsapp/log` | bheje gaye message + status |
| `GET /api/whatsapp/inbox`, `GET/POST /api/whatsapp/inbox/:phone` | inbox, baatcheet, reply |

## Advance (अग्रिम) payment

Member ya uska agent closing aane se pehle paisa jama kar sakta hai. Closing ka payment lete waqt **"Advance se kaatein"** chunne par pehle advance lagta hai (sabse purani closing pehle), baaki rakam cash / online se. Feature-control switch: `advancePayment`.

- **Panel:**
  - Add Payment (step 4) mein advance balance aur "Advance se kaatein" tick, saath mein "Abhi lena hai ₹…".
  - Member → Payment Details → **Advance ₹…** button: jama karein, wapas dein (refund), hisaab dekhein, galat entry cancel karein.
- **Agent app:**
  - Member khata mein "अग्रिम जमा" card aur "+ जमा करें" button.
  - Bhugtan lene ki screen par "अग्रिम से काटें" option.
  - Agent ne jo cash advance liya, wo uske nakad hisaab mein judta hai.
- **Member app:** advance balance dikhta hai.
- **Payment reverse ya closing revert:** jo hissa advance se kata tha, wo wapas advance mein aa jaata hai.
- Ek hi advance do payment mein nahi lag sakta, kyunki member row lock hota hai.
- **Hisaab:** table `member_advances` (migration 0012). Har badlav ki ek entry banti hai: deposit +, use −, return +, refund −. Advance se hua payment `transactions.payment_method = 'advance'` mein jaata hai.
- **Code:** `src/services/advances.js`. **Tests:** `tests/advances.test.js`, aur `tests/core-audit.test.js` (random advance operations ke saath).

## Fixed rakam (kul seema)

Kisi sadasya ki kul closing rakam ki seema tay kar sakte hain, jaise ₹15,200. Closing ke due tab tak bante rahenge jab tak unka total seema tak na pahunch jaaye. Jo closing seema paar karti hai, uska due sirf bachi hui rakam ka banta hai (jaise ₹100). Uske baad ki closings ka koi due nahi banta. Feature-control switch: `fixedLimit` (Basic preset mein band).

- **Kahan set karein:**
  - Members page → sadasya chunein (jaise 5) → **Fixed rakam** → rakam daalein. "Seema hatayein" chunne par pehle jaisa ho jaata hai.
  - Ek sadasya ke liye: Add / Edit member form mein "Fixed rakam (kul seema)". Khaali chhodne ka matlab hai koi seema nahi.
- **Advance:**
  - Advance sirf (seema − ab tak bhara − pehle se jama advance) tak liya ja sakta hai. Panel aur agent app dono yahi bachi rakam dikhate hain.
  - Bulk modal mein "baki rakam advance mein jama karein (cash)" chunne par har sadasya ki bachi rakam ek saath advance mein jama ho jaati hai.
- **Niyam:**
  - Jo paisa bhara ja chuka hai, wo kabhi nahi kat-ta. Agar seema pehle se bhari rakam se kam rakhi, to bhara paisa waisa hi rehta hai aur aage kuch baki nahi aata.
  - Seema ka hissa sabse purani closing ko pehle milta hai.
  - Jab koi closing revert / delete hoti hai, ya payment reverse hota hai, ya seema badhti / hat-ti hai, to kata hua due (`dues.base_amount` mein poori rakam rakhi rehti hai) wapas bad jaata hai. Jo due seema ki wajah se bana hi nahi tha, wo bhi ban jaata hai.
  - "Correct Payments" seema ke baad wali closings ko missing nahi batata.
- **Dikhta kahan hai:**
  - Member list mein "Fixed rakam" column.
  - Add Payment aur Bulk payment screen par "Fixed ₹15,200 · ₹X baki" tag.
  - Mobile app ke member khata mein "निश्चित राशि" card.
- **Data:** `members.fixed_limit` aur `dues.base_amount` (migration 0013).
- **Code:** `src/services/fixedLimit.js` (`applyLimit`, `setFixedLimit`, `limitStatus`). **Tests:** `tests/fixed-limit.test.js`, aur `tests/core-audit.test.js` (random "limit" operation ke saath).

## App se bhugtan ka anurodh (UTR + screenshot)

Member (apne aur family ke liye) ya agent (apne member ke liye) trust ke UPI QR / bank mein bhugtan karta hai. Phir app se **"भुगतान का अनुरोध"** bhejta hai: kaunsi closing / join fee, rakam, UTR, tareekh aur screenshot. Office panel mein jaanch kar **Sweekar** kare to payment wahin jama ho jaata hai. Feature-control switch: `paymentRequests` (Basic preset mein band). App mein ye tabhi dikhta hai jab Settings → Mobile App mein "app se bhugtan" chalu ho.

- **App:**
  - Member "भुगतान करें" mein closing chunta hai. QR screen ke neeche ek form aata hai: UTR, tareekh, screenshot, note → "अनुरोध भेजें".
  - Agent member khata → "QR भुगतान सूचना".
  - "मेरे भुगतान अनुरोध" screen mein har request ka haal dikhta hai: जाँच में / जमा / अस्वीकार (kaaran ke saath). Jo request abhi jaanch mein hai, use wahan se रद्द bhi kar sakte hain.
  - Jo closing kisi request mein jaanch mein hai, wo dobara chunne mein nahi aati. Member khata mein uski soochna dikhti hai.
- **Panel:** Payments → **App payment requests** (menu par laal ginti).
  - Drawer mein screenshot, UTR aur unke hisaab ki rakam dikhti hai.
  - Office "bank mein kitna aaya" badal sakta hai, aur closing / join fee tick ya untick kar sakta hai.
  - Sweekar karne par ek hi transaction mein sab hota hai:
    - closing jama hoti hain (sabse purani pehle; rakam kam ho to aakhri wali aadhi);
    - phir join fee jama hoti hai;
    - zyada paisa ho to "advance mein daalein" chunne par member ke advance mein jaata hai.
  - Transactions UTR ke saath bante hain, agent commission judta hai, aur member ko push + WhatsApp paid rasid jaati hai.
  - Asweekar karne ke liye kaaran likhna zaroori hai. Bhejne wale ko wo kaaran app mein aur push mein dikhta hai.
- **Suraksha:**
  - Ek UTR do baar nahi chal sakta: na kisi jama payment mein, na kisi khuli ya sweekar request mein.
  - Ek closing do khuli requests mein nahi ho sakti.
  - Agent sirf apne member ke liye request bhej sakta hai, aur member sirf apne aur family ke liye.
  - Aage ki tareekh nahi chal sakti.
  - Members sirf `payments` folder mein screenshot upload kar sakte hain.
- **Data:** table `payment_requests` (migration 0014). Isme `items` aur `result` dono jsonb hain.
- **Code:** `src/services/paymentRequests.js`. **Tests:** `tests/payment-requests.test.js`.

## Data migration — purane Firebase project se (Feature control → "Data migration")

Do purane app ka poora data is panel mein: **MGSF purana app** (`users/{uid}/programs/...`) aur **naya trust app** (`trusts/{id}/...`).

1. `/feature-control` mein login → **Data migration**. Source chunein, Firebase **service-account JSON** daalein (ya JSON backup).
   Key sirf server memory mein 3 ghante rehti hai — DB / disk par kabhi save nahi hoti.
2. Trust list aati hai → trust chunein → admin e-mail / password, "photo + documents copy", "pehle wala hata kar dobara" (replace).
3. **Dry run** pehle: kuch likha nahi jaata, sirf ginti + paisa + jaanch dikhti hai. Phir **Migrate**.
4. Live progress: read → check → write (ek hi DB transaction, sab ya kuch nahi) → files → verify (har due ka jama = uske transactions ka jod, rule check).
   Members, yojna, agents, closing groups, dues, transactions/rasid, join fee kist, **agent commission + payout** sab aate hain.
5. Naye logins ke passwords ka CSV (encrypted rakha) — download karke "Passwords delete" dabayein.

Ek hi Firebase data do alag trust id mein nahi jaata (refuse). Doosre trust ka same login / rasid no. ho to login chhod diya jaata hai (report), rasid no. ke aage `-TAG` lagta hai.

## Excel / CSV import (Members page → "Import")

Feature control mein **Excel / CSV import** (`dataImport`). Members page → **Import**:

- **Sample Excel** (Members + Payments + Help sheet, yojna ke agents / groups ke naam ke saath) ya alag CSV. "उदाहरण" wali lines import nahi hoti.
- File daalte hi **jaanch**: har line ki galti (naam, tareekh DD-MM-YYYY, agent, double Reg. No. / Aadhaar, closed bina closing date, payment jo banta nahi…). Kuch save nahi hota.
- **Import** background mein, live progress: members (reg. no., login, dues, join fee + commission) → purani closings tareekh ke kram se (har payer ke dues) → payments (jama, rasid, commission). Sab normal services se — haath se daale data jaisa hi.
- Result: kitne bane, kaunsi line nahi hui aur kyon, naye passwords CSV, aur **Undo import** (import ke baad alag payment na hua ho to sab hata deta hai).

Deploy: `npm install` (naya package `exceljs`) aur `npm run db:migrate` (0013 fixed rakam, 0014 payment requests, 0015 migration jobs).

## Aage ka kaam (phases)

- [x] **Phase 1:** database, business logic, API, Firestore migration, Docker deploy, tests
- [x] **Phase 2: Web panel** (upar wali table dekhein) — saare screens port ho gaye, Firebase import zero. `mgsf_web_panel` ke screens yahan `src/app` mein laana. UI (antd, PDFs) waisa hi rahega, sirf Firebase calls ki jagah `client/mgsfApi.js`. Order: login → members → closing → payments → transactions → agent report/PDFs → settings.
- [x] **Phase 3: Mobile app.** Naya Expo app `mgsf_mobile` (agent + member) — `/api/app/*` API, Expo push. Neeche "Mobile app" dekhein.
- [ ] **Phase 4: Go-live.** Purana panel 1 din ke liye band → final `migrate:firestore --fresh` → naya live → 1–2 hafte Firebase read-only rakh kar band.
- [ ] Files ko Firebase Storage se R2 pe copy karne ki script; PDF / email / certificate routes.
