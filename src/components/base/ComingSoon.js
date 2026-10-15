"use client";
import { FiClock } from "react-icons/fi";

/** Shown for screens that are still being moved from Firebase to the new API. */
export default function ComingSoon({ title = "यह स्क्रीन", note }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>
      <FiClock size={36} style={{ marginBottom: 12, color: "#1d4ed8" }} />
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <p style={{ fontSize: 14 }}>
        {note || "यह स्क्रीन नए सिस्टम (Firebase के बिना) पर अगले अपडेट में आ रही है।"}
      </p>
    </div>
  );
}
