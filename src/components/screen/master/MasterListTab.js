"use client";
// One master list (states, districts, relations, castes, gotras): add, bulk add, rename, order, on/off, delete.
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, InputNumber, Modal, Popconfirm, Select, Switch, Table, Tag, Tooltip } from "antd";
import { FiPlus, FiTrash2, FiEdit2, FiSearch, FiList } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { notifyMasterChanged } from "@/lib/client/masterData";
import { useCan } from "@/lib/AuthProvider";

export default function MasterListTab({ type, lists, reload }) {
  const { message } = App.useApp();
  const can = useCan();
  const isDistrict = type.key === "district";
  const english = type.slugValue; // states & districts keep an English key
  const [stateFilter, setStateFilter] = useState(null);
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [edit, setEdit] = useState(null);

  const states = lists.state || [];
  useEffect(() => {
    if (isDistrict && !stateFilter && states.length) setStateFilter(states[0].value);
  }, [isDistrict, stateFilter, states]);

  const rows = useMemo(() => {
    let r = lists[type.key] || [];
    if (isDistrict) r = r.filter((d) => d.parentValue === stateFilter);
    const n = q.trim().toLowerCase();
    if (n) r = r.filter((x) => `${x.label} ${x.labelEn} ${x.value}`.toLowerCase().includes(n));
    return r;
  }, [lists, type.key, isDistrict, stateFilter, q]);

  const changed = useCallback(async () => { await reload(); notifyMasterChanged(); }, [reload]);

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.post("/master-data", { type: type.key, label, labelEn, parentValue: isDistrict ? stateFilter : undefined });
      setLabel(""); setLabelEn("");
      message.success(`${type.one} added`);
      await changed();
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };

  const saveBulk = async () => {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    try {
      const r = await api.post("/master-data", { type: type.key, lines, parentValue: isDistrict ? stateFilter : undefined });
      message.success(`${r.items.length} added`);
      setBulk(null);
      await changed();
    } catch (e) { message.error(e.message); }
  };

  const patch = async (row, body, ok) => {
    try {
      await api.patch(`/master-data/${row.id}`, body);
      if (ok) message.success(ok);
      await changed();
    } catch (e) { message.error(e.message); }
  };

  const remove = async (row) => {
    try {
      await api.del(`/master-data/${row.id}`);
      message.success(`"${row.label}" deleted`);
      await changed();
    } catch (e) { message.error(e.message); }
  };

  const columns = [
    { title: "#", dataIndex: "sortOrder", width: 70, render: (v) => <span className="text-gray-400 tabular-nums">{v}</span> },
    {
      title: type.one, dataIndex: "label",
      render: (v, r) => (
        <div>
          <div className={`font-medium ${r.active ? "text-gray-900" : "text-gray-400 line-through"}`}>{v}</div>
          {english && <div className="text-xs text-gray-500">{r.labelEn || "—"} · <code className="text-[11px]">{r.value}</code></div>}
        </div>
      ),
    },
    {
      title: "Members", dataIndex: "used", width: 100, align: "right",
      render: (v) => (v ? <Tag color="blue" className="!m-0">{v}</Tag> : <span className="text-gray-300">0</span>),
    },
    {
      title: "Active", dataIndex: "active", width: 90,
      render: (v, r) => <Switch size="small" checked={v} disabled={!can("master", "edit")} onChange={(on) => patch(r, { active: on }, on ? "Shown in forms again" : "Hidden from forms")} />,
    },
    {
      title: "", key: "act", width: 100, align: "right",
      render: (_, r) => (
        <div className="flex gap-1 justify-end">
          {can("master", "edit") && <Tooltip title="Edit"><Button size="small" icon={<FiEdit2 />} onClick={() => setEdit({ ...r })} /></Tooltip>}
          {can("master", "delete") && (
            <Popconfirm title={`Delete "${r.label}"?`} description={r.used ? `${r.used} members use it — make it inactive instead.` : undefined}
              okText="Delete" okButtonProps={{ danger: true, disabled: !!r.used }} onConfirm={() => remove(r)}>
              <Button size="small" danger icon={<FiTrash2 />} />
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isDistrict && (
          <Select value={stateFilter} onChange={setStateFilter} style={{ minWidth: 180 }} showSearch optionFilterProp="label"
            options={states.map((s) => ({ value: s.value, label: s.label }))} placeholder="State" />
        )}
        <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        <span className="text-xs text-gray-500">{rows.length} {type.label.toLowerCase()}</span>
      </div>

      {can("master", "add") && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 p-2.5">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} onPressEnter={add} placeholder={`${type.one} (${type.hi})`} style={{ width: 220 }} />
          {english && <Input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} onPressEnter={add} placeholder="English name" style={{ width: 180 }} />}
          <Button type="primary" icon={<FiPlus />} loading={busy} disabled={!label.trim() || (isDistrict && !stateFilter)} onClick={add}>Add</Button>
          <Button icon={<FiList />} onClick={() => setBulk("")} disabled={isDistrict && !stateFilter}>Add many</Button>
        </div>
      )}

      <Table rowKey="id" size="small" columns={columns} dataSource={rows} pagination={{ pageSize: 50, hideOnSinglePage: true }} scroll={{ x: 520 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${type.label.toLowerCase()} yet`} /> }} />

      <Modal open={bulk !== null} title={`Add many ${type.label.toLowerCase()}`} okText="Add all" onOk={saveBulk} onCancel={() => setBulk(null)}>
        <p className="text-sm text-gray-500 mb-2">
          Ek line mein ek naam.{english ? " English naam bhi chahiye to: हिन्दी नाम | English name" : ""}
          {isDistrict ? ` State: ${states.find((s) => s.value === stateFilter)?.label || ""}` : ""}
        </p>
        <Input.TextArea rows={10} value={bulk ?? ""} onChange={(e) => setBulk(e.target.value)} placeholder={english ? "जोधपुर | Jodhpur\nपाली | Pali" : "पहला\nदूसरा"} />
      </Modal>

      <Modal open={!!edit} title={`Edit ${type.one.toLowerCase()}`} okText="Save" onCancel={() => setEdit(null)}
        onOk={async () => { await patch(edit, { label: edit.label, labelEn: edit.labelEn, sortOrder: edit.sortOrder }, "Saved"); setEdit(null); }}>
        {edit && (
          <div className="space-y-3">
            <div><div className="text-xs font-semibold text-gray-500 mb-1">{type.one}</div><Input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></div>
            {english && <div><div className="text-xs font-semibold text-gray-500 mb-1">English name</div><Input value={edit.labelEn} onChange={(e) => setEdit({ ...edit, labelEn: e.target.value })} /></div>}
            <div><div className="text-xs font-semibold text-gray-500 mb-1">Order</div><InputNumber value={edit.sortOrder} onChange={(v) => setEdit({ ...edit, sortOrder: v })} /></div>
            <div className="text-xs text-gray-500">
              Saved key <code>{edit.value}</code> nahi badalti — members isi se jude hain. Naam badalne par sab jagah naya naam dikhega
              {english ? "" : " (purane members par jo text likha hai wo waisa hi rahega)"}.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
