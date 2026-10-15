"use client";
import dayjs from "dayjs";
import { amountsHidden, MASK } from "@/lib/client/privacy";

export const KIND = {
  on_time: { label: "Time par", color: "green", hex: "#0a7d0a" },
  late: { label: "Late bhara", color: "orange", hex: "#b35c00" },
  overdue: { label: "Baki (overdue)", color: "red", hex: "#c62828" },
  not_due: { label: "Abhi time hai", color: "blue", hex: "#1f5fbf" },
};

/** real amount — PDFs / CSVs */
export const rsPdf = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
/** on screen: hidden until the eye is clicked */
export const rs = (v) => (amountsHidden() ? MASK : rsPdf(v));
export const d = (v) => (v ? dayjs(v).format("DD-MM-YYYY") : "—");

const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** headers: string[], rows: any[][] */
export function downloadCsv(name, headers, rows) {
  const text = "﻿" + [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}-${dayjs().format("YYYY-MM-DD")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function Tile({ label, value, sub, tone = "gray", onClick, active }) {
  const tones = {
    gray: "bg-white border-gray-200", green: "bg-emerald-50 border-emerald-100", orange: "bg-amber-50 border-amber-100",
    red: "bg-red-50 border-red-100", blue: "bg-blue-50 border-blue-100", indigo: "bg-indigo-50 border-indigo-100",
  };
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`text-left rounded-xl border p-3.5 transition ${tones[tone]} ${onClick ? "hover:shadow-sm cursor-pointer" : "cursor-default"} ${active ? "ring-2 ring-indigo-400" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-gray-500 mt-0.5">{sub}</div> : null}
    </button>
  );
}

export const PDF_ROW_LIMIT = 1000; // bigger lists → CSV (a browser-made PDF of 1000 rows ≈ 35 pages, ~30 sec)
