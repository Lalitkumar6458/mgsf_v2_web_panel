// Excel / CSV import into one yojna (Members page → "Import"). Two sheets:
//   Members   one row per member (old closings too: Status "closed" + Closing date)
//   Payments  closing payments already received (payer reg. no. → whose closing → amount, date)
// Everything goes through the normal services — accept (reg. no., login, dues, join fee + commission),
// recordClosing (dues for every payer by THE RULE), paySingle (dues paid, receipt, agent commission) —
// so imported data is exactly like data typed in by hand. Preview first (row-wise errors), then a
// background run with progress; "Undo" removes what that import created.
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { toDate, fmtISO, todayIST } from "../lib/dates.js";
import { activate, setBlocked } from "./members.js";
import { recordClosing, lockProgram } from "./closings.js";
import { paySingle } from "./payments.js";
import { encrypt, decrypt } from "./migration/jobs.js";

/* ── columns (header text in the file → field). Hindi / English / old names all work. ─────────── */
export const MEMBER_COLUMNS = [
  { key: "registrationNumber", label: "Reg. No.", alt: ["registration number", "reg no", "regno", "रजि. नं.", "रजिस्ट्रेशन नंबर"], hint: "Khaali = apne aap banega" },
  { key: "applicationNumber", label: "Application No.", alt: ["form no", "application number", "फॉर्म नं."] },
  { key: "displayName", label: "Naam", alt: ["name", "display name", "नाम", "member name"], required: true },
  { key: "fatherName", label: "Pita / Pati", alt: ["father", "father name", "husband", "पिता", "पिता/पति"] },
  { key: "phone", label: "Mobile", alt: ["phone", "mobile no", "मोबाइल"] },
  { key: "phoneAlt", label: "Mobile 2", alt: ["phone 2", "alt mobile", "दूसरा मोबाइल"] },
  { key: "gender", label: "Gender", alt: ["ling", "लिंग"], hint: "male / female" },
  { key: "birthDate", label: "Janam tithi", alt: ["dob", "birth date", "date of birth", "जन्म तिथि"], hint: "DD-MM-YYYY", date: true },
  { key: "aadhaarNo", label: "Aadhaar", alt: ["aadhaar no", "aadhar", "आधार"] },
  { key: "gotra", label: "Gotra", alt: ["गोत्र"] },
  { key: "jati", label: "Jati", alt: ["caste", "जाति"] },
  { key: "village", label: "Gaon", alt: ["village", "city", "गाँव", "गांव"] },
  { key: "district", label: "Zila", alt: ["district", "जिला"] },
  { key: "state", label: "Rajya", alt: ["state", "राज्य"] },
  { key: "pinCode", label: "Pin", alt: ["pin code", "pincode", "पिन"] },
  { key: "currentAddress", label: "Pata", alt: ["address", "पता"] },
  { key: "guardian", label: "Varisdar", alt: ["nominee", "guardian", "वारिसदार"] },
  { key: "guardianRelation", label: "Varisdar rishta", alt: ["relation", "nominee relation", "रिश्ता"] },
  { key: "dateJoin", label: "Join date", alt: ["date join", "joining date", "जुड़ने की तिथि"], required: true, hint: "DD-MM-YYYY", date: true },
  { key: "payAmount", label: "Kist", alt: ["pay amount", "kist amount", "किस्त"], hint: "Khaali = yojna ki default", number: true },
  { key: "joinFees", label: "Join fee", alt: ["join fees", "namankan shulk", "नामांकन शुल्क"], number: true },
  { key: "joinFeesPaidAmount", label: "Join fee jama", alt: ["join fee paid", "join fees paid", "शुल्क जमा"], number: true },
  { key: "agent", label: "Agent", alt: ["agent email", "agent code", "agent name", "एजेंट"], hint: "Agent ka e-mail / code / naam" },
  { key: "status", label: "Status", alt: ["sthiti", "स्थिति"], hint: "active / closed / blocked" },
  { key: "closingDate", label: "Closing date", alt: ["vivah date", "marriage date", "closing", "विवाह तिथि"], hint: "Status closed ho to", date: true },
  { key: "closingGroup", label: "Closing group", alt: ["group", "closing group name", "समूह"], hint: "Naam — na ho to ban jaayega" },
  { key: "fixedLimit", label: "Fixed rakam", alt: ["fixed limit", "seema"], number: true, hint: "Optional — kul seema" },
  { key: "note", label: "Note", alt: ["remark", "नोट"] },
];
export const PAYMENT_COLUMNS = [
  { key: "payerRegNo", label: "Bharne wala Reg. No.", alt: ["payer reg no", "payer", "member reg no", "reg no"], required: true },
  { key: "closingRegNo", label: "Closing wala Reg. No.", alt: ["closing reg no", "closing member", "closing", "kiski closing"], required: true },
  { key: "amount", label: "Rakam", alt: ["amount", "राशि"], required: true, number: true },
  { key: "paymentDate", label: "Tareekh", alt: ["date", "payment date", "तारीख"], required: true, date: true, hint: "DD-MM-YYYY" },
  { key: "method", label: "Tarika", alt: ["method", "payment method", "mode"], hint: "cash / upi / online / bank / cheque" },
  { key: "reference", label: "Reference", alt: ["utr", "ref", "txn id"] },
  { key: "note", label: "Note", alt: ["remark"] },
];
const METHODS = new Set(["cash", "upi", "online", "bank", "cheque", "other"]);

const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim();
function headerMap(headers, cols) {
  const map = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    const c = cols.find((col) => norm(col.label) === n || norm(col.key) === n || col.alt?.some((a) => norm(a) === n));
    if (c && map[c.key] === undefined) map[c.key] = i;
  });
  return map;
}

/* ── reading files ─────────────────────────────────────────────────────── */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  const s = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}
const cellText = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return fmtISO(new Date(Math.round(v.getTime() / 864e5) * 864e5)) || ""; // Excel date cell (UTC midnight, rounded)
  if (typeof v === "object") { if (v.text) return String(v.text); if (v.result !== undefined) return String(v.result); if (v.richText) return v.richText.map((t) => t.text).join(""); if (v.hyperlink) return String(v.text || v.hyperlink); }
  return String(v);
};

/** Buffer + file name → { members: [[...]], payments: [[...]] } (first row = headers) */
export async function readWorkbook(buf, name = "") {
  if (/\.csv$/i.test(name) || (buf[0] !== 0x50 || buf[1] !== 0x4b)) {
    const rows = parseCsv(buf.toString("utf8"));
    // a CSV is one sheet: payments if its header looks like payments
    const h = headerMap(rows[0] || [], PAYMENT_COLUMNS);
    const isPay = h.payerRegNo !== undefined && h.closingRegNo !== undefined;
    return isPay ? { members: [], payments: rows } : { members: rows, payments: [] };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheetRows = (ws) => {
    const out = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= row.cellCount; c++) vals.push(cellText(row.getCell(c).value).trim());
      if (vals.some((x) => x !== "")) out.push(vals);
    });
    return out;
  };
  const find = (re) => wb.worksheets.find((w) => re.test(w.name));
  const ms = find(/member|sadasya|सदस्य/i) || wb.worksheets[0];
  const ps = find(/payment|bhugtan|भुगतान|jama/i);
  return { members: ms ? sheetRows(ms) : [], payments: ps && ps !== ms ? sheetRows(ps) : [] };
}

/* ── sample file ─────────────────────────────────────────────────────── */
const EXAMPLE = "उदाहरण — ye line import nahi hogi, apni lines neeche likhein";
export async function sampleWorkbook(program, { agents = [], groups = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MGSF";
  const head = (ws, cols) => {
    ws.columns = cols.map((c) => ({ header: c.label + (c.required ? " *" : ""), key: c.key, width: Math.max(12, c.label.length + 4) }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const m = wb.addWorksheet("Members");
  head(m, MEMBER_COLUMNS);
  const ag = agents[0];
  m.addRow({ registrationNumber: "", applicationNumber: "5501", displayName: "रमेश कुमार", fatherName: "सुरेश कुमार", phone: "9876543210", gender: "male",
    birthDate: "15-08-1995", village: "जोधपुर", district: "जोधपुर", state: "Rajasthan", dateJoin: "01-01-2025", payAmount: program.defaultPayAmount || 200,
    joinFees: 500, joinFeesPaidAmount: 500, agent: ag?.email || ag?.displayName || "", status: "active", note: EXAMPLE });
  m.addRow({ registrationNumber: "", displayName: "सीता देवी", fatherName: "मोहन लाल", phone: "9876500000", gender: "female", birthDate: "02-03-1998",
    village: "पाली", dateJoin: "01-01-2025", payAmount: program.defaultPayAmount || 200, status: "closed", closingDate: "10-06-2025", closingGroup: groups[0]?.name || "June 2025", note: EXAMPLE });
  const p = wb.addWorksheet("Payments");
  head(p, PAYMENT_COLUMNS);
  p.addRow({ note: EXAMPLE, payerRegNo: "(Members wala Reg. No.)", closingRegNo: "(closed member ka Reg. No.)", amount: program.defaultPayAmount || 200, paymentDate: "20-06-2025", method: "cash" });
  const h = wb.addWorksheet("Help");
  h.columns = [{ header: "Column", width: 26 }, { header: "Kya likhein", width: 70 }];
  h.getRow(1).font = { bold: true };
  h.addRow(["Members sheet", "Har sadasya ki ek line. * wale zaroori. Tareekh DD-MM-YYYY (jaise 01-01-2025). Note mein \"उदाहरण\" wali lines chhod di jaati hain."]);
  for (const c of MEMBER_COLUMNS) h.addRow([c.label + (c.required ? " *" : ""), c.hint || ""]);
  h.addRow([]);
  h.addRow(["Payments sheet", "Pehle se jama closing payments. Bharne wala + jis member ki closing thi, dono Reg. No. Members sheet ya panel mein hone chahiye."]);
  for (const c of PAYMENT_COLUMNS) h.addRow([c.label + (c.required ? " *" : ""), c.hint || ""]);
  h.addRow([]);
  h.addRow(["Agents", agents.map((a) => `${a.displayName} (${a.email || a.agentCode || "-"})`).join(", ") || "—"]);
  h.addRow(["Closing groups", groups.map((g) => g.name).join(", ") || "—"]);
  h.addRow(["Status", "active (default) · closed (Closing date zaroori) · blocked"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export function sampleCsv(kind = "members") {
  const cols = kind === "payments" ? PAYMENT_COLUMNS : MEMBER_COLUMNS;
  const ex = kind === "payments"
    ? ["R100001", "R100005", "200", "20-06-2025", "cash", "", EXAMPLE]
    : ["", "5501", "रमेश कुमार", "सुरेश कुमार", "9876543210", "", "male", "15-08-1995", "", "", "", "जोधपुर", "जोधपुर", "Rajasthan", "", "", "", "", "01-01-2025", "200", "500", "500", "", "active", "", "", "", EXAMPLE];
  const esc = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return "\uFEFF" + [cols.map((c) => c.label).map(esc).join(","), ex.map(esc).join(",")].join("\n") + "\n";
}

/* ── check (preview) ─────────────────────────────────────────────────── */
const dateOk = (v) => (v ? fmtISO(toDate(v)) : null);
const numOk = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[₹,\s]/g, "")); return Number.isFinite(n) ? Math.round(n) : NaN; };

/** → { members: [...], payments: [...], errors: [{sheet,row,column,message}], summary } */
export async function checkImport(program, sheets) {
  const errors = [];
  const err = (sheet, row, column, message) => errors.push({ sheet, row, column, message });
  const { rows: agents } = await db.execute(sql`SELECT id, display_name, email, agent_code FROM agents WHERE admin_id = ${program.adminId} AND NOT deleted`);
  const findAgent = (v) => {
    const x = String(v || "").trim().toLowerCase();
    if (!x) return null;
    return agents.find((a) => a.email?.toLowerCase() === x || a.agent_code?.toLowerCase() === x || a.display_name?.toLowerCase() === x) || undefined;
  };
  const { rows: existing } = await db.execute(sql`SELECT id, registration_number, aadhaar_no, display_name, closing_date, date_join FROM members WHERE program_id = ${program.id} AND NOT deleted`);
  const regInDb = new Map(existing.filter((m) => m.registration_number).map((m) => [m.registration_number.toLowerCase(), m]));
  const aadhaarInDb = new Set(existing.filter((m) => m.aadhaar_no).map((m) => m.aadhaar_no));

  const members = [];
  const [mh, ...mrows] = sheets.members || [];
  if (mh) {
    const map = headerMap(mh, MEMBER_COLUMNS);
    for (const c of MEMBER_COLUMNS.filter((x) => x.required)) if (map[c.key] === undefined) err("Members", 1, c.label, `Column "${c.label}" nahi mila`);
    const seenReg = new Set(), seenAadhaar = new Set();
    mrows.forEach((r, i) => {
      const rowNo = i + 2;
      const get = (k) => (map[k] === undefined ? "" : String(r[map[k]] ?? "").trim());
      const m = { _row: rowNo };
      for (const c of MEMBER_COLUMNS) m[c.key] = get(c.key);
      if (/^(उदाहरण|example|udaharan)/i.test(m.note)) return; // the sample's example lines
      if (!m.displayName) { err("Members", rowNo, "Naam", "Naam khaali hai"); return; }
      const dj = dateOk(m.dateJoin);
      if (!dj) err("Members", rowNo, "Join date", `Galat tareekh "${m.dateJoin}" (DD-MM-YYYY)`); else m.dateJoin = dj;
      if (m.birthDate) { const d = dateOk(m.birthDate); if (!d) err("Members", rowNo, "Janam tithi", `Galat tareekh "${m.birthDate}"`); else m.birthDate = d; }
      for (const k of ["payAmount", "joinFees", "joinFeesPaidAmount", "fixedLimit"]) {
        const v = numOk(m[k]);
        if (v > 99999999) { err("Members", rowNo, MEMBER_COLUMNS.find((c) => c.key === k).label, `Rakam bahut badi: "${m[k]}" (galat column? mobile no. to nahi?)`); m[k] = null; continue; }
        if (Number.isNaN(v) || v < 0) { err("Members", rowNo, MEMBER_COLUMNS.find((c) => c.key === k).label, `Number nahi: "${m[k]}"`); m[k] = null; } else m[k] = v;
      }
      if (m.joinFeesPaidAmount && m.joinFees != null && m.joinFeesPaidAmount > m.joinFees) err("Members", rowNo, "Join fee jama", "Jama fee kul fee se zyada");
      const st = (m.status || "active").toLowerCase();
      m.status = ["closed", "close", "vivah", "married", "क्लोज", "बंद"].includes(st) ? "closed" : ["blocked", "block", "ब्लॉक"].includes(st) ? "blocked" : "active";
      if (m.status === "closed") {
        const cd = dateOk(m.closingDate);
        if (!cd) err("Members", rowNo, "Closing date", "Status closed hai to Closing date zaroori (DD-MM-YYYY)");
        else { m.closingDate = cd; if (dj && cd < dj) err("Members", rowNo, "Closing date", "Closing date join date se pehle"); }
      } else m.closingDate = null;
      if (m.agent) { const a = findAgent(m.agent); if (a === undefined) err("Members", rowNo, "Agent", `Agent "${m.agent}" nahi mila (e-mail / code / naam)`); m.agentId = a?.id || null; }
      const reg = m.registrationNumber.toLowerCase();
      if (reg) {
        if (seenReg.has(reg)) err("Members", rowNo, "Reg. No.", `Reg. No. ${m.registrationNumber} file mein do baar`);
        else if (regInDb.has(reg)) err("Members", rowNo, "Reg. No.", `Reg. No. ${m.registrationNumber} yojna mein pehle se (${regInDb.get(reg).display_name})`);
        seenReg.add(reg);
      }
      const ad = m.aadhaarNo.replace(/\s+/g, "");
      if (ad) {
        if (seenAadhaar.has(ad) || aadhaarInDb.has(ad)) err("Members", rowNo, "Aadhaar", `Aadhaar ${ad} pehle se ${aadhaarInDb.has(ad) ? "yojna mein" : "file mein"} hai`);
        seenAadhaar.add(ad); m.aadhaarNo = ad;
      }
      members.push(m);
    });
    // logins: a reg. no. used by any login of any trust
    const regs = members.map((m) => m.registrationNumber.toLowerCase()).filter(Boolean);
    if (regs.length) {
      const { rows } = await db.execute(sql`SELECT login_id FROM accounts WHERE login_id IN (${sql.join(regs.map((x) => sql`${x}`), sql`, `)})`);
      const taken = new Set(rows.map((x) => x.login_id));
      for (const m of members) if (taken.has(m.registrationNumber.toLowerCase())) err("Members", m._row, "Reg. No.", `Reg. No. ${m.registrationNumber} ka login pehle se kisi aur ka hai`);
    }
  }

  const payments = [];
  const [ph, ...prows] = sheets.payments || [];
  if (ph) {
    const map = headerMap(ph, PAYMENT_COLUMNS);
    for (const c of PAYMENT_COLUMNS.filter((x) => x.required)) if (map[c.key] === undefined) err("Payments", 1, c.label, `Column "${c.label}" nahi mila`);
    const fileRegs = new Map(members.filter((m) => m.registrationNumber).map((m) => [m.registrationNumber.toLowerCase(), m]));
    prows.forEach((r, i) => {
      const rowNo = i + 2;
      const get = (k) => (map[k] === undefined ? "" : String(r[map[k]] ?? "").trim());
      const p = { _row: rowNo };
      for (const c of PAYMENT_COLUMNS) p[c.key] = get(c.key);
      if (p.payerRegNo.startsWith("(") || /^(उदाहरण|example|udaharan)/i.test(p.note)) return; // the sample's example line
      const amount = numOk(p.amount);
      if (!(amount > 0) || amount > 99999999) err("Payments", rowNo, "Rakam", `Rakam galat: "${p.amount}"`); else p.amount = amount;
      const d = dateOk(p.paymentDate);
      if (!d) err("Payments", rowNo, "Tareekh", `Galat tareekh "${p.paymentDate}"`); else if (d > fmtISO(todayIST())) err("Payments", rowNo, "Tareekh", "Aage ki tareekh"); else p.paymentDate = d;
      p.method = (p.method || "cash").toLowerCase();
      if (!METHODS.has(p.method)) err("Payments", rowNo, "Tarika", `Tarika "${p.method}" nahi (cash / upi / online / bank / cheque)`);
      for (const [k, label] of [["payerRegNo", "Bharne wala Reg. No."], ["closingRegNo", "Closing wala Reg. No."]]) {
        const x = p[k].toLowerCase();
        if (!x) err("Payments", rowNo, label, "Khaali hai");
        else if (!regInDb.has(x) && !fileRegs.has(x)) err("Payments", rowNo, label, `Reg. No. ${p[k]} na yojna mein mila na Members sheet mein`);
      }
      const cl = regInDb.get(p.closingRegNo.toLowerCase()) || fileRegs.get(p.closingRegNo.toLowerCase());
      if (cl && !(cl.closing_date || cl.closingDate)) err("Payments", rowNo, "Closing wala Reg. No.", `${p.closingRegNo} ki closing nahi hui (Status closed + Closing date chahiye)`);
      const payer = regInDb.get(p.payerRegNo.toLowerCase()) || fileRegs.get(p.payerRegNo.toLowerCase());
      const joined = payer && fmtISO(payer.date_join || payer.dateJoin), closedOn = cl && fmtISO(cl.closing_date || cl.closingDate);
      if (joined && closedOn && joined > closedOn) err("Payments", rowNo, "Bharne wala Reg. No.", `${p.payerRegNo} ne ${joined} ko join kiya — ${p.closingRegNo} ki closing (${closedOn}) uske baad ki nahi, ye bhugtan banta nahi`);
      if (p.payerRegNo && p.payerRegNo.toLowerCase() === p.closingRegNo.toLowerCase()) err("Payments", rowNo, "Bharne wala Reg. No.", "Apni hi closing ka bhugtan nahi");
      payments.push(p);
    });
  }
  const summary = {
    members: members.length, closed: members.filter((m) => m.status === "closed").length, blocked: members.filter((m) => m.status === "blocked").length,
    joinFees: members.reduce((a, m) => a + (m.joinFeesPaidAmount || 0), 0),
    payments: payments.length, paymentAmount: payments.reduce((a, p) => a + (Number(p.amount) || 0), 0), errors: errors.length,
  };
  return { members, payments, errors: errors.slice(0, 2000), summary };
}

/* ── run (background, progress in migration_jobs kind "excel") ───────── */
const g = globalThis;
const errText = (e) => String(e?.cause?.message || e?.message || e).slice(0, 200);
const runningImports = (g.__mgsfImports ??= new Map());

export async function startImport(program, checked, auth, { skipErrorRows = false, fileName = "" } = {}) {
  if (checked.errors.length && !skipErrorRows) throw badRequest(`${checked.errors.length} galtiyan hain — theek karke dobara daalein (ya "galat lines chhod do" chunein)`);
  const bad = new Set(checked.errors.map((e) => `${e.sheet}:${e.row}`));
  const members = checked.members.filter((m) => !bad.has(`Members:${m._row}`));
  const payments = checked.payments.filter((p) => !bad.has(`Payments:${p._row}`));
  if (!members.length && !payments.length) throw badRequest("Import karne ko kuch nahi");
  const id = randomUUID();
  const steps = [
    { key: "members", label: "Members (reg. no., login, dues, join fee)", status: "wait", done: 0, total: members.length, note: "" },
    { key: "closings", label: "Closings (har payer ke dues)", status: "wait", done: 0, total: members.filter((m) => m.status === "closed").length, note: "" },
    { key: "payments", label: "Payments (jama + rasid + commission)", status: "wait", done: 0, total: payments.length, note: "" },
  ];
  await db.execute(sql`
    INSERT INTO migration_jobs (id, kind, source_project, source_trust_id, source_trust_name, target_admin_id, mode, options, status, steps, created_by)
    VALUES (${id}, 'excel', ${fileName.slice(0, 200)}, ${program.id}, ${program.name}, ${program.adminId}, 'append', ${JSON.stringify({ programId: program.id, skipErrorRows })}::jsonb,
            'running', ${JSON.stringify(steps)}::jsonb, ${auth.accountId || ""})`);
  runningImports.set(id, true);
  runImport(id, program, members, payments, steps, auth).finally(() => runningImports.delete(id));
  return { jobId: id };
}

async function runImport(id, program, members, payments, steps, auth) {
  const report = { created: [], closings: 0, payments: 0, paymentAmount: 0, failures: [], logins: [] };
  const log = [];
  let last = 0;
  const save = async (status = "running", force = false, error = "") => {
    if (!force && Date.now() - last < 700) return;
    last = Date.now();
    await db.execute(sql`UPDATE migration_jobs SET status = ${status}, steps = ${JSON.stringify(steps)}::jsonb, log = ${JSON.stringify(log.slice(-300))}::jsonb,
      report = ${JSON.stringify({ ...report, created: report.created.length, createdIds: report.created, logins: report.logins.length })}::jsonb, error = ${error},
      logins_enc = ${report.logins.length ? encrypt(JSON.stringify(report.logins)) : null},
      finished_at = ${status === "running" ? null : new Date().toISOString()}, updated_at = now() WHERE id = ${id}`).catch(() => {});
  };
  const say = (msg, level = "info") => log.push({ t: new Date().toISOString(), level, msg });
  const regToId = new Map();
  try {
    // 1. members — one transaction per 100 rows (a bad row fails only its own chunk, reported)
    steps[0].status = "run";
    const groupIds = new Map();
    const { rows: gs } = await db.execute(sql`SELECT id, name FROM closing_groups WHERE program_id = ${program.id}`);
    for (const x of gs) groupIds.set(x.name.toLowerCase(), x.id);
    for (let i = 0; i < members.length; i += 100) {
      const part = members.slice(i, i + 100);
      try {
        await db.transaction(async (tx) => {
          await lockProgram(tx, program.id);
          for (const m of part) {
            const { rows: [row] } = await tx.execute(sql`
              INSERT INTO members (id, program_id, agent_id, registration_number, application_number, status, display_name, father_name, gender, gotra, jati,
                guardian, guardian_relation, phone, phone_alt, aadhaar_no, birth_date, current_address, village, district, state, pin_code,
                date_join, pay_amount, fixed_limit, join_fees, join_fees_paid_amount, join_fees_remaining_amount, join_fees_done, join_fees_payment_type,
                added_by, added_by_name, note, extra)
              VALUES (gen_random_uuid()::text, ${program.id}, ${m.agentId || null}, ${m.registrationNumber || ""}, ${m.applicationNumber}, 'pending', ${m.displayName},
                ${m.fatherName}, ${m.gender.toLowerCase()}, ${m.gotra}, ${m.jati}, ${m.guardian}, ${m.guardianRelation}, ${m.phone}, ${m.phoneAlt}, ${m.aadhaarNo},
                ${m.birthDate || null}::date, ${m.currentAddress}, ${m.village}, ${m.district}, ${m.state}, ${m.pinCode}, ${m.dateJoin}::date,
                ${m.payAmount ?? program.defaultPayAmount ?? 200}, ${m.fixedLimit || null}, ${m.joinFees || 0}, ${m.joinFeesPaidAmount || 0},
                ${Math.max((m.joinFees || 0) - (m.joinFeesPaidAmount || 0), 0)}, ${(m.joinFees || 0) > 0 && (m.joinFeesPaidAmount || 0) >= (m.joinFees || 0)},
                ${(m.joinFeesPaidAmount || 0) > 0 ? "cash" : ""}, ${m.agentId ? "agent" : "admin"}, ${m.agentId ? "Agent" : "Admin"}, ${m.note},
                ${JSON.stringify({ importedBy: id })}::jsonb)
              RETURNING id`);
            const act = await activate(tx, row.id, {});
            // join fee taken at joining: date it on the join date (not today)
            await tx.execute(sql`UPDATE join_fee_payments SET payment_date = ${m.dateJoin}::date, note = 'Excel import' WHERE member_id = ${row.id}`);
            regToId.set(act.registrationNumber.toLowerCase(), row.id);
            report.created.push(row.id);
            if (act.initialPassword) report.logins.push({ regNo: act.registrationNumber, name: m.displayName, password: act.initialPassword });
            m._id = row.id; m._reg = act.registrationNumber;
          }
        });
      } catch (e) {
        report.failures.push({ sheet: "Members", rows: `${part[0]._row}–${part.at(-1)._row}`, error: errText(e) });
        say(`Members line ${part[0]._row}–${part.at(-1)._row}: ${errText(e)}`, "error");
      }
      steps[0].done = Math.min(i + 100, members.length);
      steps[0].note = `${report.created.length} bane`;
      await save();
    }
    steps[0].status = "done"; say(`${report.created.length} members bane`);

    // 2. closings (date order: dues for every payer by the rule, new members included)
    steps[1].status = "run";
    const closed = members.filter((m) => m._id && m.status === "closed").sort((a, b) => a.closingDate.localeCompare(b.closingDate));
    for (const m of closed) {
      try {
        let groupId = null;
        if (m.closingGroup) {
          groupId = groupIds.get(m.closingGroup.toLowerCase());
          if (!groupId) {
            const { rows: [gr] } = await db.execute(sql`INSERT INTO closing_groups (id, program_id, name) VALUES (gen_random_uuid()::text, ${program.id}, ${m.closingGroup}) RETURNING id`);
            groupId = gr.id; groupIds.set(m.closingGroup.toLowerCase(), groupId);
          }
        }
        await recordClosing(m._id, { closingDate: m.closingDate, closingGroupId: groupId, closingNotes: "Excel import" });
        report.closings++;
      } catch (e) { report.failures.push({ sheet: "Members", rows: String(m._row), error: `closing: ${errText(e)}` }); }
      steps[1].done++; await save();
    }
    for (const m of members.filter((x) => x._id && x.status === "blocked")) await setBlocked(m._id, true).catch(() => {});
    steps[1].status = "done";

    // 3. payments
    steps[2].status = "run";
    const { rows: regRows } = await db.execute(sql`SELECT id, lower(registration_number) AS reg FROM members WHERE program_id = ${program.id} AND NOT deleted AND registration_number IS NOT NULL`);
    for (const r of regRows) if (!regToId.has(r.reg)) regToId.set(r.reg, r.id);
    const usedRefs = new Set();
    for (const p of payments) {
      try {
        const payerId = regToId.get(p.payerRegNo.toLowerCase());
        const closingId = regToId.get(p.closingRegNo.toLowerCase());
        if (!payerId || !closingId) throw new Error("member nahi mila");
        const ref = p.reference && !usedRefs.has(p.reference) ? p.reference : "";
        if (ref) usedRefs.add(ref);
        const r = await paySingle({ programId: program.id, payerId, closingIds: [closingId], customTotalAmount: p.amount, paymentMethod: p.method,
          paymentDate: p.paymentDate, onlineReference: ref, note: [p.note, p.reference && !ref ? `Ref ${p.reference}` : "", "Excel import"].filter(Boolean).join(" · ") }, auth);
        report.payments++; report.paymentAmount += r.totalPaid;
      } catch (e) { report.failures.push({ sheet: "Payments", rows: String(p._row), error: errText(e) }); }
      steps[2].done++; await save();
    }
    steps[2].status = "done";
    say(`Poora: ${report.created.length} members, ${report.closings} closings, ${report.payments} payments (₹${report.paymentAmount}) · ${report.failures.length} nahi hue`);
    await save("done", true);
  } catch (e) {
    say(e.message, "error");
    await save("failed", true, String(e?.message || e).slice(0, 500));
  }
}

export async function getImport(adminId, id) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM migration_jobs WHERE id = ${id} AND kind = 'excel' AND target_admin_id = ${adminId}`);
  if (!r) throw notFound("Import nahi mila");
  if (r.status === "running" && !runningImports.has(id)) r.status = "failed";
  const { logins_enc, ...rest } = r;
  rest.hasLogins = !!logins_enc;
  if (rest.report?.createdIds) rest.report.createdIds = undefined;
  return rest;
}

export async function listImports(adminId, programId) {
  const { rows } = await db.execute(sql`
    SELECT id, source_project AS file, status, steps, report->'created' AS created, report->'payments' AS payments, report->'undone' AS undone, started_at, finished_at
    FROM migration_jobs WHERE kind = 'excel' AND target_admin_id = ${adminId} AND source_trust_id = ${programId} ORDER BY started_at DESC LIMIT 20`);
  return rows;
}

/** Undo: remove every member this import created (with their dues / payments / logins). Refused if any of them got money later from outside the import. */
export async function undoImport(adminId, id) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM migration_jobs WHERE id = ${id} AND kind = 'excel' AND target_admin_id = ${adminId}`);
  if (!r) throw notFound("Import nahi mila");
  if (r.status === "running") throw badRequest("Import abhi chal raha hai");
  if (r.report?.undone) throw badRequest("Ye import pehle hi hata diya gaya");
  const ids = r.report?.createdIds || [];
  if (!ids.length) throw badRequest("Is import ne koi member nahi banaya");
  const list = sql.join(ids.map((x) => sql`${x}`), sql`, `);
  return db.transaction(async (tx) => {
    await lockProgram(tx, r.source_trust_id);
    const { rows: [x] } = await tx.execute(sql`
      SELECT count(*)::int AS n FROM transactions t WHERE (t.payer_member_id IN (${list}) OR t.closing_member_id IN (${list})) AND t.status = 'completed'
        AND NOT (t.note LIKE '%Excel import%')`);
    if (x.n) throw badRequest(`In members par import ke baad ${x.n} aur payment hue hain — pehle unhe reverse karein`);
    await tx.execute(sql`DELETE FROM accounts WHERE member_id IN (${list})`);
    // old members' payments FOR an imported closing (made by this import) go too — dues of those closings cascade with the member
    await tx.execute(sql`DELETE FROM transactions WHERE closing_member_id IN (${list}) OR payer_member_id IN (${list})`);
    await tx.execute(sql`DELETE FROM agent_commissions WHERE member_id IN (${list}) OR closing_member_id IN (${list})`);
    const del = await tx.execute(sql`DELETE FROM members WHERE id IN (${list})`);
    await tx.execute(sql`UPDATE migration_jobs SET report = report || jsonb_build_object('undone', true, 'undoneAt', now()), updated_at = now() WHERE id = ${id}`);
    return { success: true, removed: del.rowCount ?? 0 };
  });
}

export async function importLoginsCsv(adminId, id) {
  const { rows: [r] } = await db.execute(sql`SELECT logins_enc FROM migration_jobs WHERE id = ${id} AND kind = 'excel' AND target_admin_id = ${adminId}`);
  if (!r?.logins_enc) throw notFound("Passwords file nahi hai (delete ho chuki ya bani hi nahi)");
  return memberLoginsCsv(JSON.parse(decrypt(r.logins_enc)));
}
export async function dropImportLogins(adminId, id) {
  await db.execute(sql`UPDATE migration_jobs SET logins_enc = NULL, updated_at = now() WHERE id = ${id} AND kind = 'excel' AND target_admin_id = ${adminId}`);
  return { success: true };
}
const memberLoginsCsv = (list) => "\uFEFFregNo,name,password\n" + (list || []).map((l) => [l.regNo, `"${String(l.name || "").replace(/"/g, "'")}"`, l.password].join(",")).join("\n");

/* ── checked files waiting for "Import" (token → result, 30 min) ─────── */
const pending = (g.__mgsfImportChecks ??= new Map());
export async function checkUpload(program, buf, fileName) {
  if (buf.length > 15 * 1024 * 1024) throw badRequest("File 15 MB se badi hai");
  let sheets;
  try { sheets = await readWorkbook(buf, fileName); } catch { throw badRequest("File padh nahi paaye — .xlsx ya .csv daalein"); }
  if (!(sheets.members.length > 1) && !(sheets.payments.length > 1)) throw badRequest("File mein koi line nahi mili (pehli line = column naam)");
  const checked = await checkImport(program, sheets);
  for (const [k, v] of pending) if (Date.now() - v.at > 30 * 60e3) pending.delete(k);
  const token = randomUUID();
  pending.set(token, { at: Date.now(), programId: program.id, checked, fileName });
  const pick = (m) => ({ row: m._row, regNo: m.registrationNumber || "(naya)", name: m.displayName, father: m.fatherName, village: m.village, dateJoin: m.dateJoin,
    kist: m.payAmount, joinFee: m.joinFees, joinFeePaid: m.joinFeesPaidAmount, status: m.status, closingDate: m.closingDate });
  return { token, fileName, summary: checked.summary, errors: checked.errors,
    members: checked.members.slice(0, 200).map(pick), payments: checked.payments.slice(0, 200).map((p) => ({ row: p._row, payer: p.payerRegNo, closing: p.closingRegNo, amount: p.amount, date: p.paymentDate, method: p.method })) };
}
export async function startChecked(program, token, auth, { skipErrorRows = false } = {}) {
  const c = pending.get(token);
  if (!c || c.programId !== program.id) throw badRequest("Jaanch purani ho gayi — file dobara daalein");
  const r = await startImport(program, c.checked, auth, { skipErrorRows, fileName: c.fileName });
  pending.delete(token);
  return r;
}
