"use client";
// Public page opened by the QR on a paid receipt (/verify/r/<code>) or a certificate (/verify/c/<token>).
import { useEffect, useState, use } from "react";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const STATUS = {
  valid: { bg: "#ecfdf5", border: "#a7f3d0", color: "#047857", icon: "✔", title: "Asli — record se mel khata hai" },
  changed: { bg: "#fffbeb", border: "#fcd34d", color: "#b45309", icon: "!", title: "Rasid asli hai, par baad mein kuch bhugtan wapas hua" },
  closed: { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", icon: "✔", title: "Asli — sadasyata closing ho chuki hai" },
  removed: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c", icon: "✕", title: "Ye sadasya ab record mein sakriya nahi hai" },
  pending: { bg: "#fffbeb", border: "#fcd34d", color: "#b45309", icon: "!", title: "Sadasyata abhi manjoor nahi hui" },
  notfound: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c", icon: "✕", title: "Record mein nahi mila — ye nakli ho sakta hai" },
};

export default function VerifyPage({ params }) {
  const { kind, code } = use(params);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    document.title = "Verify";
    const k = kind === "c" ? "c" : "r";
    fetch(`/api/verify/${k}/${encodeURIComponent(code)}`)
      .then(async (res) => setState(res.ok ? { data: await res.json() } : { error: true }))
      .catch(() => setState({ error: true }));
  }, [kind, code]);

  const d = state.data;
  const st = STATUS[state.error ? "notfound" : d?.status] || STATUS.pending;
  const rows = !d ? [] : d.kind === "receipt"
    ? [["Rasid no.", d.receiptNo], ["Rakam", money(d.amount)], ["Entries", d.entries], ["Jaari", fmt(d.issuedAt)],
       ["Sadasya", [d.member.name, d.member.fatherName].filter(Boolean).join(" / ")], ["Reg. no.", d.member.registrationNumber],
       ["Gaon", d.member.village], ["Mobile", d.member.phone], ["Yojna", d.program]]
    : [["Sadasya", [d.member.name, d.member.fatherName].filter(Boolean).join(" / ")], ["Reg. no.", d.member.registrationNumber],
       ["Gaon", d.member.village], ["Mobile", d.member.phone], ["Judne ki tithi", fmt(d.member.joined)], ["Yojna", d.program]];

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", justifyContent: "center", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#6b7280" }}>
            {kind === "c" ? "Certificate jaanch" : "Rasid jaanch"}
          </div>
          {d?.trust?.name && <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 4 }}>{d.trust.name}</div>}
          {d?.trust?.cityState && <div style={{ fontSize: 13, color: "#6b7280" }}>{d.trust.cityState}</div>}
        </div>
        {state.loading ? (
          <div style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Jaanch ho rahi hai…</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 6px 24px rgba(0,0,0,.05)" }}>
            <div style={{ background: st.bg, borderBottom: `1px solid ${st.border}`, color: st.color, padding: "16px 18px", display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: 99, background: st.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, flexShrink: 0 }}>{st.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{st.title}</div>
            </div>
            {d && (
              <div style={{ padding: "6px 18px 14px" }}>
                {rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid #f3f4f6", fontSize: 14 }}>
                    <span style={{ color: "#6b7280" }}>{l}</span>
                    <span style={{ fontWeight: 600, color: "#111827", textAlign: "right" }}>{v}</span>
                  </div>
                ))}
                {d.status === "changed" && (
                  <div style={{ fontSize: 12.5, color: "#92400e", marginTop: 10 }}>
                    Is rasid ki {d.total} entries mein se {d.total - d.stillPaid} ka bhugtan baad mein wapas (reverse) kiya gaya. Trust se sampark karein.
                  </div>
                )}
              </div>
            )}
            {state.error && (
              <div style={{ padding: 18, fontSize: 14, color: "#374151" }}>
                Ye code trust ke record mein nahi mila. Kagaz par chhapi jaankari par bharosa na karein — trust office se sampark karein.
              </div>
            )}
          </div>
        )}
        {d?.trust?.contact && <div style={{ textAlign: "center", fontSize: 12.5, color: "#6b7280", marginTop: 14 }}>Sampark: {d.trust.contact}</div>}
      </div>
    </div>
  );
}
