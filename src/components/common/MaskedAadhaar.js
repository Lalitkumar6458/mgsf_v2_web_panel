"use client";
// Aadhaar shown as "XXXX XXXX 1234" — click the eye to see the full number (and it hides again).
import { useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { useFeature } from "@/lib/AuthProvider";

export const maskAadhaar = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : "XXXX";
};
const spaced = (v) => String(v || "").replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");

export default function MaskedAadhaar({ value, empty = "-" }) {
  const [show, setShow] = useState(false);
  const maskOn = useFeature()("aadhaarMask");
  if (!value) return <span>{empty}</span>;
  if (!maskOn) return <span className="tabular-nums">{spaced(value)}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {show ? spaced(value) : maskAadhaar(value)}
      <button type="button" className="text-gray-400 hover:text-gray-700" onClick={(e) => { e.stopPropagation(); setShow((s) => !s); }}
        aria-label={show ? "Chhupao" : "Dikhao"}>
        {show ? <FiEyeOff size={13} /> : <FiEye size={13} />}
      </button>
    </span>
  );
}
