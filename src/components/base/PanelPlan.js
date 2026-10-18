"use client";
// Panel plan (set on the developer's /feature-control page):
//   PlanWarning  — plan ends in a few days: a popup once a day + a slim banner on every screen
//   PanelBlocked — plan over / panel switched off: full screen with the renew contact
// The contact (name, phone, WhatsApp, e-mail, note) also comes from /feature-control.
import { useEffect, useState } from "react";
import { Modal } from "antd";
import { FiPhone, FiMail, FiClock, FiLock, FiRefreshCw, FiLogIn, FiShield, FiUser, FiInfo, FiX } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { waLink, todayIST } from "@/lib/features";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Call / WhatsApp / e-mail buttons + name and note. */
export function SupportContact({ support, waText, dark }) {
  if (!support) {
    return (
      <div className={`rounded-xl px-4 py-3 text-sm ${dark ? "bg-white/10 text-white/80" : "bg-gray-50 text-gray-600"}`}>
        Renew ke liye apne software provider / support se sampark karein.
      </div>
    );
  }
  const wa = waLink(support.whatsapp || support.phone, waText);
  const btn = "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[.98]";
  return (
    <div className="space-y-3">
      {support.name ? (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${dark ? "bg-white/10" : "bg-gray-50"}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand,#4f46e5)] text-white"><FiUser /></div>
          <div className="min-w-0">
            <div className={`text-[11px] font-bold uppercase tracking-wide ${dark ? "text-white/60" : "text-gray-400"}`}>Renew / support</div>
            <div className={`truncate font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{support.name}</div>
            {support.phone ? <div className={`text-xs ${dark ? "text-white/70" : "text-gray-500"}`}>{support.phone}{support.email ? ` · ${support.email}` : ""}</div> : null}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {support.phone ? <a href={`tel:${support.phone}`} className={`${btn} hover:opacity-90`} style={{ background: "var(--brand, #4f46e5)", color: "#fff" }}><FiPhone /> Call karein</a> : null}
        {wa ? <a href={wa} target="_blank" rel="noreferrer" className={`${btn} hover:opacity-90`} style={{ background: "#25D366", color: "#fff" }}><FaWhatsapp className="text-base" /> WhatsApp</a> : null}
        {support.email ? (
          <a href={`mailto:${support.email}?subject=${encodeURIComponent("Panel renew")}&body=${encodeURIComponent(waText || "")}`}
            className={`${btn} ${dark ? "bg-white/15 text-white hover:bg-white/25" : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"}`}><FiMail /> E-mail</a>
        ) : null}
      </div>
      {support.note ? (
        <div className={`flex gap-2 rounded-xl px-4 py-3 text-sm whitespace-pre-line ${dark ? "bg-white/10 text-white/85" : "border border-amber-200 bg-amber-50 text-amber-900"}`}>
          <FiInfo className="mt-0.5 shrink-0" /> <span>{support.note}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Plan ends soon: popup (once a day) + banner with a "Renew" button. */
export function PlanWarning({ plan, trustName }) {
  const day = new Date().toDateString();
  const popKey = `mgsf.planPopup.${plan.expiresAt}.${day}`;
  const barKey = `mgsf.planBanner.${plan.expiresAt}.${day}`;
  const [open, setOpen] = useState(false);
  const [bar, setBar] = useState(true);
  useEffect(() => {
    setBar(store.get(barKey) !== "1");
    // last 2 days: every new login session; earlier: once a day
    const seen = plan.daysLeft <= 1 ? (() => { try { return sessionStorage.getItem(popKey) === "1"; } catch { return false; } })() : store.get(popKey) === "1";
    if (!seen) setOpen(true);
  }, [popKey, barKey, plan.daysLeft]);
  const close = () => {
    store.set(popKey, "1");
    try { sessionStorage.setItem(popKey, "1"); } catch { /* ignore */ }
    setOpen(false);
  };

  const d = plan.daysLeft;
  const when = d === 0 ? "aaj" : d === 1 ? "kal" : `${d} din mein`;
  const date = fmt(plan.expiresAt);
  const urgent = d <= 2;
  const waText = `Namaste, ${trustName || "hamare trust"} ka admin panel renew karna hai. Plan ${date} ko khatam ho raha hai.`;

  return (
    <>
      {bar ? (
        <div className={`mb-3 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${urgent ? "border-red-200 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          <FiClock className="shrink-0" />
          <span className="flex-1 min-w-[200px]">Panel ka plan <b>{when}</b> ({date}) khatam ho raha hai. Samay rehte renew karwa lein.</span>
          <button type="button" onClick={() => setOpen(true)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold text-white ${urgent ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}>Renew karein</button>
          <button type="button" aria-label="Aaj ke liye chhupayein" className="opacity-60 hover:opacity-100" onClick={() => { store.set(barKey, "1"); setBar(false); }}><FiX /></button>
        </div>
      ) : null}

      <Modal open={open} onCancel={close} footer={null} centered width={480} closable
        styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 18 } }}>
        <div className={`px-6 pb-5 pt-7 text-center text-white ${urgent ? "bg-gradient-to-br from-red-500 to-rose-600" : "bg-gradient-to-br from-amber-400 to-orange-500"}`}>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-2xl"><FiClock /></div>
          <div className="text-xs font-bold uppercase tracking-widest text-white/80">Plan khatam hone wala hai</div>
          <div className="mt-1 text-4xl font-extrabold leading-tight">{d === 0 ? "Aaj aakhri din" : d === 1 ? "Sirf 1 din bacha" : `${d} din bache`}</div>
          <div className="mt-2 inline-block rounded-full bg-white/20 px-3 py-1 text-sm">Aakhri tareekh: <b>{date}</b></div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm leading-relaxed text-gray-600">
            {date} ke baad <b>{trustName || "aapka"}</b> panel apne aap band ho jayega — admin, staff, agent aur member app ka login ruk jayega.
            Aapka sara data surakshit rahega; renew hote hi sab turant chalu.
          </p>
          <SupportContact support={plan.support} waText={waText} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100">Baad mein yaad dilayein</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Plan over / panel switched off: replaces the whole panel. */
export function PanelBlocked({ info, onRetry, onLogin }) {
  const expired = info.reason === "expired";
  const date = fmt(info.expiresAt);
  const since = info.expiresAt ? Math.max(1, Math.round((Date.parse(todayIST()) - Date.parse(info.expiresAt)) / 86400000)) : null;
  const waText = expired
    ? `Namaste, ${info.trustName || "hamare trust"} ka admin panel renew karna hai. Plan ${date} ko khatam ho gaya.`
    : `Namaste, ${info.trustName || "hamare trust"} ka admin panel band dikha raha hai. Kripya chalu karein.`;
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-gradient-to-br from-slate-900 via-slate-800 to-[color-mix(in_srgb,var(--brand,#4f46e5)_55%,#0f172a)]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[var(--brand,#4f46e5)] opacity-25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-rose-500 opacity-20 blur-3xl" />
      <div className="relative flex min-h-full items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl">
          <div className="rounded-3xl border border-white/10 bg-white/[.06] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="flex flex-col items-center text-center">
              <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl text-white shadow-lg ${expired ? "bg-gradient-to-br from-rose-500 to-red-600" : "bg-gradient-to-br from-slate-500 to-slate-700"}`}>
                {expired ? <FiClock /> : <FiLock />}
              </div>
              {info.trustName ? <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-white/50">{info.trustName}</div> : null}
              <h1 className="text-2xl font-extrabold text-white sm:text-3xl">{expired ? "Panel ka plan khatam ho gaya" : "Panel abhi band hai"}</h1>
              {expired && date ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-rose-500/20 px-3 py-1 text-sm text-rose-100">
                  <FiClock /> Aakhri tareekh {date}{since ? ` · ${since} din pehle` : ""}
                </div>
              ) : null}
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75">{info.message}</p>
            </div>

            <div className="my-6 flex items-center gap-3 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              <FiShield className="shrink-0 text-lg" />
              <span>Aapka sara data (members, payment, rasid) surakshit hai. {expired ? "Renew" : "Chalu"} hote hi panel aur mobile app turant wapas chalne lagenge.</span>
            </div>

            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-white/50">{expired ? "Renew ke liye sampark karein" : "Sampark karein"}</div>
            <SupportContact support={info.support} waText={waText} dark />

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" onClick={onLogin} className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white">
                <FiLogIn /> Doosre login se
              </button>
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onRetry?.(); } finally { setBusy(false); } }}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white/90 disabled:opacity-60">
                <FiRefreshCw className={busy ? "animate-spin" : ""} /> Renew ho gaya? Dobara dekhein
              </button>
            </div>
          </div>
          <div className="mt-4 text-center text-xs text-white/40">Renew ke baad 1 minute mein panel chalu ho jata hai.</div>
        </div>
      </div>
    </div>
  );
}
