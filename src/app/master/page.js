"use client";
// Master Data: dropdown lists (state, district, relation, caste, gotra) + staff users & roles.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryTab } from "@/lib/client/useQueryTab";
import { App, Tabs } from "antd";
import { FiMap, FiMapPin, FiLink, FiUsers, FiShield, FiTag, FiHash } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { useCan } from "@/lib/AuthProvider";
import { MASTER_TYPES } from "@/lib/masterTypes";
import MasterListTab from "@/components/screen/master/MasterListTab";
import UsersRoles from "@/components/screen/master/UsersRoles";

const ICONS = { state: FiMap, district: FiMapPin, relation: FiLink, caste: FiTag, gotra: FiHash };

export default function MasterPage() {
  return <Suspense fallback={null}><Master /></Suspense>;
}

function Master() {
  const { message } = App.useApp();
  const can = useCan();
  const [lists, setLists] = useState({});
  const reload = useCallback(async () => {
    try { setLists((await api.get("/master-data", { all: 1, usage: 1 })).lists || {}); } catch (e) { message.error(e.message); }
  }, [message]);
  useEffect(() => { if (can("master")) reload(); }, [reload, can]);

  const items = useMemo(() => [
    ...(can("master") ? MASTER_TYPES.map((t) => {
      const Icon = ICONS[t.key];
      return {
        key: t.key,
        label: <span className="inline-flex items-center gap-1.5"><Icon /> {t.label} <span className="text-gray-400 text-xs">{(lists[t.key] || []).length}</span></span>,
        children: <MasterListTab type={t} lists={lists} reload={reload} />,
      };
    }) : []),
    ...(can("users") ? [
      { key: "users", label: <span className="inline-flex items-center gap-1.5"><FiUsers /> Users</span>, children: <UsersRoles show="users" /> },
      { key: "roles", label: <span className="inline-flex items-center gap-1.5"><FiShield /> Roles</span>, children: <UsersRoles show="roles" /> },
    ] : []),
  ], [can, lists, reload]);
  const [tab, setTab] = useQueryTab(items[0]?.key, items.map((i) => i.key));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Master Data</h1>
        <p className="text-gray-500 text-sm">Forms ki dropdown lists, staff users aur unke roles — sab yahan se.</p>
      </div>
      <Tabs items={items} activeKey={tab} onChange={setTab} destroyOnHidden />
    </div>
  );
}
