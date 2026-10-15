"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useAuth } from '@/lib/AuthProvider';
import { fetchAllTransactions } from '@/lib/services/firebaseService';
import { api } from '@/lib/client/api';
import {
  Button, Space, Modal, App, Card, Row, Col, DatePicker, Select, Input,
  Tag, Tooltip, Divider, Typography, Alert, Drawer, Segmented, Badge, Table, Progress, Spin,
} from 'antd';
import {
  DeleteOutlined, EyeOutlined, DownloadOutlined, ReloadOutlined, DollarOutlined,
  UserOutlined, ExclamationCircleOutlined, FilePdfOutlined, SearchOutlined,
  CalendarOutlined, FileExcelOutlined, CloseCircleOutlined, BankOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import dynamic from 'next/dynamic';
import { amountsHidden, useAmountsHidden, MASK, AmountsEye } from "@/lib/client/privacy";

const AddPaymentModal = dynamic(
  () => import('@/components/common/addPayment/AddPaymentModal'),
  { ssr: false, loading: () => <Button type="primary" loading>Add Payment</Button> }
);

dayjs.extend(isBetween);

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text } = Typography;

// ─── Quick-range presets ─────────────────────────────────────────────────────
const QUICK_RANGES = {
  today: { label: 'Today',      start: () => dayjs().startOf('day'),   end: () => dayjs().endOf('day') },
  week:  { label: 'This Week',  start: () => dayjs().startOf('week'),  end: () => dayjs().endOf('week') },
  month: { label: 'This Month', start: () => dayjs().startOf('month'), end: () => dayjs().endOf('month') },
  months3: { label: 'Last 3 Months', start: () => dayjs().subtract(2, 'month').startOf('month'), end: () => dayjs().endOf('day') },
  custom: { label: 'Custom', start: null, end: null },
};

// ─── Firestore filter builder ────────────────────────────────────────────────

// ─── CSV export ──────────────────────────────────────────────────────────────
function exportToCSV(transactions, programName) {
  const headers = [
    'S.No', 'TRX ID', 'Date', 'Payer Name', 'Payer Reg.No', 'Payer Father',
    'Payer Phone', 'Beneficiary Name', 'Beneficiary Reg.No', 'Marriage Date',
    'Amount (Rs)', 'Payment Method', 'Online Reference', 'Note',
    'Program', 'Batch ID', 'Full Payment', 'Status', 'Created At'
  ];
  const rows = transactions.map((t, i) => [
    i + 1,
    t.transactionNumber || '',
    t.paymentDate ? dayjs(t.paymentDate).format('DD/MM/YYYY HH:mm') : '',
    t.payerName || '',
    t.payerRegistrationNumber || '',
    t.payerFatherName || '',
    t.payerPhone || '',
    t.marriageMemberName || '',
    t.marriageRegistrationNumber || '',
    t.marriageDate || '',
    t.amount || 0,
    t.paymentMethod || '',
    t.onlineReference || '',
    t.note || '',
    t.programName || '',
    t.batchId || '',
    t.isFullPayment ? 'Yes' : 'No',
    t.status || '',
    t.createdAt ? dayjs(t.createdAt).format('DD/MM/YYYY HH:mm') : '',
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Transactions_${programName?.replace(/\s+/g, '_') || 'Export'}_${dayjs().format('DDMMYYYY_HHmm')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────────────
const TransactionsPage = () => {
  useAmountsHidden(); // re-render on show / hide amounts
  const { user } = useAuth();
  const { message: antdMessage, modal } = App.useApp();
  const selectedProgram = useSelector((state) => state.data.selectedProgram);
  const programRef = useRef(selectedProgram);

  const [transactions, setTransactions]   = useState([]);
  const [loading, setLoading]             = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false);
  const [quickRange, setQuickRange]       = useState('today');
  const [customRange, setCustomRange]     = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [searchInput, setSearchInput]     = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [summary, setSummary] = useState({
    totalAmount: 0, totalTransactions: 0,
    cashCount: 0, onlineCount: 0, cashAmount: 0, onlineAmount: 0
  });
  const searchTimer = useRef(null);
  // server-made PDF: { status: 'idle'|'loading'|'done'|'error', url, error, rows, startedAt }
  const [pdfState, setPdfState] = useState({ status: 'idle' });
  const pdfAbort = useRef(null);
  const [pdfTick, setPdfTick] = useState(0);

  // Derived date range
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (quickRange !== 'custom') {
      const p = QUICK_RANGES[quickRange];
      return { rangeStart: p.start(), rangeEnd: p.end() };
    }
    if (customRange?.[0] && customRange?.[1]) {
      return { rangeStart: customRange[0].startOf('day'), rangeEnd: customRange[1].endOf('day') };
    }
    return { rangeStart: null, rangeEnd: null };
  }, [quickRange, customRange]);

  useEffect(() => { programRef.current = selectedProgram; }, [selectedProgram]);

  const handleSearchChange = (value) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    if (!value.trim()) { setSearchKeyword(''); return; }
    searchTimer.current = setTimeout(() => setSearchKeyword(value.trim().toLowerCase()), 400);
  };

  const fetchTransactions = useCallback(async () => {
    if (!user) { antdMessage.error('User not authenticated'); return; }
    const program = programRef.current;
    if (!program) {
      setTransactions([]);
      setSummary({ totalAmount: 0, totalTransactions: 0, cashCount: 0, onlineCount: 0, cashAmount: 0, onlineAmount: 0 });
      return;
    }
    setLoading(true);
    try {
      // the server filters by date range and search text; payment method is filtered here
      const raw = await fetchAllTransactions(program.id, {
        status: 'completed',
        from: rangeStart && rangeEnd ? dayjs(rangeStart).format('YYYY-MM-DD') : undefined,
        to: rangeStart && rangeEnd ? dayjs(rangeEnd).format('YYYY-MM-DD') : undefined,
        q: searchKeyword || undefined,
      });
      if (raw.capped) antdMessage.warning(`Showing the latest ${raw.cap.toLocaleString('en-IN')} payments only — choose a shorter date range.`, 6);
      const data = raw
        .filter(t => !paymentMethod || paymentMethod === 'all' || t.paymentMethod === paymentMethod)
        .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)));
      setTransactions(data);
      const totalAmount  = data.reduce((s, t) => s + (t.amount || 0), 0);
      const cashTxns     = data.filter(t => t.paymentMethod === 'cash');
      const onlineTxns   = data.filter(t => t.paymentMethod !== 'cash');
      const cashAmount   = cashTxns.reduce((s, t) => s + (t.amount || 0), 0);
      const onlineAmount = onlineTxns.reduce((s, t) => s + (t.amount || 0), 0);
      setSummary({
        totalAmount, totalTransactions: data.length,
        cashCount: cashTxns.length, onlineCount: onlineTxns.length, cashAmount, onlineAmount
      });
    } catch (err) {
      console.error(err);
      antdMessage.error('Failed to load transactions. ' + (err?.message || ''));
    } finally { setLoading(false); }
  }, [user, antdMessage, rangeStart, rangeEnd, paymentMethod, searchKeyword]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions, selectedProgram]);

  const handleDelete = async (transaction) => {
    if (!user) { antdMessage.error('User not authenticated'); return; }
    const program = programRef.current;
    if (!program) { antdMessage.error('No program selected.'); return; }
    setDeleteLoading(true);
    try {
      // marked "reversed" (kept for audit) and the amount goes back to the member's pending payment
      await api.post(`/transactions/${transaction.id}/reverse`, { reason: 'Deleted from Payments page' });
      antdMessage.success(transaction.paymentPendingId
        ? 'Transaction deleted and pending payment restored'
        : 'Transaction deleted successfully');
      setTransactions(prev => prev.filter(t => t.id !== transaction.id));
      setViewModalVisible(false);
      fetchTransactions();
    } catch (err) {
      antdMessage.error(`Failed to delete: ${err.message || 'Unknown error'}`);
    } finally { setDeleteLoading(false); }
  };

  const showDeleteConfirm = (transaction) => {
    if (!programRef.current) { antdMessage.error('No program selected.'); return; }
    modal.confirm({
      title: 'Delete Transaction',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Alert message="The payment will be removed from totals (kept in records as reversed)." type="warning" showIcon />
          <div style={{ background: '#fafafa', borderRadius: 8, padding: '10px 14px' }}>
            {[
              ['TRX ID',      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{transaction.transactionNumber}</span>],
              ['Amount',      <span style={{ color: '#52c41a', fontWeight: 700 }}>{amountsHidden() ? MASK : `₹${transaction.amount?.toLocaleString('en-IN')}`}</span>],
              ['Payer',       transaction.payerName || '-'],
              ['Beneficiary', transaction.marriageMemberName || '-'],
              ['Date',        transaction.paymentDate ? dayjs(transaction.paymentDate).format('DD/MM/YYYY') : '-'],
            ].map(([lbl, val]) => (
              <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                <span style={{ color: '#8c8c8c' }}>{lbl}</span>
                <span>{val}</span>
              </div>
            ))}
          </div>
          {transaction.paymentPendingId && (
            <Alert message="Linked pending payment will be reverted to 'pending'." type="info" showIcon />
          )}
        </div>
      ),
      okText: 'Delete', okType: 'danger', cancelText: 'Cancel',
      okButtonProps: { loading: deleteLoading },
      onOk: () => handleDelete(transaction),
    });
  };

  const handleView = (t) => { setSelectedTransaction(t); setViewModalVisible(true); };

  const getFileName = useCallback(() => {
    const p = selectedProgram?.name?.replace(/\s+/g, '_') || 'Program';
    return `${p}_Transactions_${transactions.length}_${dayjs().format('DDMMYYYY')}.pdf`;
  }, [selectedProgram, transactions.length]);

  // ── PDF: drawn on the server (worker thread) so the browser never freezes ──
  const closePdf = useCallback(() => {
    pdfAbort.current?.abort();
    pdfAbort.current = null;
    setPdfDrawerOpen(false);
    setPdfState((cur) => { if (cur.url) URL.revokeObjectURL(cur.url); return { status: 'idle' }; });
  }, []);

  const makePdf = useCallback(async () => {
    const program = programRef.current;
    if (!program || !transactions.length) { antdMessage.warning('No data'); return; }
    pdfAbort.current?.abort();
    const ctrl = new AbortController();
    pdfAbort.current = ctrl;
    setPdfDrawerOpen(true);
    setPdfState((cur) => { if (cur.url) URL.revokeObjectURL(cur.url); return { status: 'loading', rows: transactions.length, startedAt: Date.now() }; });
    const qs = new URLSearchParams();
    if (rangeStart && rangeEnd) { qs.set('from', rangeStart.format('YYYY-MM-DD')); qs.set('to', rangeEnd.format('YYYY-MM-DD')); }
    if (searchKeyword) qs.set('q', searchKeyword);
    if (paymentMethod !== 'all') qs.set('method', paymentMethod);
    try {
      const res = await fetch(`/api/programs/${program.id}/transactions/report?${qs}`, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `PDF nahi bana (${res.status})`);
      }
      const blob = await res.blob();
      if (ctrl.signal.aborted) return;
      setPdfState({ status: 'done', url: URL.createObjectURL(blob), rows: Number(res.headers.get('X-Rows')) || transactions.length, size: blob.size });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setPdfState({ status: 'error', error: e.message || 'PDF nahi bana' });
    } finally {
      if (pdfAbort.current === ctrl) pdfAbort.current = null;
    }
  }, [transactions.length, rangeStart, rangeEnd, searchKeyword, paymentMethod, antdMessage]);

  // elapsed-time ticker while the PDF is being made
  useEffect(() => {
    if (pdfState.status !== 'loading') return;
    const t = setInterval(() => setPdfTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pdfState.status]);
  useEffect(() => () => pdfAbort.current?.abort(), []);

  const downloadPdf = () => {
    if (!pdfState.url) return;
    const a = document.createElement('a');
    a.href = pdfState.url;
    a.download = getFileName();
    a.click();
  };

  const resetFilters = () => {
    setQuickRange('today'); setCustomRange(null);
    setPaymentMethod('all'); setSearchInput(''); setSearchKeyword('');
  };
  const hasActiveFilters = quickRange !== 'today' || paymentMethod !== 'all' || searchKeyword !== '';

  const onExportCSV = useCallback(() => {
    if (!transactions.length) { antdMessage.warning('No data to export'); return; }
    exportToCSV(transactions, selectedProgram?.name);
    antdMessage.success(`Exported ${transactions.length} transactions`);
  }, [transactions, selectedProgram, antdMessage]);

  // ── Antd Table columns ────────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      title: '#',
      key: 'index',
      width: 52,
      align: 'center',
      render: (_, __, index) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{index + 1}</Text>
      ),
    },
    {
      title: 'TRX ID',
      dataIndex: 'transactionNumber',
      key: 'transactionNumber',
      width: 180,
      render: (val, record) => (
        <Button
          type="link"
          style={{ padding: 0, fontSize: 11, fontFamily: 'monospace', fontWeight: 600, height: 'auto' }}
          onClick={() => handleView(record)}
        >
          {val}
        </Button>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'paymentDate',
      key: 'paymentDate',
      width: 90,
      sorter: (a, b) => dayjs(a.paymentDate).unix() - dayjs(b.paymentDate).unix(),
      render: (val) => (
        <Text style={{ fontSize: 12 }}>{val ? dayjs(val).format('DD/MM/YY') : '-'}</Text>
      ),
    },
    {
      title: 'Payer',
      dataIndex: 'payerName',
      key: 'payerName',
      width: 155,
      render: (_, record) => (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#262626', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
            {record.payerName || '-'}
          </div>
          <div style={{ fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
            {record.payerRegistrationNumber || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Beneficiary',
      dataIndex: 'marriageMemberName',
      key: 'marriageMemberName',
      width: 155,
      render: (_, record) => (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#262626', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
            {record.marriageMemberName || '-'}
          </div>
          <div style={{ fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
            {record.marriageRegistrationNumber || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 115,
      align: 'right',
      sorter: (a, b) => (a.amount || 0) - (b.amount || 0),
      render: (val) => (
        <span style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>
          {amountsHidden() ? MASK : `₹${val?.toLocaleString('en-IN') || '0'}`}
        </span>
      ),
    },
    {
      title: 'Method',
      dataIndex: 'paymentMethod',
      key: 'paymentMethod',
      width: 90,
      align: 'center',
      filters: [
        { text: 'Cash', value: 'cash' },
        { text: 'Online', value: 'online' },
      ],
      onFilter: (value, record) => record.paymentMethod === value,
      render: (val) => (
        <Tag
          color={val === 'cash' ? 'success' : 'blue'}
          style={{ borderRadius: 12, fontWeight: 600, fontSize: 11, padding: '1px 8px', margin: 0 }}
        >
          {val === 'cash' ? 'Cash' : 'Online'}
        </Tag>
      ),
    },
    {
      title: 'Reference',
      dataIndex: 'onlineReference',
      key: 'onlineReference',
      width: 135,
      render: (val) => {
        if (!val) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return (
          <Tooltip title={val}>
            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#595959' }}>
              {val.length > 15 ? val.substring(0, 13) + '…' : val}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button
              type="text" size="small" icon={<EyeOutlined />}
              onClick={() => handleView(record)}
              style={{ color: '#2563eb' }}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={() => showDeleteConfirm(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  // ── No program guard ──────────────────────────────────────────────────────
  if (!selectedProgram) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 240, gap: 12 }}>
            <DollarOutlined style={{ fontSize: 40, color: '#bfbfbf' }} />
            <Text type="secondary" style={{ fontSize: 16, fontWeight: 600 }}>No Program Selected</Text>
            <Text type="secondary" style={{ fontSize: 13, textAlign: 'center', maxWidth: 360 }}>
              Please select a program from the dropdown above to view and manage transactions.
            </Text>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px' }}>

      {/* ── Summary Cards ────────────────────────────────────────────────────── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        {[
          { label: 'Total Amount',  value: amountsHidden() ? MASK : `₹${summary.totalAmount?.toLocaleString('en-IN')}`, sub: `${summary.totalTransactions} transactions`, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: <DollarOutlined /> },
          { label: 'Cash',         value: amountsHidden() ? MASK : `₹${summary.cashAmount?.toLocaleString('en-IN')}`,   sub: `${summary.cashCount} transactions`,         color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: <BankOutlined /> },
          { label: 'Online',       value: amountsHidden() ? MASK : `₹${summary.onlineAmount?.toLocaleString('en-IN')}`, sub: `${summary.onlineCount} transactions`,        color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: <BankOutlined /> },
        ].map(({ label, value, sub, color, bg, border, icon }) => (
          <Col key={label} flex="1" style={{ minWidth: 180 }}>
            <Card
              size="small"
              style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10 }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: `${color}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color, fontSize: 18, flexShrink: 0,
                }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#8c8c8c', fontWeight: 500, marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>{sub}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Filter Bar ───────────────────────────────────────────────────────── */}
      <Card
        size="small"
        style={{ marginBottom: 12, borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: '10px 14px' } }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <AddPaymentModal onSuccess={fetchTransactions} />
          <Button icon={<ReloadOutlined />} onClick={fetchTransactions} loading={loading} size="small">
            Refresh
          </Button>

          <Divider type="vertical" />

          {/* Quick range tabs */}
          <Segmented
            size="small"
            value={quickRange}
            onChange={(val) => { setQuickRange(val); if (val !== 'custom') setCustomRange(null); }}
            options={[
              { label: 'Today',  value: 'today' },
              { label: 'Week',   value: 'week' },
              { label: 'Month',  value: 'month' },
              { label: '3 Months', value: 'months3' },
              { label: 'Custom', value: 'custom' },
            ]}
          />

          {quickRange === 'custom' && (
            <RangePicker
              size="small"
              placeholder={['From', 'To']}
              format="DD/MM/YY"
              value={customRange}
              onChange={setCustomRange}
              allowClear
            />
          )}

          <Divider type="vertical" />

          <Select size="small" value={paymentMethod} onChange={setPaymentMethod} style={{ width: 120 }}>
            <Option value="all">All Methods</Option>
            <Option value="cash">Cash</Option>
            <Option value="online">Online</Option>
          </Select>

          <Input
            size="small"
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            placeholder="Name, reg. no, TRX ID…"
            allowClear
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{ width: 210 }}
          />

          {hasActiveFilters && (
            <Button size="small" icon={<CloseCircleOutlined />} onClick={resetFilters} danger>
              Clear
            </Button>
          )}

          {/* Exports — right aligned */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Button
              size="small"
              icon={<FileExcelOutlined style={{ color: '#16a34a' }} />}
              onClick={onExportCSV}
              disabled={!transactions.length}
            >
              CSV
            </Button>
            <Button
              size="small" type="primary" danger icon={<FilePdfOutlined />}
              onClick={makePdf}
              disabled={!transactions.length}
            >
              PDF
            </Button>
          </div>
        </div>

        {/* Active filter pills */}
        {(rangeStart || searchKeyword || paymentMethod !== 'all') && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>Active filters:</Text>
            {rangeStart && rangeEnd && (
              <Tag icon={<CalendarOutlined />} color="blue" style={{ borderRadius: 12, fontSize: 11 }}>
                {rangeStart.format('DD/MM/YY')} – {rangeEnd.format('DD/MM/YY')}
              </Tag>
            )}
            {paymentMethod !== 'all' && (
              <Tag color={paymentMethod === 'cash' ? 'success' : 'blue'} style={{ borderRadius: 12, fontSize: 11 }}>
                {paymentMethod === 'cash' ? 'Cash' : 'Online'}
              </Tag>
            )}
            {searchKeyword && (
              <Tag icon={<SearchOutlined />} color="orange" style={{ borderRadius: 12, fontSize: 11 }}>
                "{searchKeyword}"
              </Tag>
            )}
            {loading && <Badge status="processing" text={<Text type="secondary" style={{ fontSize: 11 }}>Fetching…</Text>} />}
          </div>
        )}
      </Card>

      {/* ── Table Card ───────────────────────────────────────────────────────── */}
      <Card
        size="small"
        style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 0 } }}
      >
        {/* Table title row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 8px' }}>
          <Text style={{ fontWeight: 700, fontSize: 13 }}>Transaction List</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {summary.totalTransactions} records &nbsp;·&nbsp;
            <span style={{ fontWeight: 700, color: '#16a34a' }}>
              {amountsHidden() ? MASK : `₹${summary.totalAmount?.toLocaleString('en-IN')}`}
            </span>
          </Text>
        </div>

        <Table
          columns={columns}
          dataSource={transactions}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 1060, y: 'calc(100vh - 390px)' }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (total, range) => `${range[0]}–${range[1]} of ${total} records`,
            size: 'small',
            style: { padding: '8px 16px', margin: 0, borderTop: '1px solid #f0f0f0' },
          }}
          rowClassName={(_, index) => index % 2 === 1 ? 'trx-striped-row' : ''}
          locale={{
            emptyText: (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#8c8c8c', marginBottom: 4 }}>
                  No transactions found
                </div>
                <div style={{ fontSize: 12, color: '#bfbfbf' }}>
                  Try adjusting your date range or filters
                </div>
              </div>
            ),
          }}
          summary={() => (
            <Table.Summary fixed="bottom">
              <Table.Summary.Row style={{ background: '#f6f9ff' }}>
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  <Text strong style={{ fontSize: 12, color: '#595959' }}>Total (all records)</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <Text strong style={{ color: '#16a34a', fontSize: 13 }}>
                    {amountsHidden() ? MASK : `₹${summary.totalAmount?.toLocaleString('en-IN')}`}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} colSpan={3} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>

      {/* ── View Modal ───────────────────────────────────────────────────────── */}
      <Modal
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        footer={null}
        width={580}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarOutlined style={{ color: '#16a34a' }} />
            <span>Transaction Details</span>
          </div>
        }
      >
        {selectedTransaction && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>

            {/* Hero */}
            <div style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)',
              borderRadius: 10, padding: '16px 20px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              border: '1px solid #e0e7ff',
            }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a' }}>
                  {amountsHidden() ? MASK : `₹${selectedTransaction.amount?.toLocaleString('en-IN')}`}
                </div>
                <div style={{ fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace', marginTop: 2 }}>
                  {selectedTransaction.transactionNumber}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <Space>
                  <Tag color={selectedTransaction.paymentMethod === 'cash' ? 'success' : 'blue'} style={{ borderRadius: 12, fontWeight: 600, margin: 0 }}>
                    {selectedTransaction.paymentMethod === 'cash' ? 'Cash' : 'Online'}
                  </Tag>
                  <Tag color="green" style={{ borderRadius: 12, margin: 0 }}>Completed</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {dayjs(selectedTransaction.paymentDate).format('DD MMM YYYY, h:mm A')}
                </Text>
              </div>
            </div>

            <Divider style={{ margin: 0 }} />

            {/* Payer & Beneficiary */}
            <Row gutter={12}>
              {[
                {
                  title: 'Payer Details',
                  fields: [
                    ['Name',   selectedTransaction.payerName],
                    ['Father', selectedTransaction.payerFatherName],
                    ['Reg. No', selectedTransaction.payerRegistrationNumber],
                    ['Phone',  selectedTransaction.payerPhone],
                  ]
                },
                {
                  title: 'Beneficiary Details',
                  fields: [
                    ['Name',    selectedTransaction.marriageMemberName],
                    ['Father',  selectedTransaction.closingMemberFatherName],
                    ['Reg. No', selectedTransaction.marriageRegistrationNumber],
                    ['Marriage Date', selectedTransaction.marriageDate],
                  ]
                }
              ].map(({ title, fields }) => (
                <Col xs={24} sm={12} key={title}>
                  <div style={{ background: '#fafafa', borderRadius: 8, padding: '12px 14px', border: '1px solid #f0f0f0', height: '100%' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#262626', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <UserOutlined style={{ fontSize: 11, color: '#8c8c8c' }} /> {title}
                    </div>
                    {fields.filter(([, v]) => v).map(([lbl, val]) => (
                      <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid #f5f5f5' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>{lbl}</Text>
                        <Text strong style={{ fontSize: 12, textAlign: 'right', maxWidth: '60%' }}>{val}</Text>
                      </div>
                    ))}
                  </div>
                </Col>
              ))}
            </Row>

            {/* Additional info */}
            <div style={{ background: '#fafafa', borderRadius: 8, padding: '12px 14px', border: '1px solid #f0f0f0' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#262626', marginBottom: 10 }}>
                Additional Information
              </div>
              <Row gutter={[8, 8]}>
                {[
                  ['Program',      selectedTransaction.programName],
                  ['Batch ID',     selectedTransaction.batchId],
                  ['Full Payment', selectedTransaction.isFullPayment ? 'Yes ✓' : 'No'],
                  ['Reference',    selectedTransaction.onlineReference],
                  ['Note',         selectedTransaction.note],
                  ['Created',      dayjs(selectedTransaction.createdAt).format('DD MMM YYYY, h:mm A')],
                ].filter(([, v]) => v).map(([lbl, val]) => (
                  <Col xs={24} sm={12} key={lbl}>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 1 }}>{lbl}</Text>
                    <Text style={{ fontSize: 12, fontFamily: ['Batch ID', 'Reference'].includes(lbl) ? 'monospace' : undefined }}>
                      {val}
                    </Text>
                  </Col>
                ))}
              </Row>
            </div>

            {/* Footer actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setViewModalVisible(false)}>Close</Button>
              <Button danger icon={<DeleteOutlined />}
                onClick={() => { setViewModalVisible(false); showDeleteConfirm(selectedTransaction); }}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── PDF Drawer ───────────────────────────────────────────────────────── */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FilePdfOutlined style={{ color: '#dc2626' }} />
            <span style={{ fontSize: 13 }}>{getFileName()}</span>
          </div>
        }
        width="min(900px, 96vw)"
        placement="right"
        onClose={closePdf}
        open={pdfDrawerOpen}
        maskClosable={false}
        destroyOnClose
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={closePdf} size="large">{pdfState.status === 'loading' ? 'Cancel' : 'Close'}</Button>
            {pdfState.status === 'error' && <Button size="large" icon={<ReloadOutlined />} onClick={makePdf}>Dobara try karein</Button>}
            <Button type="primary" danger icon={<DownloadOutlined />} size="large"
              loading={pdfState.status === 'loading'} disabled={pdfState.status !== 'done'} onClick={downloadPdf}>
              Download PDF ({(pdfState.rows || transactions.length).toLocaleString('en-IN')} records)
            </Button>
          </div>
        }
      >
        {pdfState.status === 'loading' && (() => {
          const est = Math.max(3, Math.round((pdfState.rows || 0) * 0.0004) + 3); // ≈ 0.35 ms per row on the server + download
          const sec = Math.floor((Date.now() - (pdfState.startedAt || Date.now())) / 1000);
          return (
            <div key={pdfTick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center' }}>
              <Spin size="large" />
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {(pdfState.rows || 0).toLocaleString('en-IN')} payments ka PDF ban raha hai…
              </div>
              <Progress percent={Math.min(95, Math.round((sec / est) * 100))} status="active" style={{ maxWidth: 360 }} showInfo={false} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {sec}s · lagbhag {est}s lagenge. PDF server pe ban raha hai, isliye browser hang nahi hoga.
              </Text>
            </div>
          );
        })()}
        {pdfState.status === 'error' && (
          <div style={{ padding: 24 }}>
            <Alert type="error" showIcon message="PDF nahi bana" description={pdfState.error} />
          </div>
        )}
        {pdfState.status === 'done' && pdfState.url && (
          <iframe title="PDF preview" src={pdfState.url} style={{ width: '100%', flex: 1, minHeight: 'calc(100vh - 130px)', border: 'none' }} />
        )}
      </Drawer>

      {/* Table style overrides */}
      <style>{`
        .trx-striped-row > td { background-color: #fafbff !important; }
        .ant-table-tbody > tr:hover > td { background-color: #f0f4ff !important; transition: background 0.15s; }
        .ant-table-thead > tr > th {
          background: #1d2a4a !important;
          color: #fff !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding: 10px 12px !important;
        }
        .ant-table-thead > tr > th::before { background-color: rgba(255,255,255,0.12) !important; }
        .ant-table-column-sorter { color: rgba(255,255,255,0.5) !important; }
        .ant-table-column-sorter-up.active, .ant-table-column-sorter-down.active { color: #fff !important; }
        .ant-table-summary > tr > td { border-top: 2px solid #e8eaf6 !important; }
        .ant-table-cell-fix-right { box-shadow: -2px 0 6px rgba(0,0,0,0.06) !important; }
      `}</style>
    </div>
  );
};

export default TransactionsPage;