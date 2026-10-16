"use client";
// Settings → Activity log: every change made in the panel — who, what, when (services/audit.js).
import { useCallback, useEffect, useRef, useState } from "react";
import { Table, Input, Select, DatePicker, Button, Tag, Tooltip, Empty } from "antd";
import { FiSearch, FiRefreshCw, FiActivity } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";

const { RangePicker } = DatePicker;
const ACTION_COLOR = { create: "green", update: "blue", delete: "red", reverse: "volcano", accept: "cyan", login: "default", status: "purple" };

function Details({ details }) {
  const body = details?.body;
  const rows = body && typeof body === "object" && !Array.isArray(body)
    ? Object.entries(body).filter(([, v]) => v !== "" && v !== null && v !== undefined)
    : [];
  return (
    <div className="text-xs text-gray-600 space-y-1">
      <div className="font-mono text-gray-400">{details?.method} {details?.path}</div>
      {rows.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
          {rows.slice(0, 40).map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <span className="text-gray-400 shrink-0">{k}</span>
              <span className="truncate text-gray-800">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      ) : details?.userAgent ? <div>{details.userAgent}</div> : <div className="text-gray-400">Koi aur jaankari nahi</div>}
    </div>
  );
}

export default function ActivityLog() {
  const [data, setData] = useState({ logs: [], total: 0, actors: [], entities: [], actions: [] });
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ q: "", entity: undefined, action: undefined, accountId: undefined, range: null, page: 1, pageSize: 50 });
  const [qInput, setQInput] = useState("");
  const timer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/audit", {
        q: f.q, entity: f.entity, action: f.action, accountId: f.accountId, page: f.page, pageSize: f.pageSize,
        from: f.range?.[0]?.format("YYYY-MM-DD"), to: f.range?.[1]?.format("YYYY-MM-DD"),
      });
      setData(r);
    } catch (e) {
      setData((d) => ({ ...d, logs: [], total: 0, error: e.message }));
    } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v, page: k === "page" ? v : 1 }));
  const entityLabel = (v) => data.entities.find((e) => e.value === v)?.label || v;
  const actionLabel = (v) => data.actions.find((e) => e.value === v)?.label || v;

  const columns = [
    {
      title: "Kab", dataIndex: "createdAt", width: 150,
      render: (v) => <Tooltip title={dayjs(v).format("DD MMM YYYY, hh:mm:ss A")}><span className="tabular-nums">{dayjs(v).format("DD-MM-YY hh:mm A")}</span></Tooltip>,
    },
    {
      title: "Kisne", dataIndex: "actorName", width: 180,
      render: (v, r) => <div className="min-w-0"><div className="font-medium truncate">{v || "—"}</div><div className="text-xs text-gray-400">{r.actorRole}</div></div>,
    },
    { title: "Kya", dataIndex: "action", width: 120, render: (v) => <Tag color={ACTION_COLOR[v] || "default"}>{actionLabel(v)}</Tag> },
    { title: "Kahan", dataIndex: "entity", width: 140, render: (v) => entityLabel(v) },
    { title: "Vivran", dataIndex: "summary", render: (v) => <span className="text-gray-800">{v}</span> },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FiActivity className="text-indigo-600" />
        <h3 className="text-lg font-semibold m-0">Activity log</h3>
        <span className="text-sm text-gray-500">— panel mein kisne kab kya badla</span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Naam / vivran khojein…" style={{ width: 240 }}
          value={qInput} onChange={(e) => { const v = e.target.value; setQInput(v); clearTimeout(timer.current); timer.current = setTimeout(() => set("q", v.trim()), 400); }} />
        <Select allowClear placeholder="Kahan (sab)" style={{ width: 160 }} value={f.entity} onChange={(v) => set("entity", v)} options={data.entities} />
        <Select allowClear placeholder="Kya (sab)" style={{ width: 140 }} value={f.action} onChange={(v) => set("action", v)} options={data.actions} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Kisne (sab)" style={{ width: 180 }} value={f.accountId} onChange={(v) => set("accountId", v)}
          options={data.actors.map((a) => ({ value: a.accountId, label: `${a.name} (${a.count})` }))} />
        <RangePicker value={f.range} onChange={(v) => set("range", v)} format="DD-MM-YYYY" allowClear />
        <Button icon={<FiRefreshCw />} onClick={load} loading={loading}>Reload</Button>
      </div>
      <Table
        size="small" rowKey="id" columns={columns} dataSource={data.logs} loading={loading}
        expandable={{ expandedRowRender: (r) => <Details details={r.details} />, rowExpandable: () => true }}
        locale={{ emptyText: <Empty description={data.error || "Abhi koi gatividhi nahi"} /> }}
        pagination={{
          current: f.page, pageSize: f.pageSize, total: data.total, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200],
          onChange: (page, pageSize) => setF((p) => ({ ...p, page, pageSize })),
          showTotal: (t) => `${t.toLocaleString("en-IN")} entries`,
        }}
        scroll={{ x: 800 }}
      />
    </div>
  );
}
