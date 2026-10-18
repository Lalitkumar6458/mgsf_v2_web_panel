"use client";
// Settings → WhatsApp inbox: what members wrote back on the trust's WhatsApp number (via the Gupshup
// callback URL), next to what we sent them. Reply works within 24 h of the member's last message.
import { useCallback, useEffect, useRef, useState } from "react";
import { App, Badge, Button, Empty, Input } from "antd";
import { FiSearch, FiSend, FiRefreshCw, FiFileText, FiArrowLeft, FiAlertCircle, FiLock } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "@/lib/client/api";

const time = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return x.toDateString() === new Date().toDateString()
    ? x.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const TICK = { submitted: "✓", enqueued: "✓", sent: "✓", delivered: "✓✓", read: "✓✓", failed: "!" };
const EVENT = { join: "Join · certificate", pending: "Baki rasid", paid: "Jama rasid", test: "Test", reply: "" };
const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Thread({ phone, onBack, onChanged }) {
  const { message } = App.useApp();
  const [t, setT] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const load = useCallback(async () => {
    try { setT(await api.get(`/whatsapp/inbox/${phone}`)); onChanged?.(); } catch (e) { message.error(e.message); }
  }, [phone, message, onChanged]);
  useEffect(() => { setT(null); load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [t?.messages?.length]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await api.post(`/whatsapp/inbox/${phone}`, { text }); setText(""); await load(); } catch (e) { message.error(e.message, 6); } finally { setBusy(false); }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <button type="button" className="md:hidden" onClick={onBack}><FiArrowLeft /></button>
        <div className="font-semibold text-gray-900">+{phone}</div>
        <Button size="small" type="text" icon={<FiRefreshCw />} onClick={load} className="ml-auto" />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-3 py-4 sm:px-6">
        {!t ? <div className="py-10 text-center text-gray-400">Load ho raha hai…</div> : t.messages.map((m) => {
          const out = m.direction === "out";
          return (
            <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-[13.5px] shadow-sm ${out ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"}`}>
                {out && EVENT[m.event] ? <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{EVENT[m.event]}</div> : null}
                {m.mediaUrl ? (
                  <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded bg-black/5 px-2 py-1 text-xs text-gray-700 hover:bg-black/10">
                    <FiFileText className="text-red-500" /> {m.mediaType === "document" ? "PDF" : m.mediaType || "File"} dekhein
                  </a>
                ) : null}
                <div className="whitespace-pre-wrap break-words text-gray-900">{m.body}</div>
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-gray-500">
                  {time(m.at)}
                  {out ? <span className={m.status === "read" ? "text-sky-500" : m.status === "failed" ? "text-red-600" : ""}>{TICK[m.status] || ""}</span> : null}
                </div>
                {m.status === "failed" && m.error ? <div className="mt-1 flex items-center gap-1 text-[11px] text-red-600"><FiAlertCircle /> {m.error}</div> : null}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="border-t border-gray-200 bg-white p-3">
        {t && !t.canReply ? (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <FiLock className="shrink-0" /> Member ka aakhri message 24 ghante se purana hai — WhatsApp ke niyam se ab sirf template message ja sakta hai. Member reply kare to yahan se jawab de sakte hain.
          </div>
        ) : (
          <div className="flex gap-2">
            <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Jawab likhein…"
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }} />
            <Button type="primary" icon={<FiSend />} loading={busy} onClick={send} style={{ background: "#16a34a" }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function WhatsAppInbox() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get("/whatsapp/inbox", { q: query }).then(setData).catch(() => setData({ chats: [], unread: 0 })), [query]);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);
  useEffect(() => { const x = setTimeout(() => setQuery(q), 350); return () => clearTimeout(x); }, [q]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#25D366] text-xl text-white"><FaWhatsapp /></div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800">WhatsApp inbox {data?.unread ? <Badge count={data.unread} className="ml-1" /> : null}</h3>
          <p className="text-xs text-gray-500">Members ke jawab aur unhe bheje gaye message — ek jagah.</p>
        </div>
      </div>
      <div className="grid h-[70vh] min-h-[480px] overflow-hidden rounded-2xl border border-gray-200 bg-white md:grid-cols-[320px_1fr]">
        <div className={`flex min-h-0 flex-col border-r border-gray-200 ${open ? "hidden md:flex" : "flex"}`}>
          <div className="border-b border-gray-100 p-2">
            <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Naam / reg. no. / mobile" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data ? <div className="p-6 text-center text-gray-400">Load ho raha hai…</div>
              : !data.chats.length ? <Empty className="mt-10" description="Abhi koi message nahi" />
              : data.chats.map((c) => (
                <button key={c.phone} type="button" onClick={() => setOpen(c.phone)}
                  className={`flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2.5 text-left hover:bg-gray-50 ${open === c.phone ? "bg-emerald-50" : ""}`}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{initials(c.name || c.phone.slice(-2))}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className={`truncate text-sm ${c.unread ? "font-bold text-gray-900" : "font-medium text-gray-800"}`}>{c.name || `+${c.phone}`}</div>
                      <div className={`ml-auto shrink-0 text-[11px] ${c.unread ? "font-semibold text-emerald-600" : "text-gray-400"}`}>{time(c.at)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="truncate text-xs text-gray-500">{c.direction === "out" ? "Aap: " : ""}{c.last}</div>
                      {c.unread ? <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">{c.unread}</span> : null}
                    </div>
                    {c.regNo ? <div className="text-[10px] text-gray-400">{c.regNo}{c.village ? ` · ${c.village}` : ""}</div> : null}
                  </div>
                </button>
              ))}
          </div>
        </div>
        <div className={`min-h-0 ${open ? "flex" : "hidden md:flex"} flex-col`}>
          {open ? <Thread phone={open} onBack={() => setOpen(null)} onChanged={load} />
            : <div className="flex h-full flex-col items-center justify-center bg-[#f7f5f2] text-gray-400"><FaWhatsapp className="mb-2 text-5xl text-emerald-300" />Baat dekhne ke liye left se chunein</div>}
        </div>
      </div>
    </div>
  );
}
