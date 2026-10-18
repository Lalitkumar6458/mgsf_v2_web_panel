"use client";
// Settings → App logins: how many members / agents use the mobile app, on which phones, and logging a
// phone out (that phone is signed out at once and gets no more push notifications).
import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Segmented, Table, Tag, Tooltip, Popconfirm, Empty } from "antd";
import { FiSmartphone, FiUsers, FiBriefcase, FiLogOut, FiRefreshCw, FiBell, FiSearch } from "react-icons/fi";
import { api } from "@/lib/client/api";

const ago = (d) => {
  if (!d) return "—";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 2) return "abhi";
  if (m < 60) return `${m} min pehle`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  const dd = Math.round(h / 24);
  return dd < 31 ? `${dd} din pehle` : new Date(d).toLocaleDateString("en-IN");
};
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function Stat({ icon: Icon, title, s, tone }) {
  const pct = s?.logins ? Math.round((s.logged_in / s.logins) * 100) : 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500"><Icon /> {title}</div>
      <div className="mt-2 flex items-end gap-2">
        <div className="text-3xl font-bold text-gray-900">{s?.logged_in ?? "–"}</div>
        <div className="pb-1 text-sm text-gray-500">/ {s?.logins ?? "–"} ne app mein login kiya</div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 py-1.5"><div className="font-semibold text-gray-900">{s?.phones ?? "–"}</div><div className="text-[11px] text-gray-500">phone</div></div>
        <div className="rounded-lg bg-gray-50 py-1.5"><div className="font-semibold text-gray-900">{s?.push ?? "–"}</div><div className="text-[11px] text-gray-500">notification chalu</div></div>
        <div className="rounded-lg bg-gray-50 py-1.5"><div className="font-semibold text-gray-900">{s?.active_week ?? "–"}</div><div className="text-[11px] text-gray-500">is hafte khola</div></div>
      </div>
    </div>
  );
}

function Phones({ accountId, onChange }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api.get(`/app-logins/${accountId}`).then((r) => setRows(r.phones || [])).catch(() => setRows([])), [accountId]);
  useEffect(() => { load(); }, [load]);
  const out = async (sessionId) => {
    try {
      await api.del(`/app-logins/${accountId}`, sessionId ? { sessionId } : undefined);
      message.success(sessionId ? "Us phone se logout kar diya" : "Sab phone se logout kar diya");
      load(); onChange?.();
    } catch (e) { message.error(e.message || "Logout nahi hua"); }
  };
  if (!rows) return <div className="py-3 text-sm text-gray-400">Load ho raha hai…</div>;
  if (!rows.length) return <div className="py-3 text-sm text-gray-500">Abhi kisi phone par login nahi hai.</div>;
  return (
    <div className="space-y-2 py-1">
      {rows.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2">
          <FiSmartphone className="text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{p.device}{p.platform ? <span className="text-gray-400 font-normal"> · {p.platform}</span> : null}</div>
            <div className="text-xs text-gray-500">
              Login: {when(p.loggedInAt)} · Aakhri baar: {ago(p.lastSeenAt)}{p.appVersion ? ` · app v${p.appVersion}` : ""}{p.ip ? ` · ${p.ip}` : ""}
            </div>
          </div>
          {p.push ? <Tooltip title="Is phone par notification aati hai"><Tag color="green" icon={<FiBell className="inline mr-1" />}>Push</Tag></Tooltip> : <Tag>Push nahi</Tag>}
          <Popconfirm title="Is phone se logout karein?" description="Us phone par app dobara login maangega." okText="Haan, logout" cancelText="Nahi" onConfirm={() => out(p.id)}>
            <Button size="small" danger icon={<FiLogOut />}>Logout</Button>
          </Popconfirm>
        </div>
      ))}
      {rows.length > 1 ? (
        <Popconfirm title={`Sab ${rows.length} phone se logout karein?`} okText="Haan" cancelText="Nahi" onConfirm={() => out(null)}>
          <Button size="small" danger type="link" icon={<FiLogOut />}>Sab phone se logout</Button>
        </Popconfirm>
      ) : null}
    </div>
  );
}

export default function AppLogins() {
  const [role, setRole] = useState("member");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get("/app-logins", { role, status, q: query, page }));
    } catch { setData((d) => d); } finally { setLoading(false); }
  }, [role, status, query, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);

  const s = data?.summary;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FiSmartphone className="text-xl text-gray-500" />
          <div>
            <h3 className="text-lg font-semibold text-gray-800">App logins</h3>
            <p className="text-xs text-gray-500">Kitne member / agent ne mobile app mein login kiya, kis phone par — aur kisi phone se logout karna.</p>
          </div>
        </div>
        <Button icon={<FiRefreshCw />} onClick={load} loading={loading}>Refresh</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Stat icon={FiUsers} title="Members" s={s?.members} tone="bg-[var(--brand)]" />
        <Stat icon={FiBriefcase} title="Agents" s={s?.agents} tone="bg-emerald-500" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <Segmented value={role} onChange={(v) => { setRole(v); setPage(1); }} options={[{ value: "member", label: "Members" }, { value: "agent", label: "Agents" }]} />
          <Segmented value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ value: "", label: "Sab" }, { value: "in", label: "Login hai" }, { value: "out", label: "Login nahi kiya" }]} />
          <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Naam / reg. no. / gaon / mobile" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        </div>
        <Table
          size="middle" rowKey="accountId" loading={loading} dataSource={data?.logins || []}
          locale={{ emptyText: <Empty description="Koi login nahi mila" /> }}
          pagination={{ current: page, pageSize: data?.pageSize || 50, total: data?.total || 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          expandable={{ expandedRowRender: (r) => <Phones accountId={r.accountId} onChange={load} />, rowExpandable: (r) => r.phones > 0 }}
          columns={[
            { title: role === "agent" ? "Agent" : "Member", dataIndex: "name", render: (t, r) => (
              <div><div className="font-medium text-gray-900">{t}</div>
                <div className="text-xs text-gray-500">{[r.registrationNumber || r.loginId, r.village, r.program].filter(Boolean).join(" · ")}</div></div>
            ) },
            { title: "Mobile", dataIndex: "phone", width: 130, responsive: ["md"] },
            { title: "Phone par login", dataIndex: "phones", width: 140, render: (n, r) => n ? <Tag color="blue">{n} phone{r.push ? ` · ${r.push} push` : ""}</Tag> : <Tag>Login nahi</Tag> },
            { title: "Aakhri baar", dataIndex: "lastSeenAt", width: 130, render: ago },
            { title: "", width: 120, render: (_, r) => r.phones ? (
              <Popconfirm title={`${r.name} — sab phone se logout?`} okText="Haan" cancelText="Nahi"
                onConfirm={async () => { await api.del(`/app-logins/${r.accountId}`); load(); }}>
                <Button size="small" danger icon={<FiLogOut />}>Logout</Button>
              </Popconfirm>
            ) : null },
          ]}
        />
        <div className="mt-2 text-xs text-gray-400">Row ke aage ▸ dabakar dekhein kis-kis phone par login hai. "Aakhri baar" = app aakhri baar kab khola. 30 din tak na khula phone apne aap hat jaata hai.</div>
      </div>
    </div>
  );
}
