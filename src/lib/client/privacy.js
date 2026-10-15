"use client";
// Hide money (and dashboard counts) on screen until the user clicks the eye.
// One switch for the whole app: the eye in the top bar or a click on any hidden value shows / hides all.
// Choice is remembered in this browser (default: hidden). PDFs / CSVs always contain the real numbers.
import { useSyncExternalStore } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";

const KEY = "mgsf.hideAmounts";
let hidden = true;
try { const v = localStorage.getItem(KEY); if (v !== null) hidden = v === "1"; } catch { /* private mode / server */ }
const subs = new Set();

export const amountsHidden = () => hidden;
export function setAmountsHidden(v) {
  hidden = !!v;
  try { localStorage.setItem(KEY, hidden ? "1" : "0"); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export const toggleAmounts = () => setAmountsHidden(!hidden);
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

/** re-render when the switch changes; returns true while hidden */
export function useAmountsHidden() {
  return useSyncExternalStore(subscribe, () => hidden, () => true);
}

export const MASK = "₹ ••••";
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "₹1,23,400" or "₹ ••••" (call inside a component that uses useAmountsHidden) */
export const showMoney = (n) => (hidden ? MASK : inr(n));
/** counts on the dashboard */
export const showCount = (n) => (hidden ? "••" : Number(n || 0).toLocaleString("en-IN"));

/** Inline amount: click to reveal / hide everywhere */
export function Amt({ v, children, className = "", title = "Click: show / hide amounts" }) {
  const h = useAmountsHidden();
  return (
    <span
      role="button" tabIndex={0} title={title}
      onClick={(e) => { e.stopPropagation(); toggleAmounts(); }}
      onKeyDown={(e) => { if (e.key === "Enter") toggleAmounts(); }}
      className={`cursor-pointer select-none tabular-nums ${className}`}
    >
      {h ? <span className="tracking-wider text-gray-400">{MASK}</span> : children ?? inr(v)}
    </span>
  );
}

/** Eye button (top bar, page headers) */
export function AmountsEye({ className = "", size = 18, label = false }) {
  const h = useAmountsHidden();
  const Icon = h ? FiEyeOff : FiEye;
  return (
    <button type="button" onClick={toggleAmounts} title={h ? "Amounts dikhayein" : "Amounts chhupayein"}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-gray-600 hover:bg-gray-100 ${className}`}>
      <Icon size={size} />
      {label && <span className="text-sm">{h ? "Show amounts" : "Hide amounts"}</span>}
    </button>
  );
}
