"use client";
// WhatsApp messages without any paid API: opens WhatsApp (app or web) with the number and the
// text already filled in — the user just presses Send.
import { useEffect, useState } from "react";
import { api } from "./api";

/** wa.me link for an Indian mobile number, or null when the number is not usable */
export function waUrl(phone, text) {
  const d = String(phone || "").replace(/\D/g, "");
  const ten = d.length >= 10 ? d.slice(-10) : "";
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return `https://wa.me/91${ten}?text=${encodeURIComponent(text)}`;
}

const rs = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** Pending dues reminder (Hindi), with the trust's UPI id when Settings → Rasid has one. */
export function reminderText({ name, trustName, programName, count, amount, lastDate, upiId, closings = [] }) {
  return [
    `नमस्ते ${name || ""} जी,`,
    `${trustName ? `${trustName} — ` : ""}${programName || ""} योजना में आपका ${count > 1 ? `${count} सहयोग राशि` : "सहयोग राशि"} बकाया है।`,
    closings.length ? closings.slice(0, 5).map((c) => `• ${c}`).join("\n") : "",
    `कुल बकाया: ${rs(amount)}${lastDate ? ` (अंतिम तिथि: ${lastDate})` : ""}`,
    upiId ? `UPI से भुगतान: ${upiId}` : "",
    "कृपया जल्द भुगतान करें। धन्यवाद 🙏",
  ].filter(Boolean).join("\n");
}

/** Paid receipt — sends the verify link of the printed rasid. */
export function receiptText({ name, trustName, receiptNo, amount, verifyUrl }) {
  return [
    `नमस्ते ${name || ""} जी,`,
    `${trustName || "ट्रस्ट"} — आपका ${rs(amount)} का भुगतान प्राप्त हुआ।${receiptNo ? ` रसीद न. ${receiptNo}` : ""}`,
    verifyUrl ? `रसीद जाँचें: ${verifyUrl}` : "",
    "धन्यवाद 🙏",
  ].filter(Boolean).join("\n");
}

/** The trust's UPI id (Settings → Rasid) — empty for users who cannot read trust settings. */
export function useTrustUpi() {
  const [upi, setUpi] = useState("");
  useEffect(() => {
    let alive = true;
    api.get("/trust/receipt-settings").then((r) => { if (alive) setUpi(r.settings?.upiId || ""); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return upi;
}
