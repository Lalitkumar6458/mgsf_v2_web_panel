"use client";
// Users & Roles: trust staff logins and the custom roles that decide which screens / actions they get.
// The trust's own admin login is the Super Admin (all access) and is shown first, read-only.
import { useCallback, useEffect, useState } from "react";
import {
  App, Button, Checkbox, Drawer, Empty, Form, Input, Popconfirm, Select, Switch, Table, Tag, Tooltip,
} from "antd";
import { FiPlus, FiEdit2, FiTrash2, FiShield, FiCopy, FiRefreshCw } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { useAuth, useCan } from "@/lib/AuthProvider";
import { MODULES, ACTIONS, ACTION_LABEL, ROLE_TEMPLATES, normalizePermissions, FULL_ACCESS } from "@/lib/permissions";

const genPassword = () => Math.random().toString(36).slice(2, 6) + "@" + Math.floor(1000 + Math.random() * 9000);

function permSummary(perms) {
  const p = normalizePermissions(perms);
  const keys = Object.keys(p);
  if (!keys.length) return <span className="text-gray-400">No access</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => {
        const m = MODULES.find((x) => x.key === k);
        const full = p[k].length === m.actions.length;
        return <Tag key={k} color={full ? "blue" : "default"} className="!m-0">{m.label}{full ? "" : ` (${p[k].map((a) => ACTION_LABEL[a]).join(", ")})`}</Tag>;
      })}
    </div>
  );
}

/** module × action checkbox grid */
function PermissionMatrix({ value = {}, onChange, mine }) {
  const p = normalizePermissions(value);
  const set = (mod, act, on) => {
    const cur = new Set(p[mod] || []);
    if (on) { cur.add(act); cur.add("view"); } else { cur.delete(act); if (act === "view") cur.clear(); }
    onChange?.({ ...p, [mod]: [...cur] });
  };
  const allowedForMe = (mod, act) => !mine || mine.isSuper || mine.permissions?.[mod]?.includes(act);
  return (
    <div className="rounded-lg border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-left font-semibold px-3 py-2">Screen</th>
            {ACTIONS.map((a) => <th key={a} className="font-semibold px-2 py-2 w-16 text-center">{ACTION_LABEL[a]}</th>)}
            <th className="px-2 py-2 w-14 text-center">All</th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => {
            const all = m.actions.every((a) => p[m.key]?.includes(a));
            return (
              <tr key={m.key} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-800">{m.label} <span className="text-xs text-gray-400">{m.hi}</span></div>
                  {m.hint && <div className="text-[11px] text-gray-400">{m.hint}</div>}
                </td>
                {ACTIONS.map((a) => (
                  <td key={a} className="text-center">
                    {m.actions.includes(a)
                      ? <Checkbox checked={!!p[m.key]?.includes(a)} disabled={!allowedForMe(m.key, a)} onChange={(e) => set(m.key, a, e.target.checked)} />
                      : <span className="text-gray-200">—</span>}
                  </td>
                ))}
                <td className="text-center">
                  <Checkbox checked={all} disabled={!m.actions.every((a) => allowedForMe(m.key, a))}
                    onChange={(e) => onChange?.({ ...p, [m.key]: e.target.checked ? [...m.actions] : [] })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RolesPanel({ roles, reload }) {
  const { message } = App.useApp();
  const can = useCan();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(null); // null | "new" | role
  const [busy, setBusy] = useState(false);

  const openRole = (r) => {
    setOpen(r || "new");
    form.setFieldsValue(r ? { name: r.name, description: r.description, permissions: r.permissions } : { name: "", description: "", permissions: {} });
  };

  const save = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (open === "new") await api.post("/roles", v); else await api.patch(`/roles/${open.id}`, v);
      message.success("Role saved");
      setOpen(null);
      reload();
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    try { await api.del(`/roles/${r.id}`); message.success("Role deleted"); reload(); } catch (e) { message.error(e.message); }
  };

  const columns = [
    { title: "Role", dataIndex: "name", render: (v, r) => <div><div className="font-semibold">{v}</div><div className="text-xs text-gray-500">{r.description}</div></div> },
    { title: "Access", dataIndex: "permissions", render: permSummary },
    { title: "Users", dataIndex: "users", width: 80, align: "right" },
    {
      title: "", key: "act", width: 130, align: "right",
      render: (_, r) => (
        <div className="flex gap-1 justify-end">
          {can("users", "edit") && <Tooltip title="Edit"><Button size="small" icon={<FiEdit2 />} onClick={() => openRole(r)} /></Tooltip>}
          {can("users", "add") && <Tooltip title="Copy"><Button size="small" icon={<FiCopy />} onClick={() => { openRole(null); form.setFieldsValue({ name: `${r.name} copy`, description: r.description, permissions: r.permissions }); }} /></Tooltip>}
          {can("users", "delete") && (
            <Popconfirm title={`Delete role "${r.name}"?`} okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove(r)}>
              <Button size="small" danger icon={<FiTrash2 />} disabled={r.users > 0} />
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-500">
          <Tag color="gold" icon={<FiShield className="inline mr-1" />}>Super Admin</Tag> trust ka main login — sab screens, sab actions. Baaki users ko neeche wale roles milte hain.
        </div>
        {can("users", "add") && <Button type="primary" icon={<FiPlus />} onClick={() => openRole(null)}>New role</Button>}
      </div>
      <Table rowKey="id" size="middle" columns={columns} dataSource={roles} pagination={false} scroll={{ x: 640 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No roles yet — create one, e.g. Accountant or Data entry" /> }} />

      <Drawer open={!!open} onClose={() => setOpen(null)} destroyOnHidden title={open === "new" ? "New role" : `Edit role · ${open?.name || ""}`}
        width={typeof window !== "undefined" ? Math.min(760, window.innerWidth) : 760}
        extra={<Button type="primary" loading={busy} onClick={save}>Save role</Button>}>
        <Form form={form} layout="vertical" requiredMark={false}>
          {open === "new" && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-500 mb-1.5">Start from</div>
              <div className="flex flex-wrap gap-2">
                {ROLE_TEMPLATES.map((t) => (
                  <Button key={t.name} size="small" onClick={() => form.setFieldsValue({ name: form.getFieldValue("name") || t.name, description: t.description, permissions: t.permissions })}>{t.name}</Button>
                ))}
                <Button size="small" onClick={() => form.setFieldsValue({ permissions: FULL_ACCESS })}>Everything</Button>
                <Button size="small" onClick={() => form.setFieldsValue({ permissions: {} })}>Clear</Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Form.Item name="name" label="Role name" rules={[{ required: true, message: "Enter a name" }]}><Input maxLength={40} placeholder="e.g. Accountant" /></Form.Item>
            <Form.Item name="description" label="Description"><Input maxLength={120} /></Form.Item>
          </div>
          <Form.Item name="permissions" label="Screens & actions">
            <PermissionMatrix mine={user?.access} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

export function UsersPanel({ users, roles, reload }) {
  const { message } = App.useApp();
  const can = useCan();
  const { user: me } = useAuth();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const openUser = (u) => {
    setOpen(u || "new");
    form.setFieldsValue(u
      ? { displayName: u.displayName, email: u.email || u.loginId, phone: u.phone, roleId: u.roleId, password: "" }
      : { displayName: "", email: "", phone: "", roleId: roles[0]?.id, password: genPassword() });
  };

  const save = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (open === "new") {
        await api.post("/users", v);
        message.success(`User created. Login: ${v.email} / ${v.password}`, 8);
      } else {
        await api.patch(`/users/${open.id}`, { ...v, password: v.password || undefined });
        message.success("User saved");
      }
      setOpen(null);
      reload();
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };

  const setActive = async (u, active) => {
    try { await api.patch(`/users/${u.id}`, { active }); message.success(active ? "User can log in" : "User blocked & logged out"); reload(); } catch (e) { message.error(e.message); }
  };
  const remove = async (u) => {
    try { await api.del(`/users/${u.id}`); message.success("User deleted"); reload(); } catch (e) { message.error(e.message); }
  };

  const columns = [
    {
      title: "User", dataIndex: "displayName",
      render: (v, u) => (
        <div>
          <div className="font-semibold text-gray-900">{v}{u.id === me?.accountId && <Tag className="!ml-2" color="cyan">You</Tag>}</div>
          <div className="text-xs text-gray-500">{u.email || u.loginId}{u.phone ? ` · ${u.phone}` : ""}</div>
        </div>
      ),
    },
    { title: "Role", dataIndex: "roleName", render: (v, u) => (u.isSuper ? <Tag color="gold" icon={<FiShield className="inline mr-1" />}>Super Admin</Tag> : <Tag color="blue">{v || "—"}</Tag>) },
    { title: "Last login", dataIndex: "lastLoginAt", responsive: ["md"], render: (v) => (v ? dayjs(v).format("DD MMM YYYY, hh:mm A") : <span className="text-gray-400">Never</span>) },
    {
      title: "Active", dataIndex: "active", width: 90,
      render: (v, u) => <Switch size="small" checked={v} disabled={u.isSuper || u.id === me?.accountId || !can("users", "edit")} onChange={(on) => setActive(u, on)} />,
    },
    {
      title: "", key: "act", width: 100, align: "right",
      render: (_, u) => u.isSuper ? <span className="text-xs text-gray-400">all access</span> : (
        <div className="flex gap-1 justify-end">
          {can("users", "edit") && <Tooltip title="Edit / reset password"><Button size="small" icon={<FiEdit2 />} onClick={() => openUser(u)} /></Tooltip>}
          {can("users", "delete") && u.id !== me?.accountId && (
            <Popconfirm title={`Delete ${u.displayName}?`} description="Login removed. Their past entries stay." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove(u)}>
              <Button size="small" danger icon={<FiTrash2 />} />
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  const editingSelf = open && open !== "new" && open.id === me?.accountId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-500">Staff logins of this trust. Login: email + password on the normal admin login page.</div>
        {can("users", "add") && (
          <Tooltip title={roles.length ? "" : "Pehle Roles tab mein ek role banaiye"}>
            <Button type="primary" icon={<FiPlus />} disabled={!roles.length} onClick={() => openUser(null)}>New user</Button>
          </Tooltip>
        )}
      </div>
      <Table rowKey="id" size="middle" columns={columns} dataSource={users} pagination={false} scroll={{ x: 640 }} />

      <Drawer open={!!open} onClose={() => setOpen(null)} destroyOnHidden title={open === "new" ? "New user" : `Edit user · ${open?.displayName || ""}`}
        width={typeof window !== "undefined" ? Math.min(460, window.innerWidth) : 460}
        extra={<Button type="primary" loading={busy} onClick={save}>Save</Button>}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="displayName" label="Name" rules={[{ required: true, message: "Enter name" }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email (login id)" rules={[{ required: true, type: "email", message: "Valid email" }]}><Input /></Form.Item>
          <Form.Item name="phone" label="Mobile"><Input maxLength={15} /></Form.Item>
          <Form.Item name="roleId" label="Role" rules={[{ required: true, message: "Choose a role" }]}>
            <Select disabled={editingSelf} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
          <Form.Item name="password" label={open === "new" ? "Password" : "New password (empty = keep)"}
            rules={open === "new" ? [{ required: true, min: 6, message: "6+ characters" }] : [{ min: 6, message: "6+ characters" }]}>
            <Input addonAfter={<FiRefreshCw className="cursor-pointer" onClick={() => form.setFieldsValue({ password: genPassword() })} />} />
          </Form.Item>
          {open !== "new" && <div className="text-xs text-gray-500">Password badalne ya user block karne par wo sab devices se logout ho jayega.</div>}
        </Form>
      </Drawer>
    </div>
  );
}

/** Both panels with their own loading (used on the Master page and in Settings) */
export default function UsersRoles({ show = "users" }) {
  const { message } = App.useApp();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api.get("/users"), api.get("/roles")]);
      setUsers(u.users || []);
      setRoles(r.roles || []);
    } catch (e) { message.error(e.message); }
  }, [message]);
  useEffect(() => { load(); }, [load]);
  return show === "roles" ? <RolesPanel roles={roles} reload={load} /> : <UsersPanel users={users} roles={roles} reload={load} />;
}
