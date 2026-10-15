// components/AllPaymentStatus.jsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthProvider';
import { useSelector } from 'react-redux';
import { AgGridReact } from 'ag-grid-react';
import {
  ClientSideRowModelModule, ModuleRegistry, NumberEditorModule,
  NumberFilterModule, PaginationModule, RowSelectionModule,
  TextEditorModule, TextFilterModule, ValidationModule,
  RowStyleModule, CellStyleModule, CsvExportModule,
} from 'ag-grid-community';
import { PDFDownloadLink, PDFViewer } from '@react-pdf/renderer';
import AllPaymentPdf from './AllPaymentPdf';
import { Badge, Button, Drawer, Dropdown, Segmented, Select, Space, Spin, message } from 'antd';
import {
  DownloadOutlined, FolderOpenOutlined, TeamOutlined, ReloadOutlined,
  FilePdfOutlined, ClockCircleOutlined, CheckCircleOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

ModuleRegistry.registerModules([
  NumberEditorModule, TextEditorModule, TextFilterModule, NumberFilterModule,
  RowSelectionModule, PaginationModule, ClientSideRowModelModule,
  ValidationModule, RowStyleModule, CellStyleModule, CsvExportModule,
]);

const { Option } = Select;

// ── Cell Renderers ────────────────────────────────────────────────────────────
const StatusRenderer = ({ value }) => {
  if (!value) return null;
  const map = {
    paid: { label: 'Paid', bg: '#dcfce7', color: '#166534' },
    pending: { label: 'Pending', bg: '#fef9c3', color: '#854d0e' },
    both: { label: 'Both', bg: '#dbeafe', color: '#1e40af' },
    none: { label: 'No Payment', bg: '#f1f5f9', color: '#64748b' },
  };
  const s = map[value] || {};
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      letterSpacing: 0.4, background: s.bg, color: s.color, display: 'inline-block'
    }}>
      {s.label}
    </span>
  );
};

const CurrencyRenderer = ({ value }) =>
  value ? `₹${Number(value).toLocaleString('en-IN')}` : '₹0';

const COL_DEFS = [
  { headerName: '#', field: 'index', width: 60, pinned: 'left', cellStyle: { fontWeight: 700, color: '#6b7280' } },
  { headerName: 'Reg. No.', field: 'registrationNumber', width: 110, pinned: 'left', cellStyle: { fontWeight: 700 } },
  { headerName: 'Member Name', field: 'memberName', minWidth: 170, cellStyle: { fontWeight: 600 } },
  { headerName: 'Father Name', field: 'fatherName', minWidth: 140 },
  { headerName: 'Phone', field: 'phone', width: 130 },
  { headerName: 'Village', field: 'village', minWidth: 120 },
  { headerName: 'Program', field: 'programName', minWidth: 180, cellStyle: { fontWeight: 600, color: '#4f46e5' } },
  { headerName: 'Pending (₹)', field: 'totalPending', width: 130, cellRenderer: CurrencyRenderer, type: 'numericColumn', cellStyle: { fontWeight: 700, color: '#dc2626' } },
  { headerName: 'Paid (₹)', field: 'totalPaid', width: 120, cellRenderer: CurrencyRenderer, type: 'numericColumn', cellStyle: { fontWeight: 700, color: '#059669' } },
  { headerName: 'Status', field: 'status', width: 100, cellRenderer: StatusRenderer },
  { headerName: 'Pending #', field: 'pendingCount', width: 105, type: 'numericColumn', cellStyle: { background: '#fef3c7', fontWeight: 600 } },
  { headerName: 'Paid #', field: 'paidCount', width: 95, type: 'numericColumn', cellStyle: { background: '#dcfce7', fontWeight: 600 } },
];

// Columns for the "Closed Members" view — the agent's own members whose closing
// has already happened. Amounts here are what was COLLECTED FOR them by others,
// which is the opposite direction to the main payments grid.
const CLOSED_COL_DEFS = [
  { headerName: '#', field: 'index', width: 60, pinned: 'left', cellStyle: { fontWeight: 700, color: '#6b7280' } },
  { headerName: 'Reg. No.', field: 'registrationNumber', width: 110, pinned: 'left', cellStyle: { fontWeight: 700 } },
  { headerName: 'Member Name', field: 'memberName', minWidth: 170, cellStyle: { fontWeight: 600 } },
  { headerName: 'Father Name', field: 'fatherName', minWidth: 140 },
  { headerName: 'Phone', field: 'phone', width: 130 },
  { headerName: 'Village', field: 'village', minWidth: 120 },
  { headerName: 'Closing Date', field: 'closingDate', width: 130, cellStyle: { fontWeight: 700, color: '#7c3aed' } },
  { headerName: 'Closing Group', field: 'closingGroupName', minWidth: 150, cellStyle: { color: '#0369a1' } },
  { headerName: 'Collected (₹)', field: 'collectedForMember', width: 135, cellRenderer: CurrencyRenderer, type: 'numericColumn', cellStyle: { fontWeight: 700, color: '#059669' } },
  { headerName: 'Due (₹)', field: 'dueForMember', width: 120, cellRenderer: CurrencyRenderer, type: 'numericColumn', cellStyle: { fontWeight: 700, color: '#dc2626' } },
  { headerName: 'Paid #', field: 'contributorsPaid', width: 95, type: 'numericColumn', cellStyle: { background: '#dcfce7', fontWeight: 600 } },
  { headerName: 'Pending #', field: 'contributorsPending', width: 105, type: 'numericColumn', cellStyle: { background: '#fef3c7', fontWeight: 600 } },
];

const DEFAULT_COL = { sortable: true, filter: true, resizable: true, flex: 1, minWidth: 100 };

const SummaryCard = ({ label, value, color, sub }) => (
  <div style={{
    background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12,
    padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', minWidth: 130
  }}>
    <p style={{
      fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: 0.5, marginBottom: 4
    }}>{label}</p>
    <p style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1, margin: 0 }}>{value}</p>
    {sub && <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{sub}</p>}
  </div>
);

// ── API Helper with AbortController ───────────────────────────────────────────
async function callApi(endpoint, data, timeout = 30000) {
  // login cookie is sent automatically (same site)

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseData = await res.json();
    
    if (!res.ok) {
      const err = new Error(responseData.error || 'API Error');
      err.status = res.status;
      throw err;
    }
    
    return responseData;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────
const AllPaymentStatus = ({ agentId, agentInfo }) => {
  const { user } = useAuth();
  const programList = useSelector((state) => state.data.programList);

  const [selectedProgramId, setSelectedProgramId] = useState(null);
  const [closingGroups, setClosingGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [closedRows, setClosedRows] = useState([]);
  // 'payments' = normal grid · 'closed' = agent's own members who are closed
  const [view, setView] = useState('payments');
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const gridRef = useRef();
const [pdfLoading, setPdfLoading] = useState(false);
  // Auto-select first program
  useEffect(() => {
    if (programList?.length > 0 && !selectedProgramId) {
      setSelectedProgramId(programList[0].id);
    }
  }, [programList]);

  // Fetch whenever program or group changes
  useEffect(() => {
    if (user?.uid && selectedProgramId) {
      fetchPaymentData(selectedProgramId, selectedGroupId);
    } else {
      setRowData([]);
      setClosedRows([]);
      setClosingGroups([]);
    }
  }, [selectedProgramId, selectedGroupId, user?.uid]);

  // ── API call with POST method ──────────────────────────────────────────────
  const fetchPaymentData = useCallback(async (programId, groupId) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await callApi('/api/all-payment-status', {
        agentId,
        programId,
        groupId: groupId || undefined,
      });
      
      setRowData(data.rows || []);
      setClosedRows(data.closedRows || []);
      setClosingGroups(data.closingGroups || []);

      if (data.rows?.length === 0) {
        message.info('No payment records found');
      }
    } catch (err) {
      console.error('[AllPaymentStatus]', err);
      setError(err.message);
      setRowData([]);
      setClosedRows([]);
      message.error(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    if (selectedProgramId) {
      fetchPaymentData(selectedProgramId, selectedGroupId);
    }
  }, [selectedProgramId, selectedGroupId, fetchPaymentData]);

  // ── Derived totals ─────────────────────────────────────────────────────────
  const totals = rowData.reduce(
    (acc, r) => ({
      paid: acc.paid + (r.totalPaid || 0),
      pending: acc.pending + (r.totalPending || 0),
      paidCnt: acc.paidCnt + (r.paidCount || 0),
      pendCnt: acc.pendCnt + (r.pendingCount || 0),
    }),
    { paid: 0, pending: 0, paidCnt: 0, pendCnt: 0 }
  );

  const uniqueMembers = new Set(rowData.map((r) => r.registrationNumber)).size;
  const selectedGroup = closingGroups.find((g) => g.id === selectedGroupId);

  const getFileName = () => {
    const name = agentInfo?.displayName?.replace(/\s+/g, '_') || 'Agent';
    return `${name}_Payment_${dayjs().format('DDMMYYYY')}.pdf`;
  };

  // ── PDF filtering ────────────────────────────────────────────────────────
  // 'all'     → every active member (including members with no closing payment)
  // 'pending' → only members who still owe something
  // 'paid'    → only members who have paid something
  const filterRowsForPdf = useCallback(
    (mode) => {
      if (mode === 'pending') return rowData.filter((r) => (r.pendingCount || 0) > 0);
      if (mode === 'paid')    return rowData.filter((r) => (r.paidCount    || 0) > 0);
      return rowData;
    },
    [rowData]
  );

  // Closed members split by what has been collected FOR them:
  // 'closed_paid'    → nothing left to collect (all contributors paid)
  // 'closed_pending' → still some amount due from contributors
  const filterClosedRows = useCallback(
    (mode) => {
      if (mode === 'closed_paid')
        return closedRows.filter((r) => (r.contributorsPaid || 0) > 0 && (r.contributorsPending || 0) === 0);
      if (mode === 'closed_pending')
        return closedRows.filter((r) => (r.contributorsPending || 0) > 0);
      return closedRows;
    },
    [closedRows]
  );

  const generatePdf = useCallback(async (mode = 'all') => {
    const source = mode.startsWith('closed') ? filterClosedRows(mode) : filterRowsForPdf(mode);
    const rows = source.map((r, i) => ({ ...r, index: i + 1 }));

    if (rows.length === 0) {
      message.warning(
        mode === 'paid'
          ? 'No member has any paid payment.'
          : mode === 'pending'
            ? 'No member has any pending payment.'
            : mode === 'closed'
              ? 'No closed member for this agent.'
              : mode === 'closed_paid'
                ? 'No closed member is fully paid yet.'
                : mode === 'closed_pending'
                  ? 'No closed member has pending amount.'
              : 'No records to export.'
      );
      return;
    }

    setPdfLoading(true);
    try {
      const response = await fetch('/api/all-payment-pdf', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rowData: rows, agentInfo, paymentStatus: mode }),
      });

      if (!response.ok) throw new Error('Failed to generate PDF');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');

      message.success(`PDF ready — ${rows.length} member(s)`);
    } catch (err) {
      console.error('PDF generation error:', err);
      message.error('Failed to generate PDF. Please try again.');
    } finally {
      setPdfLoading(false);
    }
  }, [filterRowsForPdf, filterClosedRows, agentInfo]);

  const pdfMenuItems = [
    {
      key: 'all',
      label: `All Members (${filterRowsForPdf('all').length})`,
      icon: <UnorderedListOutlined />,
    },
    {
      key: 'pending',
      label: `Only Pending (${filterRowsForPdf('pending').length})`,
      icon: <ClockCircleOutlined />,
      disabled: filterRowsForPdf('pending').length === 0,
    },
    {
      key: 'paid',
      label: `Only Paid (${filterRowsForPdf('paid').length})`,
      icon: <CheckCircleOutlined />,
      disabled: filterRowsForPdf('paid').length === 0,
    },
    { type: 'divider' },
    {
      key: 'closed',
      label: `Closed Members (${closedRows.length})`,
      icon: <TeamOutlined />,
      disabled: closedRows.length === 0,
    },
    {
      key: 'closed_pending',
      label: `Closed – Pending (${filterClosedRows('closed_pending').length})`,
      icon: <ClockCircleOutlined />,
      disabled: filterClosedRows('closed_pending').length === 0,
    },
    {
      key: 'closed_paid',
      label: `Closed – Fully Paid (${filterClosedRows('closed_paid').length})`,
      icon: <CheckCircleOutlined />,
      disabled: filterClosedRows('closed_paid').length === 0,
    },
  ];
  return (
    <div style={{ padding: '20px 24px', background: '#f8fafc', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: -0.5 }}>
            Payment Status
          </h2>
          <p style={{
            fontSize: 13, color: '#94a3b8', margin: '4px 0 0', display: 'flex',
            alignItems: 'center', gap: 8, flexWrap: 'wrap'
          }}>
            {agentInfo?.displayName || 'Agent'} · {rowData.length} records
            {selectedGroup && (
              <span style={{
                background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 20,
                padding: '1px 10px 1px 8px', fontSize: 12, fontWeight: 600, color: '#1d4ed8',
                display: 'inline-flex', alignItems: 'center', gap: 4
              }}>
                <FolderOpenOutlined style={{ fontSize: 11 }} />
                {selectedGroup.name}
                <span onClick={() => setSelectedGroupId(null)}
                  style={{ cursor: 'pointer', marginLeft: 2, color: '#93c5fd', fontWeight: 900 }}>×</span>
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Select
            placeholder="Select Program"
            style={{ minWidth: 260 }}
            value={selectedProgramId}
            onChange={(val) => {
              setSelectedProgramId(val);
              setSelectedGroupId(null);
            }}
            showSearch
            optionFilterProp="children"
            allowClear
            size="large"
          >
            {programList?.map((p) => <Option key={p.id} value={p.id}>{p.name}</Option>)}
          </Select>

          <Select
            placeholder="Filter by Closing Group"
            value={selectedGroupId}
            onChange={(val) => setSelectedGroupId(val ?? null)}
            style={{ minWidth: 230 }}
            allowClear
            showSearch
            optionFilterProp="children"
            size="large"
            suffixIcon={<FolderOpenOutlined />}
            disabled={!selectedProgramId || isLoading}
          >
            {closingGroups.map((group) => (
              <Option key={group.id} value={group.id}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TeamOutlined style={{ color: '#1677ff' }} />
                  {group.name}
                  <Badge count={group.memberCount} showZero
                    style={{ backgroundColor: '#52c41a', fontSize: 10, marginLeft: 4 }} />
                </span>
              </Option>
            ))}
          </Select>

          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={isLoading}
            size="large"
          >
            Refresh
          </Button>

          <Button
            icon={<DownloadOutlined />}
            onClick={() => gridRef.current?.api?.exportDataAsCsv({ fileName: 'payment_status.csv' })}
            size="large"
            style={{ background: '#10b981', color: '#fff', border: 'none' }}
          >
            CSV
          </Button>
          
          <Dropdown
            menu={{ items: pdfMenuItems, onClick: ({ key }) => generatePdf(key) }}
            disabled={!rowData.length || pdfLoading}
          >
            <Button
              icon={<FilePdfOutlined />}
              loading={pdfLoading}
              disabled={!rowData.length}
              size="large"
              style={{ background: '#4f46e5', color: '#fff', border: 'none' }}
            >
              {pdfLoading ? 'Generating...' : 'PDF'}
            </Button>
          </Dropdown>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13, fontWeight: 600
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading spinner */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" tip="Loading payment data..." />
        </div>
      )}

      {/* Summary Cards */}
      {!isLoading && rowData.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <SummaryCard label="Total Paid" value={`₹${totals.paid.toLocaleString('en-IN')}`} color="#059669" />
          <SummaryCard label="Total Pending" value={`₹${totals.pending.toLocaleString('en-IN')}`} color="#dc2626" />
          <SummaryCard label="Paid Count" value={totals.paidCnt} color="#059669" sub="payments" />
          <SummaryCard label="Pending Count" value={totals.pendCnt} color="#f59e0b" sub="payments" />
          <SummaryCard label="Members" value={uniqueMembers} color="#4f46e5" />
          <SummaryCard label="Closed Members" value={closedRows.length} color="#7c3aed" sub="समापन हो चुका" />
          {selectedGroup && (
            <SummaryCard label="Closing Group" value={selectedGroup.name} color="#0369a1" sub="group filter active" />
          )}
        </div>
      )}

      {/* Empty states */}
      {!isLoading && !selectedProgramId && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ fontSize: 16, fontWeight: 600 }}>Select a program to view payment data</p>
        </div>
      )}

      {!isLoading && selectedProgramId && rowData.length === 0 && selectedGroupId && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
          <p style={{ fontSize: 16, fontWeight: 600 }}>No payment records found for this closing group</p>
          <Button onClick={() => setSelectedGroupId(null)} style={{ marginTop: 12 }}>
            Clear Group Filter
          </Button>
        </div>
      )}

      {/* View switch — payments vs the agent's own closed members */}
      {!isLoading && selectedProgramId && rowData.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={view}
            onChange={setView}
            size="large"
            options={[
              {
                value: 'payments',
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <UnorderedListOutlined /> Payments ({rowData.length})
                  </span>
                ),
              },
              {
                value: 'closed',
                disabled: closedRows.length === 0,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <TeamOutlined /> Closed Members ({closedRows.length})
                  </span>
                ),
              },
            ]}
          />
          {view === 'closed' && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#94a3b8' }}>
              इस एजेंट के वो सदस्य जिनका समापन हो चुका है — राशि उनके लिए इकट्ठा हुई है
            </span>
          )}
        </div>
      )}

      {/* Grid */}
      {!isLoading && selectedProgramId && rowData.length > 0 && (
        <div className="ag-theme-alpine" style={{
          height: 'calc(100vh - 340px)', borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          border: view === 'closed'
            ? '2px solid #ddd6fe'
            : selectedGroupId ? '2px solid #93c5fd' : '1px solid #e2e8f0'
        }}>
          <AgGridReact
            ref={gridRef}
            rowData={view === 'closed' ? closedRows : rowData}
            defaultColDef={DEFAULT_COL}
            columnDefs={view === 'closed' ? CLOSED_COL_DEFS : COL_DEFS}
            pagination
            paginationPageSize={50}
            paginationPageSizeSelector={[20, 50, 100, 200]}
            enableCellTextSelection
            ensureDomOrder
            animateRows
            overlayNoRowsTemplate='<span style="font-size:14px;color:#6b7280">No records found</span>'
          />
        </div>
      )}

      {/* PDF Drawer */}
      <Drawer
        title={<span style={{ fontWeight: 700, fontSize: 15 }}>{getFileName()}</span>}
        width={820}
        placement="right"
        onClose={() => setOpen(false)}
        open={open}
        destroyOnHidden
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setOpen(false)} size="large">Cancel</Button>
            <PDFDownloadLink
              document={<AllPaymentPdf rowData={rowData}
                agentInfo={{
                  ...agentInfo,
                  uid: user?.uid,
                  displayName: agentInfo?.displayName || user?.displayName,
                  phone: agentInfo?.phone || user?.phoneNumber
                }} />}
              fileName={getFileName()}
            >
              {({ loading }) => (
                <Button type="primary" icon={<DownloadOutlined />} size="large" loading={loading}>
                  Download PDF
                </Button>
              )}
            </PDFDownloadLink>
          </Space>
        }
      >
        <PDFViewer style={{ width: '100%', height: '100vh', border: 'none' }}>
          <AllPaymentPdf rowData={rowData}
            agentInfo={{
              ...agentInfo,
              uid: user?.uid,
              displayName: agentInfo?.displayName || user?.displayName,
              phone: agentInfo?.phone || user?.phoneNumber
            }} />
        </PDFViewer>
      </Drawer>
    </div>
  );
};

export default AllPaymentStatus;