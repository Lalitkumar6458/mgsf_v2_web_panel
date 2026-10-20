// Shared helpers for moving data from a Firebase project into this database.
// Both sources (old MGSF panel, new-trust-project) first build a "bundle" — plain rows with the exact
// column names of our tables — and writer.js writes a bundle in ONE Postgres transaction.
import { toDate, fmtISO } from "../../lib/dates.js";

export const isTs = (v) => v && typeof v === "object" && (typeof v.toDate === "function" || (typeof v._seconds === "number" && typeof v._nanoseconds === "number"));
export const tsToDate = (v) => (typeof v.toDate === "function" ? v.toDate() : new Date(v._seconds * 1000));

/** Firestore data → JSON-safe (Timestamps → ISO, refs → path, no \u0000). */
export function plain(v) {
  if (v == null) return v ?? null;
  if (isTs(v)) return tsToDate(v).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v.replace(/\u0000/g, "");
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") {
    if (typeof v.path === "string" && v.firestore) return v.path; // DocumentReference
    if (typeof v.latitude === "number" && typeof v.longitude === "number") return { lat: v.latitude, lng: v.longitude };
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}

export const s = (v) => (v == null || v === "N/A" || v === "NA" ? "" : String(plain(v)).trim());
export const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x) : d; };
export const b = (v, d = false) => (v === undefined || v === null ? d : v === true || v === "true" || v === 1);
/** any date-ish value (DD-MM-YYYY, ISO, Timestamp, ms) → "YYYY-MM-DD" or null */
export const day = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return msDay(v);
  return fmtISO(toDate(isTs(v) ? { toDate: () => tsToDate(v) } : v)) || null;
};
export const ts = (v) => {
  if (!v) return null;
  if (isTs(v)) return tsToDate(v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
/** epoch ms → the India calendar day (dates are stored as IST midnight in Firestore) */
export function msDay(ms) {
  const x = Number(ms);
  if (!Number.isFinite(x) || x <= 0) return null;
  return new Date(x + 5.5 * 3600e3).toISOString().slice(0, 10);
}
export const without = (obj, keys) => { const o = { ...obj }; for (const k of keys) delete o[k]; return plain(o); };
export const json = (v) => JSON.stringify(plain(v ?? null));

/** Every Firebase Storage URL we may copy: http(s) only, not data: / our own files. */
export const isRemoteFile = (u) => typeof u === "string" && /^https?:\/\//i.test(u) && !/\/api\/files\//.test(u);

/** Collects warnings + skipped counters while building a bundle. */
export function makeReport() {
  const warnings = [];
  const skipped = {};
  return {
    warnings, skipped,
    warn: (msg) => { if (warnings.length < 5000) warnings.push(String(msg)); },
    skip: (k, msg) => { skipped[k] = (skipped[k] || 0) + 1; if (msg && warnings.length < 5000) warnings.push(String(msg)); },
  };
}

/** Empty bundle: rows per table (column names = our DB columns). */
export function emptyBundle() {
  return {
    admin: null, agents: [], programs: [], groups: [], members: [], dues: [], transactions: [], joinFees: [],
    payouts: [], commissions: [], accounts: [], files: [], counts: {}, money: {}, warnings: [], skipped: {},
  };
}

/** Bundle row counts for the progress screen. */
export function countBundle(bundle) {
  return {
    programs: bundle.programs.length, agents: bundle.agents.length, closingGroups: bundle.groups.length, members: bundle.members.length,
    closings: bundle.members.filter((m) => m.closing_date).length, dues: bundle.dues.length,
    transactions: bundle.transactions.length, joinFeePayments: bundle.joinFees.length,
    commissions: bundle.commissions.length, payouts: bundle.payouts.length, logins: bundle.accounts.length, files: bundle.files.length,
  };
}

/* ── integer columns: Postgres "integer" holds only −2,147,483,648 … 2,147,483,647 ──────────────
 * Old Firebase data sometimes has a phone number / timestamp / reg. no. where a count or amount was
 * expected → "integer out of range" on write. Fix it in the check step (dry run shows it too). */
export const INT_MAX = 2147483647;
const INT_COLS = {
  programs: { counters: ["reg_counter", "member_counter", "reg_start_no", "reg_digits", "due_days"], money: ["default_pay_amount"] },
  members: { counters: ["member_number", "closing_months"], money: ["pay_amount", "join_fees", "join_fees_paid_amount", "join_fees_remaining_amount", "fixed_limit"] },
  dues: { counters: [], money: ["amount", "paid_amount", "base_amount"] },
  transactions: { counters: ["sequence_number"], money: ["amount"] },
  joinFees: { counters: [], money: ["amount"] },
  commissions: { counters: [], money: ["base_amount"] },
  payouts: { counters: ["commission_count"], money: [] },
};
const FALLBACK = { reg_digits: 6, reg_start_no: 1, sequence_number: 1 };
/** clamps counters, zeroes impossible amounts (before reconcile, so the money still adds up). → number of fixes */
export function fitInts(bundle) {
  let fixed = 0;
  const label = { programs: "yojna", members: "member", dues: "due", transactions: "transaction", joinFees: "join fee", commissions: "commission", payouts: "payout" };
  for (const [key, spec] of Object.entries(INT_COLS)) {
    for (const row of bundle[key] || []) {
      for (const col of [...spec.counters, ...spec.money]) {
        const v = row[col];
        if (v === undefined || v === null) continue;
        const x = Number(v);
        if (Number.isFinite(x) && Number.isInteger(x) && Math.abs(x) <= INT_MAX) continue;
        if (Number.isFinite(x) && Math.abs(x) <= INT_MAX) { row[col] = Math.round(x); continue; }
        const money = spec.money.includes(col);
        row[col] = money ? 0 : (col in FALLBACK ? FALLBACK[col] : (col === "member_number" ? null : 0));
        fixed++;
        bundle.warnings.push(`${label[key]} ${row.id || row.name || ""}${row.display_name ? ` (${row.display_name})` : ""}: ${col} = ${String(v).slice(0, 25)} bahut bada / galat → ${row[col] ?? "khaali"}${money ? " (rakam galat thi — panel mein jaanch lein)" : ""}`);
      }
    }
  }
  // member_number null → next free numbers after the max
  const mx = Math.max(0, ...(bundle.members || []).map((m) => (Number.isInteger(m.member_number) ? m.member_number : 0)));
  let next = mx;
  for (const m of bundle.members || []) if (m.member_number === null) m.member_number = ++next;
  if (fixed) bundle.skipped = { ...(bundle.skipped || {}), badNumbers: fixed };
  return fixed;
}
