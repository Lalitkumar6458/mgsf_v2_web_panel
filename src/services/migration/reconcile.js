// Make a bundle's money agree with itself before it is written, the same invariant the live app keeps:
//   due.paid_amount = sum of its completed transactions,  status from paid vs amount,  paid ≤ amount.
// Where the source disagrees with itself (old data), money is never dropped:
//   • transactions worth more than the due says → the due takes the transactions' total
//   • the due says more is paid than any transaction shows → a "migration" transaction fills the gap
//   • a completed transaction with no due → a due is made for it
// Every such fix is counted and written in the report, so the office can check those members.
import { fmtISO } from "../../lib/dates.js";
import { countBundle } from "./common.js";

export function reconcile(bundle) {
  const fixes = { dueRaisedToTransactions: 0, migrationTransactions: 0, migrationAmount: 0, duesMadeForTransactions: 0, amountRaised: 0, linked: 0 };
  const warn = (m) => bundle.warnings.length < 5000 && bundle.warnings.push(m);
  const duesById = new Map(bundle.dues.map((d) => [d.id, d]));
  const duesByPair = new Map(bundle.dues.map((d) => [`${d.payer_member_id}|${d.closing_member_id}`, d]));
  const names = new Map(bundle.members.map((m) => [m.id, `${m.display_name} (${m.registration_number || "—"})`]));

  // link transactions to their due
  for (const t of bundle.transactions) {
    if (t.transaction_type && t.transaction_type !== "marriage_payment") continue;
    if (t.due_id && duesById.has(t.due_id)) continue;
    const d = t.closing_member_id ? duesByPair.get(`${t.payer_member_id}|${t.closing_member_id}`) : null;
    if (d) { t.due_id = d.id; fixes.linked++; continue; }
    t.due_id = null;
    if (t.status !== "completed" || !t.closing_member_id || !(t.amount > 0)) continue;
    const nd = {
      id: `mig-${t.id}`.slice(0, 120), program_id: t.program_id, closing_member_id: t.closing_member_id, payer_member_id: t.payer_member_id,
      amount: 0, paid_amount: 0, status: "pending", due_date: t.payment_date, added_manually: true, paid_at: null,
      payment_method: t.payment_method, online_reference: t.online_reference || "", created_at: new Date(), updated_at: new Date(),
    };
    bundle.dues.push(nd); duesById.set(nd.id, nd); duesByPair.set(`${nd.payer_member_id}|${nd.closing_member_id}`, nd);
    t.due_id = nd.id;
    fixes.duesMadeForTransactions++;
  }

  const sums = new Map();
  const lastDay = new Map();
  for (const t of bundle.transactions) {
    if (t.status !== "completed" || !t.due_id) continue;
    sums.set(t.due_id, (sums.get(t.due_id) || 0) + t.amount);
    if (!lastDay.has(t.due_id) || t.payment_date > lastDay.get(t.due_id)) lastDay.set(t.due_id, t.payment_date);
  }
  for (const d of bundle.dues) {
    const txSum = sums.get(d.id) || 0;
    if (txSum > d.paid_amount) {
      if (d.paid_amount > 0 || d.amount > 0) fixes.dueRaisedToTransactions++;
      d.paid_amount = txSum;
    } else if (d.paid_amount > txSum) {
      const gap = d.paid_amount - txSum;
      const dayPaid = (d.paid_at ? fmtISO(new Date(d.paid_at)) : null) || d.due_date || fmtISO(new Date());
      bundle.transactions.push({
        id: `mig-${d.id}`.slice(0, 120), program_id: d.program_id, transaction_number: `MIG-${String(d.id).slice(-10).toUpperCase()}`,
        batch_id: `MIG-${d.payer_member_id}`.slice(0, 120), sequence_number: 1, payer_member_id: d.payer_member_id, closing_member_id: d.closing_member_id,
        due_id: d.id, amount: gap, is_full_payment: d.paid_amount >= d.amount, payment_method: "other", payment_date: dayPaid,
        note: "पुराना हिसाब — जमा दर्ज था, रसीद नहीं मिली (migration)", online_reference: "", online_verified: false,
        transaction_type: "marriage_payment", bulk_payment_mode: "migration", status: "completed", created_by_id: "",
        extra: JSON.stringify({ migrationFill: true }), created_at: new Date(),
      });
      fixes.migrationTransactions++; fixes.migrationAmount += gap;
      if (!lastDay.has(d.id)) lastDay.set(d.id, dayPaid);
    }
    if (d.paid_amount > d.amount) {
      if (d.amount > 0) warn(`${names.get(d.payer_member_id) || d.payer_member_id}: closing ${names.get(d.closing_member_id) || ""} mein ₹${d.paid_amount} jama, due ₹${d.amount} tha → due ₹${d.paid_amount}`);
      fixes.amountRaised++;
      d.amount = d.paid_amount;
    }
    d.status = d.paid_amount <= 0 ? "pending" : d.paid_amount >= d.amount ? "paid" : "partial";
    d.paid_date = d.status === "paid" ? lastDay.get(d.id) || null : null;
    if (d.status === "pending") d.paid_at = null;
    else if (!d.paid_at) d.paid_at = new Date(`${lastDay.get(d.id) || d.due_date || fmtISO(new Date())}T12:00:00+05:30`);
  }
  // a due with nothing to pay and nothing paid is noise
  bundle.dues = bundle.dues.filter((d) => d.amount > 0 || d.paid_amount > 0);
  if (fixes.migrationTransactions) warn(`${fixes.migrationTransactions} dues mein jama likha tha par rasid / transaction nahi mili — ₹${fixes.migrationAmount} ki "migration" entries banayi (Payment history mein "MIG-…")`);
  if (fixes.duesMadeForTransactions) warn(`${fixes.duesMadeForTransactions} transactions ka due nahi tha — due bana diya taaki paisa hisaab mein rahe`);
  bundle.reconcile = fixes;
  bundle.counts = countBundle(bundle);
  return bundle;
}
