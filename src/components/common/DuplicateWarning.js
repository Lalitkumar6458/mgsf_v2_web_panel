"use client";
// Shown inside the Add / Edit member forms: members of this trust (any yojna) with the same
// Aadhaar, mobile, or name + father's name — so the same person is not added twice by mistake.
import { useEffect, useRef, useState } from "react";
import { Form, Tag } from "antd";
import { FiAlertTriangle } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { useFeature } from "@/lib/AuthProvider";

const REASON = { aadhaar: { label: "Same Aadhaar", color: "red" }, phone: { label: "Same mobile", color: "orange" }, name: { label: "Same naam + pita", color: "gold" } };
const STATUS = { accepted: "Sakriya", pending: "Request", closed: "Closed", blocked: "Blocked" };

export default function DuplicateWarning({ form, excludeId }) {
  const aadhaarNo = Form.useWatch("aadhaarNo", form);
  const phone = Form.useWatch("phone", form);
  const name = Form.useWatch("displayName", form);
  const fatherName = Form.useWatch("fatherName", form);
  const [matches, setMatches] = useState([]);
  const t = useRef(null);
  const on = useFeature()("duplicateCheck");

  useEffect(() => {
    clearTimeout(t.current);
    const a = String(aadhaarNo || "").replace(/\D/g, ""), p = String(phone || "").replace(/\D/g, "");
    const ready = a.length === 12 || p.length === 10 || (String(name || "").trim().length > 1 && String(fatherName || "").trim().length > 1);
    if (!ready || !on) { setMatches([]); return; }
    t.current = setTimeout(() => {
      api.get("/members/duplicates", { aadhaarNo: a.length === 12 ? a : undefined, phone: p.length === 10 ? p : undefined, name, fatherName, excludeId })
        .then((r) => setMatches(r.matches || []))
        .catch(() => setMatches([]));
    }, 600);
    return () => clearTimeout(t.current);
  }, [aadhaarNo, phone, name, fatherName, excludeId, on]);

  if (!matches.length) return null;
  const strong = matches.some((m) => m.reasons.includes("aadhaar"));
  return (
    <div className={`rounded-xl border px-3.5 py-3 mb-4 ${strong ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
      <div className={`flex items-center gap-2 font-semibold text-sm ${strong ? "text-red-800" : "text-amber-900"}`}>
        <FiAlertTriangle /> {strong ? "Ye Aadhaar pehle se kisi member ka hai" : "Milte-julte member pehle se hain — dobara to nahi jod rahe?"}
      </div>
      <div className="mt-2 space-y-1.5">
        {matches.slice(0, 6).map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] bg-white/70 rounded-lg px-2.5 py-1.5">
            <b className="text-gray-900">{m.displayName}</b>
            {m.fatherName && <span className="text-gray-500">/ {m.fatherName}</span>}
            {m.village && <span className="text-gray-500">· {m.village}</span>}
            <span className="text-gray-500">· {m.programName}{m.registrationNumber ? ` · ${m.registrationNumber}` : ""}</span>
            <span className="text-gray-400">· {STATUS[m.status] || m.status}</span>
            <span className="flex-1" />
            {m.reasons.map((r) => <Tag key={r} color={REASON[r]?.color} className="!m-0">{REASON[r]?.label || r}</Tag>)}
          </div>
        ))}
        {matches.length > 6 && <div className="text-xs text-gray-500">…aur {matches.length - 6}</div>}
      </div>
    </div>
  );
}
