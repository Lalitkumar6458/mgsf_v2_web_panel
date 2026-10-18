'use client';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  App, Input, Select, Button, Tag, Tooltip, Modal,
  Drawer, Form, DatePicker, Spin, Avatar, Row, Col,
  Steps, Alert, InputNumber, Empty, Popconfirm, message as antdMessage, Badge, Checkbox
} from 'antd';
import dayjs from 'dayjs';
import {
  DollarOutlined, UserOutlined, SearchOutlined, FilterOutlined,
  CheckCircleOutlined, WarningOutlined, CloseOutlined, ReloadOutlined,
  CreditCardOutlined, WalletOutlined, TeamOutlined, UnorderedListOutlined,
  AppstoreOutlined, ThunderboltOutlined, CalendarOutlined, InfoCircleOutlined,
  SortAscendingOutlined, GlobalOutlined, PercentageOutlined,
  EyeOutlined, RocketOutlined, EditOutlined, SettingOutlined, TagOutlined
} from '@ant-design/icons';
import { api } from '@/lib/client/api';
import { useAuth } from '@/lib/AuthProvider';
import { useSelector } from 'react-redux';
import { getData } from '@/lib/services/firebaseService';
import BulkPaymentDrawer from '@/components/screen/payments/BulkPaymentDrawer';

import { AgGridReact } from 'ag-grid-react';
import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, ModuleRegistry, NumberEditorModule,
  NumberFilterModule, PaginationModule, RowSelectionModule,
  TextEditorModule, TextFilterModule, ValidationModule, RowStyleModule, CheckboxEditorModule
} from 'ag-grid-community';
import { amountsHidden, useAmountsHidden, MASK, AmountsEye } from "@/lib/client/privacy";

const { Option } = Select;
const { Search } = Input;
const { TextArea } = Input;

ModuleRegistry.registerModules([
  NumberEditorModule, TextEditorModule, TextFilterModule, NumberFilterModule,
  RowSelectionModule, PaginationModule, ClientSideRowModelModule, ClientSideRowModelApiModule,
  ValidationModule, RowStyleModule, CheckboxEditorModule
]);

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
// lists / totals: hidden until the eye is clicked (payment forms always show the real amount)
const fmtM = (n) => (amountsHidden() ? MASK : fmt(n));
const pct = (paid, total) => (total > 0 ? Math.round((paid / total) * 100) : 0);

// ─── API HELPER ───────────────────────────────────────────────────────────────
async function callApi(endpoint, options = {}) {
  // login cookie goes with the request automatically
  const res = await fetch(endpoint, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'API Error');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchPaymentDataAPI(programId) {
  return callApi(`/api/payments/fetch?programId=${programId}`);
}

async function processSinglePaymentAPI(payload) {
  return callApi('/api/payments/process', {
    method: 'POST',
    body: JSON.stringify({ type: 'single', ...payload }),
  });
}

async function processBulkPaymentAPI(payload) {
  return callApi('/api/payments/process', {
    method: 'POST',
    body: JSON.stringify({ type: 'bulk', ...payload }),
  });
}

async function checkDupRefAPI(programId, onlineReference) {
  try {
    await callApi('/api/payments/process', {
      method: 'POST',
      body: JSON.stringify({ type: 'single', programId, selectedClosingIds: [], payerId: '_check_only_', onlineReference, paymentMethod: 'online', _checkOnly: true }),
    });
    return false;
  } catch (err) {
    return err.status === 409;
  }
}

// ─── CLOSING GROUP DOT COLOR ───────────────────────────────────────────────────
const GROUP_COLORS = [
  '#6366f1', '#10b981', '#f97316', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#06b6d4',
];
function groupColor(id, index) {
  if (!id) return '#d1d5db';
  const hash = [...(id || '')].reduce((h, c) => h + c.charCodeAt(0), 0);
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

// ─── CLOSING DETAILS DRAWER ───────────────────────────────────────────────────
function MemberClosingsDrawer({ open, onClose, member, programId, user, closingGroupList }) {
  const [closings, setClosings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [groupFilter, setGroupFilter] = useState(null);

  // Build a map for quick lookup
  const closingGroupMap = useMemo(() => {
    const map = {};
    (closingGroupList || []).forEach(g => { map[g.id] = g; });
    return map;
  }, [closingGroupList]);

  useEffect(() => {
    if (!open || !member || !programId || !user) return;
    setGroupFilter(null);
    (async () => {
      setLoading(true);
      try {
        // every closing this member owes / paid, with the closing member's details — one call
        const { dues } = await api.get(`/members/${member.id}/dues`);
        const enriched = dues.map(d => ({
          id: d.id,
          memberId: member.id,
          closingMemberId: d.closingMemberId,
          status: d.status === 'paid' ? 'paid' : 'pending',
          payAmount: d.amount,
          paidAmount: d.paidAmount,
          closingMemberName: d.closingMemberName || '—',
          closingMemberReg: d.closingRegNo || '—',
          closingMemberPhoto: '',
          closingMemberFather: d.closingFatherName || '',
          marriageDate: d.closingDate ? d.closingDate.split('-').reverse().join('-') : '',
          closingGroupId: d.closingGroupId || null,
        }));
        setClosings(enriched);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [open, member, programId, user]);

  const pendingCount = closings.filter(c => c.status === 'pending').length;
  const paidCount = closings.filter(c => c.status === 'paid').length;

  // Groups present in this member's closings
  const availableGroups = useMemo(() => {
    const seen = {};
    for (const c of closings) {
      if (c.closingGroupId && !seen[c.closingGroupId]) {
        seen[c.closingGroupId] = closingGroupMap[c.closingGroupId]?.name || c.closingGroupId;
      }
    }
    return Object.entries(seen).map(([id, name]) => ({ id, name }));
  }, [closings, closingGroupMap]);

  const filteredClosings = useMemo(() => {
    if (!groupFilter) return closings;
    return closings.filter(c => c.closingGroupId === groupFilter);
  }, [closings, groupFilter]);

  return (
    <Drawer
      open={open} onClose={onClose} width={520}
      title={
        <div className="flex items-center gap-3">
          {member?.photoURL
            ? <Avatar src={member.photoURL} size={40} />
            : <Avatar size={40} style={{ background: `hsl(${(member?.displayName?.charCodeAt(0) || 0) * 7 % 360},55%,55%)`, fontWeight: 700 }}>
                {member?.displayName?.charAt(0)?.toUpperCase()}
              </Avatar>}
          <div>
            <div className="font-bold text-gray-900">{member?.displayName}</div>
            <div className="text-xs text-gray-400">{member?.registrationNumber} · Closing Details</div>
          </div>
        </div>
      }
    >
      <Row gutter={12} className="mb-4">
        {[
          { label: 'Total', value: closings.length, color: '#6366f1', bg: '#eef2ff' },
          { label: 'Pending', value: pendingCount, color: '#f97316', bg: '#fff7ed' },
          { label: 'Paid', value: paidCount, color: '#10b981', bg: '#ecfdf5' },
        ].map(s => (
          <Col xs={24} sm={12} lg={8} key={s.label}>
            <div className="rounded-xl p-3 text-center" style={{ background: s.bg }}>
              <div className="text-2xl font-black" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Closing Group filter */}
      {availableGroups.length > 0 && (
        <div className="mb-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <TagOutlined style={{ fontSize: 11 }} /> Filter by Closing Group
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="small"
              type={!groupFilter ? 'primary' : 'default'}
              className={`text-xs rounded-full ${!groupFilter ? 'bg-indigo-500 border-indigo-500' : ''}`}
              onClick={() => setGroupFilter(null)}
            >
              All ({closings.length})
            </Button>
            {availableGroups.map(g => (
              <Button key={g.id} size="small"
                type={groupFilter === g.id ? 'primary' : 'default'}
                className="text-xs rounded-full"
                style={groupFilter === g.id
                  ? { background: groupColor(g.id), borderColor: groupColor(g.id), color: '#fff' }
                  : { borderColor: `${groupColor(g.id)}60`, color: groupColor(g.id) }}
                onClick={() => setGroupFilter(prev => prev === g.id ? null : g.id)}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: groupFilter === g.id ? '#fff' : groupColor(g.id) }} />
                {g.name} ({closings.filter(c => c.closingGroupId === g.id).length})
              </Button>
            ))}
          </div>
        </div>
      )}

      {loading
        ? <div className="flex items-center justify-center py-16"><Spin /></div>
        : filteredClosings.length === 0
          ? <Empty description={groupFilter ? 'No closings in this group' : 'No closing entries found'} />
          : (
            <div className="space-y-3">
              {filteredClosings.map((c, i) => {
                const isPaid = c.status === 'paid';
                const isPartial = c.status === 'partial';
                const payAmount = c.payAmount || member?.payAmount || 200;
                const groupName = closingGroupMap[c.closingGroupId]?.name;
                return (
                  <div key={c.id}
                    className={`rounded-2xl border p-3 flex items-center gap-3 transition-all
                      ${isPaid ? 'bg-green-50 border-green-200' : isPartial ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
                    <div className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">{i + 1}</div>
                    {c.closingMemberPhoto
                      ? <Avatar src={c.closingMemberPhoto} size={36} className="flex-shrink-0" />
                      : <Avatar size={36} className="flex-shrink-0"
                          style={{ background: `hsl(${(c.closingMemberName?.charCodeAt(0) || 0) * 11 % 360},55%,55%)`, fontWeight: 700, fontSize: 13 }}>
                          {c.closingMemberName?.charAt(0)?.toUpperCase()}
                        </Avatar>}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-900 truncate">{c.closingMemberName}</div>
                      <div className="text-xs text-gray-400">{c.closingMemberReg}</div>
                      {c.closingMemberFather && <div className="text-xs text-gray-400 truncate">S/o {c.closingMemberFather}</div>}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {c.marriageDate && <div className="text-xs text-indigo-400"><CalendarOutlined className="mr-1" />{c.marriageDate}</div>}
                        {/* ✅ Show Closing Group name */}
                        {groupName && (
                          <span className="inline-flex items-center gap-1 text-xs rounded-full px-1.5 py-0.5"
                            style={{ background: `${groupColor(c.closingGroupId)}18`, color: groupColor(c.closingGroupId), border: `1px solid ${groupColor(c.closingGroupId)}40` }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: groupColor(c.closingGroupId) }} />
                            {groupName}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-sm text-gray-800">{fmt(c.paidAmount || 0)} / {fmt(payAmount)}</div>
                      {isPaid
                        ? <Tag color="success" className="text-xs mt-1"><CheckCircleOutlined /> Paid</Tag>
                        : isPartial
                          ? <Tag color="processing" className="text-xs mt-1">Partial</Tag>
                          : <Tag color="warning" className="text-xs mt-1">Pending</Tag>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
    </Drawer>
  );
}

// ─── BULK PAYMENT DRAWER: components/screen/payments/BulkPaymentDrawer.js ───

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function PaymentPage() {
  const amountsAreHidden = useAmountsHidden();
  const { message } = App.useApp();
  const { user } = useAuth();
  const programList = useSelector(state => state.data.programList);
  const selectedProgram = useSelector(state => state.data.selectedProgram);
  const agentList = useSelector(state => state.data.agentsList) || [];
  // ✅ Get closing groups from redux
  const closingGroupList = useSelector(state => state.data.closingGroupList) || [];

  const [membersData, setMembersData] = useState([]);
  const [summaryStats, setSummaryStats] = useState({ total: 0, totalAmount: 0, totalPaid: 0, totalPending: 0, membersWithPending: 0 });
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [agentFilter, setAgentFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);
  const [showBulk, setShowBulk] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [closingDrawerMember, setClosingDrawerMember] = useState(null);

  const gridRef = useRef();
  useEffect(() => { gridRef.current?.api?.refreshCells({ force: true }); }, [amountsAreHidden]);

  const fetchData = useCallback(async () => {
    if (!selectedProgram || !user) return;
    setLoading(true);
    try {
      const { members, summary } = await fetchPaymentDataAPI(selectedProgram.id);
      const enriched = members.map((member) => {
        const agentFromList = agentList?.find(a => a.id === member.agentId);
        return {
          ...member,
          agentName: agentFromList?.name || agentFromList?.displayName || member.agentName || '',
        };
      });
      setMembersData(enriched);
      setSummaryStats(summary);
    } catch (err) {
      console.error(err);
      if (err.status === 401) {
        message.error('Session expired. Please login again.');
      } else {
        message.error('Failed to load payment data');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedProgram, user, agentList]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredData = useMemo(() => {
    let data = [...membersData];
    if (searchText) {
      const s = searchText.toLowerCase();
      data = data.filter(r =>
        r.displayName?.toLowerCase().includes(s) ||
        r.fatherName?.toLowerCase().includes(s) ||
        r.registrationNumber?.toLowerCase().includes(s) ||
        r.phone?.includes(s)
      );
    }
    if (agentFilter) data = data.filter(r => r.agentId === agentFilter);
    if (statusFilter === 'pending') data = data.filter(r => r.totalPending > 0);
    else if (statusFilter === 'cleared') data = data.filter(r => r.paidPct === 100 && r.closingCount > 0);
    else if (statusFilter === 'partial') data = data.filter(r => r.totalPaid > 0 && r.paidPct < 100);
    else if (statusFilter === 'no_closings') data = data.filter(r => r.closingCount === 0);
    return data;
  }, [membersData, searchText, agentFilter, statusFilter]);

  const columnDefs = useMemo(() => [
    {
      field: 'displayName',
      headerName: 'Member',
      cellRenderer: ({ data: row }) => (
        <div className="flex items-center gap-2 h-full">
          <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${row.totalPending > 0 ? 'bg-red-400' : 'bg-green-400'}`} />
          <Avatar src={row.photoURL} size={32} className="flex-shrink-0"
            style={{ background: `hsl(${(row.displayName?.charCodeAt(0) || 0) * 7 % 360},55%,55%)`, fontSize: 12, fontWeight: 700 }}>
            {row.displayName?.charAt(0)?.toUpperCase()}
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800 truncate leading-tight">{row.displayName}</div>
            <div className="text-xs text-gray-400 truncate leading-tight">{row.registrationNumber}</div>
            {row.agentName && <div className="text-xs text-indigo-400 truncate leading-tight">↳ {row.agentName}</div>}
          </div>
        </div>
      )
    },
    {
      field: 'closingCount',
      headerName: 'Closings',
      cellRenderer: ({ data: row }) => (
        <div className="flex flex-col justify-center h-full gap-0.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-gray-600">{row.paidClosingCount} paid</span>
            </span>
            <span className="text-gray-300">·</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
              <span className="text-gray-600">{row.pendingClosingCount} due</span>
            </span>
          </div>
          <div className="text-xs text-gray-400">{row.closingCount} total · {fmtM(row.payAmount)}/closing</div>
          {row.closingCount > 0 && (
            <Button type="text" size="small"
              className="p-0 h-auto text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1 w-fit"
              icon={<EyeOutlined style={{ fontSize: 11 }} />}
              onClick={e => { e.stopPropagation(); setClosingDrawerMember(row); }}>
              View Closings
            </Button>
          )}
        </div>
      )
    },
    {
      field: 'totalAmount', headerName: 'Total',
      cellRenderer: ({ value }) => <span className="text-sm font-medium text-gray-500 tabular-nums">{fmtM(value)}</span>
    },
    {
      field: 'totalPaid', headerName: 'Paid',
      cellRenderer: ({ value }) => (
        <span className={`text-sm font-semibold tabular-nums ${value > 0 ? 'text-green-600' : 'text-gray-300'}`}>
          {value > 0 ? fmtM(value) : '—'}
        </span>
      )
    },
    {
      field: 'totalPending', headerName: 'Pending',
      cellRenderer: ({ value }) => (
        <span className={`text-sm font-semibold tabular-nums ${value > 0 ? 'text-red-500' : 'text-gray-300'}`}>
          {value > 0 ? fmtM(value) : '—'}
        </span>
      )
    },
    {
      field: 'paidPct', headerName: 'Progress',
      cellRenderer: ({ data: row }) => {
        if (row.closingCount === 0) return <Tag style={{ fontSize: 11 }}>No closings</Tag>;
        return (
          <div className="flex flex-col justify-center h-full gap-1">
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div className="h-1.5 rounded-full transition-all"
                style={{ width: `${row.paidPct}%`, background: row.paidPct === 100 ? '#10b981' : row.paidPct > 0 ? '#3b82f6' : '#f97316' }} />
            </div>
            <div className="text-xs text-gray-500">{row.paidPct}% cleared</div>
          </div>
        );
      }
    },
    {
      field: 'status', headerName: 'Status',
      cellRenderer: ({ data: row }) => {
        if (row.paidPct === 100 && row.closingCount > 0) return <Tag color="success" style={{ fontSize: 11 }}><CheckCircleOutlined /> Cleared</Tag>;
        if (row.totalPaid > 0) return <Tag color="processing" style={{ fontSize: 11 }}>Partial {row.paidPct}%</Tag>;
        if (row.closingCount > 0) return <Tag color="warning" style={{ fontSize: 11 }}>Pending</Tag>;
        return <Tag style={{ fontSize: 11 }}>No closings</Tag>;
      }
    }
  ], []);

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);

  const rowSelection = useMemo(() => ({
    mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false,
  }), []);

  const onSelectionChanged = useCallback(() => {
    setSelectedRows(gridRef.current?.api?.getSelectedRows() || []);
  }, []);

  const agentOptions = useMemo(() => {
    const memberAgentIds = new Set(membersData.map(m => m.agentId).filter(Boolean));
    return (agentList || []).filter(a => memberAgentIds.has(a.id)).map(a => ({
      id: a.id, name: a.name || a.displayName || a.id,
    }));
  }, [agentList, membersData]);

  const getRowStyle = useCallback(({ data }) => {
    if (data?.totalPending === 0 && data?.closingCount > 0) return { background: '#f0fdf4' };
    return null;
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 m-0">Payment Management</h1>
            {selectedProgram && <p className="text-xs text-gray-400 m-0">{selectedProgram.name}</p>}
          </div>
        </div>

        {selectedProgram && (
          <Row gutter={[10, 10]}>
            {[
              { label: 'Total Members', value: summaryStats.total, color: '#6366f1', bg: '#eef2ff', icon: <TeamOutlined /> },
              { label: 'Total Amount', value: fmtM(summaryStats.totalAmount), color: '#8b5cf6', bg: '#f5f3ff', icon: <DollarOutlined /> },
              { label: 'Total Paid', value: fmtM(summaryStats.totalPaid), color: '#10b981', bg: '#ecfdf5', icon: <CheckCircleOutlined /> },
              { label: 'Total Pending', value: fmtM(summaryStats.totalPending), color: '#f97316', bg: '#fff7ed', icon: <WarningOutlined /> },
              { label: 'Members w/ Dues', value: summaryStats.membersWithPending, color: '#ef4444', bg: '#fef2f2', icon: <UserOutlined /> },
            ].map(stat => (
              <Col key={stat.label} xs={12} sm={12} md={8} lg={6} xl={4}>
                <div className="bg-white rounded-xl border border-gray-100 px-3 py-3 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs text-gray-400 mb-0.5">{stat.label}</div>
                      <div className="text-base font-bold text-gray-900">
                        {loading ? <Spin size="small" /> : stat.value}
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                      style={{ background: stat.bg, color: stat.color }}>{stat.icon}</div>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        )}

        {selectedProgram && (
          <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 shadow-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Search placeholder="Search name, reg no, phone..."
                value={searchText} onChange={e => setSearchText(e.target.value)}
                allowClear size="small" className="flex-1" style={{ minWidth: 180 }} />
           <Select
  placeholder="All agents"
  size="small"
  style={{ minWidth: 150 }}
  value={agentFilter}
  onChange={setAgentFilter}
  allowClear
  showSearch
  optionFilterProp="children"
>
  {agentOptions.map((a) => (
    <Option key={a.id} value={a.id}>
      {a.name}
    </Option>
  ))}
</Select>
              <Select placeholder="All status" allowClear size="small" style={{ minWidth: 130 }}
                value={statusFilter} onChange={setStatusFilter}>
                <Option value="pending">Pending</Option>
                <Option value="partial">Partial</Option>
                <Option value="cleared">Cleared</Option>
                <Option value="no_closings">No Closings</Option>
              </Select>
              <Button icon={<ReloadOutlined />} onClick={fetchData} size="small" type="text">Refresh</Button>
              <Tooltip title="Abhi dikh rahe sabhi baki wale sadasya chunein — phir 'Process Bulk Payment'">
                <Button size="small" icon={<CheckCircleOutlined />}
                  onClick={() => gridRef.current?.api?.forEachNodeAfterFilterAndSort((n) => n.setSelected((n.data?.totalPending || 0) > 0))}>
                  Baki wale sab chunein
                </Button>
              </Tooltip>
              {selectedRows.length > 0 && (
                <Button size="small" type="text"
                  onClick={() => { gridRef.current?.api?.deselectAll(); setSelectedRows([]); }}
                  icon={<CloseOutlined />}>Clear ({selectedRows.length})</Button>
              )}
            </div>
          </div>
        )}

        {selectedRows.length > 0 && (
          <Alert type="info" showIcon
            message={
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span>
                  <strong>{selectedRows.length}</strong> members selected ·
                  Total Pending: <strong className="text-orange-600">
                    {fmtM(selectedRows.reduce((s, r) => s + (r.totalPending || 0), 0))}
                  </strong>
                </span>
                <Button size="small" type="primary" icon={<ThunderboltOutlined />}
                  onClick={() => setShowBulk(true)}
                  className="bg-gradient-to-r from-amber-500 to-orange-500 border-0">
                  Process Bulk Payment
                </Button>
              </div>
            }
          />
        )}

        {selectedProgram ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ag-theme-alpine"
            style={{ height: '65vh', width: '100%' }}>
            <AgGridReact
              ref={gridRef}
              rowData={filteredData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              loading={loading}
              rowHeight={70}
              pagination={true}
              paginationPageSize={100}
              paginationPageSizeSelector={[20, 50, 100]}
              rowSelection={rowSelection}
              onSelectionChanged={onSelectionChanged}
              getRowStyle={getRowStyle}
              suppressRowClickSelection={true}
              overlayLoadingTemplate='<span class="ag-overlay-loading-center">Loading members...</span>'
              overlayNoRowsTemplate='<span class="ag-overlay-loading-center">No members found</span>'
            />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-16 text-center shadow-sm">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <AppstoreOutlined className="text-indigo-400 text-2xl" />
            </div>
            <h3 className="text-gray-600 font-semibold mb-1">Select a Program</h3>
            <p className="text-gray-400 text-sm">Choose a program from above to view and manage payments</p>
          </div>
        )}
      </div>

      <BulkPaymentDrawer
        open={showBulk}
        onClose={() => setShowBulk(false)}
        selectedRows={selectedRows}
        programId={selectedProgram?.id}
        programName={selectedProgram?.name}
        user={user}
        closingGroupList={closingGroupList}
        onSuccess={() => {
          fetchData();
          gridRef.current?.api?.deselectAll();
          setSelectedRows([]);
        }}
      />

      <MemberClosingsDrawer
        open={!!closingDrawerMember}
        onClose={() => setClosingDrawerMember(null)}
        member={closingDrawerMember}
        programId={selectedProgram?.id}
        user={user}
        closingGroupList={closingGroupList}
      />
    </div>
  );
}