// Agent commission — pure helpers shared by the server (services/commissions.js) and the browser
// (agent form, commission tab). No imports, so node tests and client bundles can both use it.
//
// Agent config (agents.commission, jsonb):
//   { enabled, joinFees: { enabled, type: "percentage" | "fixed", value }, closing: { enabled, type, value } }
//
// How a rule is applied to one payment:
//   percentage → payment × value / 100
//   fixed      → value for a full payment (whole join fee / whole closing due); a part payment
//                earns the same share (₹100 fixed, ₹100 of a ₹200 due paid → ₹50)
//   never more than the payment itself, rounded to paise.

export const COMMISSION_SOURCE = { JOIN_FEES: "join_fees", CLOSING: "closing" };
export const COMMISSION_TYPE = { PERCENTAGE: "percentage", FIXED: "fixed" };
export const COMMISSION_STATUS = { PENDING: "pending", PAID: "paid", CANCELLED: "cancelled" };

export const DEFAULT_JOIN_FEES_PERCENT = 20;
export const DEFAULT_CLOSING_PERCENT = 5;

/** What a new agent gets in the Add Agent form */
export const DEFAULT_COMMISSION_CONFIG = Object.freeze({
  enabled: true,
  joinFees: { enabled: true, type: COMMISSION_TYPE.PERCENTAGE, value: DEFAULT_JOIN_FEES_PERCENT },
  closing: { enabled: true, type: COMMISSION_TYPE.PERCENTAGE, value: DEFAULT_CLOSING_PERCENT },
});

export const SOURCE_LABEL = { join_fees: "Join fees", closing: "Closing payment" };
export const SOURCE_LABEL_HI = { join_fees: "नामांकन शुल्क", closing: "विवाह सहयोग" };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rule = (raw, defValue) => {
  const type = raw?.type === COMMISSION_TYPE.FIXED ? COMMISSION_TYPE.FIXED : COMMISSION_TYPE.PERCENTAGE;
  let value = raw?.value === undefined || raw?.value === null || raw?.value === "" ? defValue : num(raw.value);
  value = Math.max(0, type === COMMISSION_TYPE.PERCENTAGE ? Math.min(value, 100) : value);
  return { enabled: raw?.enabled !== false, type, value: Math.round(value * 100) / 100 };
};

/**
 * Clean config from anything (agent row, form, API body). Missing / empty config = commission OFF
 * (agents that existed before this feature are not paid commission until the admin turns it on).
 */
export function normalizeCommission(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: c.enabled === true,
    joinFees: rule(c.joinFees, DEFAULT_JOIN_FEES_PERCENT),
    closing: rule(c.closing, DEFAULT_CLOSING_PERCENT),
  };
}

/** Is this source switched on for the agent? */
export function sourceRule(config, source) {
  const c = normalizeCommission(config);
  const r = source === COMMISSION_SOURCE.CLOSING ? c.closing : c.joinFees;
  return c.enabled && r.enabled && r.value > 0 ? r : null;
}

/**
 * Commission for one payment.
 * @param config  agent commission config
 * @param source  "join_fees" | "closing"
 * @param paid    amount of this payment
 * @param full    full amount (whole join fee / whole due) — used by "fixed"
 */
export function calcCommission(config, source, paid, full) {
  const r = sourceRule(config, source);
  const base = num(paid);
  if (!r || base <= 0) return { amount: 0, type: r?.type || null, value: r?.value || 0, applicable: false };
  let amount = r.type === COMMISSION_TYPE.FIXED
    ? (num(full) > 0 ? (r.value * base) / num(full) : r.value)
    : (base * r.value) / 100;
  amount = Math.min(Math.round(amount * 100) / 100, base);
  return { amount, type: r.type, value: r.value, applicable: amount > 0 };
}

export const rateLabel = (type, value) =>
  type === COMMISSION_TYPE.FIXED ? `₹${num(value).toLocaleString("en-IN")}` : `${num(value)}%`;

/** "Join fees 20% · Closing 5%" / "Off" */
export function commissionSummaryText(config) {
  const c = normalizeCommission(config);
  if (!c.enabled) return "Off";
  const parts = [];
  if (c.joinFees.enabled) parts.push(`Join fees ${rateLabel(c.joinFees.type, c.joinFees.value)}`);
  if (c.closing.enabled) parts.push(`Closing ${rateLabel(c.closing.type, c.closing.value)}`);
  return parts.length ? parts.join(" · ") : "Off";
}

export const money = (v) => `₹${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
