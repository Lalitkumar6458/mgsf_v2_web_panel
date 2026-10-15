"use client";
import { useAuth } from '@/lib/AuthProvider';
import { attachClosingMemberDetails, getAgentMemberPaystatus } from '@/lib/helper';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Table, Card, Row, Col, Statistic, Tag, Button, Avatar, Space,
  Input, Select, Tooltip, Badge, Modal, message, Drawer, Checkbox,
  Divider, Radio, Spin, Progress, Empty, Dropdown, InputNumber,
} from 'antd';
import {
  EyeOutlined, DownloadOutlined, ReloadOutlined, MoneyCollectOutlined,
  CheckCircleOutlined, ClockCircleOutlined, UserOutlined, SearchOutlined,
  PhoneOutlined, IdcardOutlined, FilePdfOutlined, ClearOutlined,
  PrinterOutlined, TeamOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { PDFDownloadLink, PDFViewer } from '@react-pdf/renderer';
import PaymentReportPDF from '../component/pdfcom/PaymentReportPDF';
import { setSelectedProgram } from '@/redux/slices/commonSlice';
import { fetchClosingGroups as loadClosingGroups } from '@/lib/services/firebaseService';
import dynamic from 'next/dynamic';
const ReceiptsDrawer = dynamic(() => import('@/components/common/receipts/ReceiptsDrawer'), { ssr: false });
const { Search } = Input;
const { Option } = Select;

const MemberPayStatus = ({ agentId, agentInfo }) => {
  const [open, setOpen] = useState(false);
  const selectedProgram = useSelector((state) => state.data.selectedProgram);
  const programList = useSelector((state) => state.data.programList);
  const trustData = useSelector((state) => state.data.trustData);
  const { user } = useAuth();
  const dispatch = useDispatch();
  const [receiptRun, setReceiptRun] = useState(null);   // { status, memberIds, ... } → ReceiptsDrawer
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [programChanging, setProgramChanging] = useState(false);
  const [summary, setSummary] = useState({
    totalMembers: 0, totalPending: 0, totalPaid: 0,
    totalPendingAmount: 0, totalPaidAmount: 0, totalAmount: 0,
  });
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMember, setSelectedMember] = useState(null);
  const [isDetailsModalVisible, setIsDetailsModalVisible] = useState(false);
  const [filteredData, setFilteredData] = useState([]);

  // Group filter states
  const [closingGroups, setClosingGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupFilterLoading, setGroupFilterLoading] = useState(false);

  // Member selection state
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [selectionMode, setSelectionMode] = useState('all');
  const [selectAll, setSelectAll] = useState(false);
  const [pagination, setPagination] = useState({
  current: 1,
  pageSize: 50,
});
  const [activeFilters, setActiveFilters] = useState({
    search: false, status: false, group: false,
  });

  // रसीद न. serial — receipts are numbered 0001, 0002 … in the generated PDF.
  // Change this to continue from where a previous batch/receipt book ended.
  const [receiptStartNo, setReceiptStartNo] = useState(1);

  // ─── Ref to hold the latest groupId without causing effect re-runs ───
  // This lets loadAgentPaymentData always read the current groupId
  // without needing to be in the useEffect dependency array.
  const selectedGroupIdRef = useRef(selectedGroupId);
  useEffect(() => { selectedGroupIdRef.current = selectedGroupId; }, [selectedGroupId]);

  // ─── Core data loader ────────────────────────────────────────────────
  // Uses ref for groupId so it is stable across renders and safe to call
  // manually without triggering extra effect runs.
  const loadAgentPaymentData = useCallback(async () => {
    if (!user?.uid || !selectedProgram?.id || !agentId) {
      setLoading(false);
      setProgramChanging(false);
      return;
    }
    try {
      setLoading(true);
      const data = await getAgentMemberPaystatus({
        userId: user.uid,
        programId: selectedProgram.id,
        agentId,
        closingGroupId: selectedGroupIdRef.current,
      });
      console.log(data,"data marrige data")

      if (data?.success) {
        // Closed members' वारिसदार / relation / state come from their own
        // member docs (payment entries don't store them). If this lookup
        // fails we still show the report without those fields.
        let report = data.report || [];
        // New function version (compact) already includes वारिसदार etc.;
        // only the old version needs the extra Firestore lookup.
        if (!data.compact) try {
          report = await attachClosingMemberDetails({
            userId: user.uid,
            programId: selectedProgram.id,
            report,
          });
        } catch (e) {
          console.warn('Could not load closing member details:', e);
        }
        setReportData(report);
        setSummary(data.summary || {});
        setFilteredData(report);
        if (data.groupInfo) {
          message.success(
            `Showing payments for group: ${data.groupInfo.name} (${data.groupInfo.memberCount} members)`
          );
        }
      } else {
        message.error(data?.message || 'Failed to load payment data');
        setReportData([]);
        setFilteredData([]);
      }
    } catch (err) {
      console.error('Error loading payment data:', err);
      message.error('Error loading payment data');
      setReportData([]);
      setFilteredData([]);
    } finally {
      setLoading(false);
      setProgramChanging(false);
    }
  // ⚠️  Do NOT add selectedGroupId here — we use the ref intentionally.
  }, [user?.uid, selectedProgram?.id, agentId]);

  // ─── Fetch closing groups ────────────────────────────────────────────
  const fetchClosingGroups = useCallback(async () => {
    if (!user?.uid || !selectedProgram?.id) return;
    try {
      setGroupFilterLoading(true);
      setClosingGroups(await loadClosingGroups(selectedProgram.id));
    } catch (error) {
      console.error('Error fetching closing groups:', error);
      message.error('Failed to load closing groups');
    } finally {
      setGroupFilterLoading(false);
    }
  }, [user?.uid, selectedProgram?.id]);

  // ─── SINGLE effect: runs once when the key identifiers are ready ─────
  // fetchClosingGroups and loadAgentPaymentData are stable callbacks
  // (their inner deps are primitive values), so this effect fires exactly
  // once per [programId / agentId / userId] change — never more.
  useEffect(() => {
    if (!user?.uid || !selectedProgram?.id || !agentId) return;

    let cancelled = false;

    const init = async () => {
      // Fetch groups first (fire-and-forget for the UI badge counts),
      // then load payment data exactly once.
      await fetchClosingGroups();
      if (!cancelled) await loadAgentPaymentData();
    };

    init();

    return () => { cancelled = true; };
  }, [user?.uid, selectedProgram?.id, agentId, fetchClosingGroups, loadAgentPaymentData]);

  // ─── Program selector ────────────────────────────────────────────────
  const handleProgramSelect = useCallback(
    (programId) => {
      if (!programId || programId === selectedProgram?.id) return;
      setProgramChanging(true);
      setLoading(true);
      const newProgram = programList.find((p) => p.id === programId);
      if (newProgram) {
        dispatch(setSelectedProgram(newProgram));
        // Reset all local state; the useEffect above will re-run automatically
        // because selectedProgram.id changed.
        setSearchText('');
        setStatusFilter('all');
        setSelectedGroupId(null);
        selectedGroupIdRef.current = null;
        setSelectedMembers([]);
        setSelectAll(false);
        setSelectionMode('all');
        setActiveFilters({ search: false, status: false, group: false });
      }
    },
    [selectedProgram?.id, programList, dispatch]
  );

  // ─── Group filter change ─────────────────────────────────────────────
  // Update ref synchronously so loadAgentPaymentData reads the new value,
  // then trigger a single manual reload. NO extra useEffect needed.
  const handleGroupChange = useCallback(
    (val) => {
      setSelectedGroupId(val);
      selectedGroupIdRef.current = val ?? null;
      loadAgentPaymentData();
    },
    [loadAgentPaymentData]
  );

  // ─── Filters (client-side only, no API call) ─────────────────────────
  const applyFilters = useCallback(() => {
    let filtered = [...reportData];
    const filtersActive = { search: false, status: false, group: false };

    if (searchText?.trim()) {
      filtersActive.search = true;
      const s = searchText.toLowerCase().trim();
      filtered = filtered.filter(
        (member) =>
          member.displayName?.toLowerCase().includes(s) ||
          member.fatherName?.toLowerCase().includes(s) ||
          member.phone?.includes(searchText) ||
          member.registrationNumber?.toLowerCase().includes(s) ||
          member.village?.toLowerCase().includes(s) ||
          member.marriages?.some(
            (m) =>
              m.closingMemberName?.toLowerCase().includes(s) ||
              m.paymentFor?.toLowerCase().includes(s)
          )
      );
    }

    if (statusFilter !== 'all') {
      filtersActive.status = true;
      filtered = filtered.filter(
        (member) => member.marriages?.some((m) => m.status === statusFilter)
      );
    }

    setFilteredData(filtered);
    setActiveFilters(filtersActive);
    setSelectedMembers([]);
    setSelectAll(false);
  }, [searchText, statusFilter, reportData]);

  useEffect(() => { applyFilters(); }, [applyFilters]);

  const resetFilters = useCallback(() => {
    setSearchText('');
    setStatusFilter('all');
    setSelectedGroupId(null);
    selectedGroupIdRef.current = null;
    setFilteredData(reportData);
    setSelectedMembers([]);
    setSelectAll(false);
    setSelectionMode('all');
    setActiveFilters({ search: false, status: false, group: false });
    // Reload without group filter
    loadAgentPaymentData();
  }, [reportData, loadAgentPaymentData]);

  // ─── Helpers ─────────────────────────────────────────────────────────
  const getStatusTag = (status) => {
    switch (status) {
      case 'pending': return <Tag color="orange" icon={<ClockCircleOutlined />}>Pending</Tag>;
      case 'paid':    return <Tag color="green"  icon={<CheckCircleOutlined />}>Paid</Tag>;
      default:        return <Tag color="default">{status}</Tag>;
    }
  };

  const calculateMemberStats = useCallback((member) => {
    const pendingMarriages = member.marriages?.filter((m) => m.status === 'pending').length || 0;
    const paidMarriages    = member.marriages?.filter((m) => m.status === 'paid').length    || 0;
    const pendingAmount    = member.marriages?.filter((m) => m.status === 'pending').reduce((s, m) => s + (m.amount || 0), 0) || 0;
    const paidAmount       = member.marriages?.filter((m) => m.status === 'paid').reduce((s, m) => s + (m.amount || 0), 0)    || 0;
    return { pendingMarriages, paidMarriages, pendingAmount, paidAmount };
  }, []);

  const handleSelectAll = useCallback(
    (checked) => {
      setSelectAll(checked);
      if (checked) {
        setSelectedMembers(filteredData.map((m) => m.memberId));
        setSelectionMode('custom');
      } else {
        setSelectedMembers([]);
        setSelectionMode('all');   // nothing ticked = treat as "all members"
      }
    },
    [filteredData]
  );

  const rowSelection = useMemo(() => ({
    selectedRowKeys: selectedMembers,
    onChange: (keys) => {
      setSelectedMembers(keys);
      setSelectionMode(keys.length === 0 ? 'all' : 'custom');
      setSelectAll(keys.length === filteredData.length);
    },
  }), [selectedMembers, filteredData.length]);

  const getFileName = useCallback(() => {
    const agentName   = agentInfo?.displayName?.replace(/\s+/g, '_') || 'Agent';
    const programName = selectedProgram?.name?.replace(/\s+/g, '_')  || 'Program';
    const groupName   = selectedGroupId
      ? closingGroups.find((g) => g.id === selectedGroupId)?.name?.replace(/\s+/g, '_')
      : '';
    const date        = dayjs().format('DDMMYYYY');
    const memberCount = selectionMode === 'all' ? filteredData.length : selectedMembers.length;
    return `${agentName}_Payment_Report${groupName ? `_${groupName}` : ''}_${programName}_${memberCount}Members_${date}.pdf`;
  }, [agentInfo, selectedProgram, selectionMode, filteredData, selectedMembers, selectedGroupId, closingGroups]);

  // An empty custom selection means "nothing was ticked" — fall back to every
  // filtered member instead of silently exporting zero members.
  const getExportData = useCallback(
    () =>
      selectionMode === 'all' || selectedMembers.length === 0
        ? filteredData
        : filteredData.filter((m) => selectedMembers.includes(m.memberId)),
    [selectionMode, filteredData, selectedMembers]
  );

  const hasActiveFilters = activeFilters.search || activeFilters.status || activeFilters.group;

  // ─── Receipt generation (pending / paid) ──────────────────────────────
  // A member only lands in a receipt if they actually have entries with that
  // status — fully paid members are never printed on a pending receipt.
  const getReceiptMembers = useCallback(
    (status) =>
      getExportData()
        .map((m) => ({
          ...m,
          marriages: (m.marriages || []).filter((x) => x.status === status),
        }))
        .filter((m) => m.marriages.length > 0),
    [getExportData]
  );

  const handleGenerateReceipts = useCallback(
    (status) => {
      const receiptMembers = getReceiptMembers(status);

      if (receiptMembers.length === 0) {
        message.warning(
          status === 'paid'
            ? 'No members with paid payments in the current selection.'
            : 'No members with pending payments in the current selection.'
        );
        return;
      }

      // One combined PDF — one receipt page per member, each listing only that
      // member's entries with the selected status.
      const totalRows = receiptMembers.reduce((n, m) => n + m.marriages.length, 0);
      const skipped = getExportData().length - receiptMembers.length;

      message.loading(
        `Building 1 PDF · ${receiptMembers.length} ${status} receipt(s) · ${totalRows} closing(s)` +
          (skipped > 0 ? ` · ${skipped} member(s) skipped (nothing ${status})` : ''),
        3
      );

      // made on the server in the background (DB data, worker thread, parts for big runs)
      setReceiptRun({
        key: Date.now(),
        status,
        memberIds: receiptMembers.map((m) => m.memberId).filter(Boolean),
        closingGroupId: selectedGroupId || undefined,
        label: `${agentInfo?.displayName || 'Agent'} · ${selectedProgram?.name || ''}`,
      });
    },
    [
      getReceiptMembers,
      getExportData,
      selectedGroupId,
      agentInfo,
      selectedProgram,
      summary,
      activeFilters,
      trustData,
      receiptStartNo,
    ]
  );

  // ── Single-member receipt (table row button) ──────────────────────────
  // Sirf us member ki, sirf chune hue status ki entries print hoti hain.
  // 5 paid / 3 pending wale member ka Pending button 3 rows deta hai aur
  // Paid button 5 rows — dono alag-alag PDF.
  const handleMemberReceipt = useCallback(
    (member, status) => {
      const marriages = (member.marriages || []).filter((m) => m.status === status);

      if (marriages.length === 0) {
        message.warning(
          `${member.displayName} ka koi ${status === 'paid' ? 'paid' : 'pending'} payment nahi hai.`
        );
        return;
      }

      message.loading(
        `${member.displayName} · ${marriages.length} ${status} closing(s) · PDF ban raha hai`,
        2
      );

      setReceiptRun({
        key: Date.now(),
        status,
        memberIds: [member.memberId].filter(Boolean),
        closingGroupId: selectedGroupId || undefined,
        label: `${member.displayName}`,
      });
    },
    [summary, agentInfo, selectedProgram, activeFilters, trustData, receiptStartNo, selectedGroupId]
  );

  const receiptMenuItems = useMemo(
    () => [
      {
        key: 'pending',
        label: `Pending Receipts (${getReceiptMembers('pending').length} members)`,
        icon: <ClockCircleOutlined />,
      },
      {
        key: 'paid',
        label: `Paid Receipts (${getReceiptMembers('paid').length} members)`,
        icon: <CheckCircleOutlined />,
      },
    ],
    [getReceiptMembers]
  );

  // ─── Columns ──────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      title: 'Member Info', dataIndex: 'memberInfo', key: 'memberInfo',
      fixed: 'left', width: 260,
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Avatar src={record.photoURL} size={40} icon={!record.photoURL && <UserOutlined />}
            style={{ flexShrink: 0, border: '1px solid #f0f0f0' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13, color: '#1a1a1a' }}>
              {record.displayName}{' '}
              {record.surname && <span style={{ color: '#888', fontWeight: 400 }}>{record.surname}</span>}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              <IdcardOutlined style={{ marginRight: 3 }} />{record.registrationNumber}
            </div>
            <div style={{ fontSize: 11, color: '#888' }}>
              <UserOutlined style={{ marginRight: 3 }} />
              {record.fatherName ? `S/o ${record.fatherName}` : 'N/A'}
            </div>
            {record.phone && (
              <div style={{ fontSize: 11, color: '#888' }}>
                <PhoneOutlined style={{ marginRight: 3 }} />{record.phone}
              </div>
            )}
            {record.groupInfo?.groupName && (
              <Tag color="cyan" icon={<TeamOutlined />} style={{ marginTop: 4, fontSize: 10 }}>
                {record.groupInfo.groupName}
              </Tag>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Location', key: 'location', width: 130,
      render: (_, record) => (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{record.village || 'N/A'}</div>
          <div style={{ fontSize: 11, color: '#888' }}>{record.district || ''}</div>
        </div>
      ),
    },
    {
      title: 'Pending', key: 'pending', width: 140,
      render: (_, record) => {
        const { pendingMarriages, pendingAmount } = calculateMemberStats(record);
        return (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#d46b08' }}>₹{pendingAmount.toLocaleString('en-IN')}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{pendingMarriages} case{pendingMarriages !== 1 ? 's' : ''}</div>
          </div>
        );
      },
    },
    {
      title: 'Paid', key: 'paid', width: 140,
      render: (_, record) => {
        const { paidMarriages, paidAmount } = calculateMemberStats(record);
        return (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#389e0d' }}>₹{paidAmount.toLocaleString('en-IN')}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{paidMarriages} case{paidMarriages !== 1 ? 's' : ''}</div>
          </div>
        );
      },
    },
    {
      title: 'Total', key: 'total', width: 130,
      render: (_, record) => {
        const { pendingAmount, paidAmount } = calculateMemberStats(record);
        const total = pendingAmount + paidAmount;
        const pct = total > 0 ? Math.round((paidAmount / total) * 100) : 0;
        return (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1677ff' }}>₹{total.toLocaleString('en-IN')}</div>
            <Progress percent={pct} size="small" showInfo={false}
              status={pct === 100 ? 'success' : 'active'} style={{ marginTop: 4 }} />
            <div style={{ fontSize: 10, color: '#888' }}>{pct}% paid</div>
          </div>
        );
      },
    },
    {
      title: 'Status', key: 'overallStatus', width: 110, align: 'center',
      render: (_, record) => {
        const pendingCount = record.marriages?.filter((m) => m.status === 'pending').length || 0;
        const paidCount    = record.marriages?.filter((m) => m.status === 'paid').length    || 0;
        if (pendingCount === 0 && paidCount === 0) return <Tag color="default">No Payments</Tag>;
        if (pendingCount === 0) return <Tag color="success">All Paid</Tag>;
        if (paidCount    === 0) return <Tag color="error">All Pending</Tag>;
        return <Tag color="warning">Partial</Tag>;
      },
    },
    {
      title: 'Receipt', key: 'actions', fixed: 'right', width: 190, align: 'center',
      render: (_, record) => {
        const pendingCount = record.marriages?.filter((m) => m.status === 'pending').length || 0;
        const paidCount    = record.marriages?.filter((m) => m.status === 'paid').length    || 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <Tooltip title="View Details">
              <Button type="text" icon={<EyeOutlined />} size="small"
                onClick={() => { setSelectedMember(record); setIsDetailsModalVisible(true); }} />
            </Tooltip>

            <Tooltip title={pendingCount ? `Download ${pendingCount} pending receipt` : 'Koi pending nahi'}>
              <Button
                size="small"
                danger
                icon={<DownloadOutlined />}
                disabled={pendingCount === 0}
                onClick={() => handleMemberReceipt(record, 'pending')}
                style={{ fontSize: 11, paddingInline: 6 }}
              >
                Pending {pendingCount}
              </Button>
            </Tooltip>

            <Tooltip title={paidCount ? `Download ${paidCount} paid receipt` : 'Koi paid nahi'}>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled={paidCount === 0}
                onClick={() => handleMemberReceipt(record, 'paid')}
                style={{
                  fontSize: 11,
                  paddingInline: 6,
                  ...(paidCount ? { color: '#389e0d', borderColor: '#95de64' } : {}),
                }}
              >
                Paid {paidCount}
              </Button>
            </Tooltip>
          </div>
        );
      },
    },
  ], [calculateMemberStats, handleMemberReceipt]);

  const marriageColumns = useMemo(() => [
    {
      title: 'Payment For', dataIndex: 'paymentFor', key: 'paymentFor', width: 150,
      render: (text) => <span style={{ fontWeight: 500 }}>{text || 'N/A'}</span>,
    },
    {
      title: 'Closing Member', key: 'closingMember', width: 220,
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.closingMemberName || record.paymentFor || 'N/A'}</div>
          {record.closingRegNo      && <div style={{ fontSize: 11, color: '#888' }}>Reg: {record.closingRegNo}</div>}
          {record.closingFatherName && <div style={{ fontSize: 11, color: '#888' }}>S/o: {record.closingFatherName}</div>}
          {record.closingVillage    && <div style={{ fontSize: 11, color: '#888' }}>Village: {record.closingVillage}</div>}
        </div>
      ),
    },
    {
      title: 'Amount', dataIndex: 'amount', key: 'amount', width: 110, align: 'right',
      render: (amount) => (
        <span style={{ fontWeight: 600, color: '#1677ff' }}>₹{amount?.toLocaleString('en-IN') || '0'}</span>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 100, align: 'center',
      render: getStatusTag,
    },
    {
      title: 'Date', dataIndex: 'createdDate', key: 'createdDate', width: 120,
      render: (date) => {
        if (!date) return 'N/A';
        let formatted;
        if (typeof date === 'number' || date?.seconds) {
          formatted = dayjs.unix(date?.seconds || date).format('DD/MM/YYYY');
        } else {
          formatted = dayjs(date).format('DD/MM/YYYY');
        }
        return <span style={{ fontSize: 12 }}>{formatted}</span>;
      },
    },
  ], []);

  // ─── Early loading state ──────────────────────────────────────────────
  if (loading && reportData.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="Loading payment data..." />
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px', background: '#f5f5f5', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{
        background: '#fff', borderRadius: 10, padding: '14px 20px', marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>Member Payment Status</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            <UserOutlined style={{ marginRight: 4 }} />
            {agentInfo?.displayName || 'N/A'}
            <span style={{ margin: '0 6px' }}>·</span>
            <span style={{ fontWeight: 500 }}>{selectedProgram?.name || 'N/A'}</span>
          </div>
        </div>
        <Space wrap>
          <Select placeholder="Select Program" size="middle" style={{ width: 220 }}
            onChange={handleProgramSelect} value={selectedProgram?.id}
            disabled={programChanging} loading={programChanging}>
            {programList.map((p) => <Option key={p.id} value={p.id}>{p.name}</Option>)}
          </Select>
          <Button icon={<ReloadOutlined />} onClick={loadAgentPaymentData} loading={loading}>Refresh</Button>
          <Tooltip title="रसीद न. इस नंबर से शुरू होगा (0001, 0002 …)">
            <InputNumber
              min={1}
              step={1}
              precision={0}
              value={receiptStartNo}
              onChange={(v) => setReceiptStartNo(v || 1)}
              addonBefore="रसीद न."
              style={{ width: 150 }}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: receiptMenuItems,
              onClick: ({ key }) => handleGenerateReceipts(key),
            }}
            disabled={filteredData.length === 0}
          >
            <Button type="primary" icon={<FilePdfOutlined />} disabled={filteredData.length === 0}>
              Generate Receipts
            </Button>
          </Dropdown>
        </Space>
      </div>

      {/* Summary Metrics */}
      <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
        {[
          { label: 'Total Members',    value: summary.totalMembers,       color: '#1677ff', prefix: <UserOutlined />,         format: false },
          { label: 'Pending Payments', value: summary.totalPending,       color: '#d46b08', prefix: <ClockCircleOutlined />,   format: false },
          { label: 'Paid Payments',    value: summary.totalPaid,          color: '#389e0d', prefix: <CheckCircleOutlined />,   format: false },
          { label: 'Pending Amount',   value: summary.totalPendingAmount, color: '#cf1322', prefix: <MoneyCollectOutlined />,  format: true  },
          { label: 'Total Collected',  value: summary.totalPaidAmount,    color: '#389e0d', prefix: <MoneyCollectOutlined />,  format: true  },
        ].map((item, i) => (
          <Col xs={12} sm={8} md={6} lg={4} key={i} style={{ flex: '1 1 160px' }}>
            <Card size="small" style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,.06)', height: '100%' }}
              bodyStyle={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{item.label}</div>
              <Statistic value={item.value}
                valueStyle={{ color: item.color, fontWeight: 600, fontSize: 20, lineHeight: 1.2 }}
                prefix={item.prefix}
                formatter={item.format ? (v) => `₹${v?.toLocaleString('en-IN')}` : undefined} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Filter + Table Card */}
      <Card style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }} bodyStyle={{ padding: 0 }}>

        {/* Filter Bar */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Row 1 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Search placeholder="Search name, phone, reg, village…" allowClear value={searchText}
              onChange={(e) => setSearchText(e.target.value)} style={{ width: 260 }} size="middle" />

            {/* Group filter — calls handleGroupChange (no setTimeout, no extra effect) */}
            <Select placeholder="Filter by Closing Group" value={selectedGroupId}
              onChange={handleGroupChange}
              style={{ width: 220 }} allowClear loading={groupFilterLoading}
              showSearch optionFilterProp="children" size="middle" suffixIcon={<FolderOpenOutlined />}>
              {closingGroups.map((group) => (
                <Option key={group.id} value={group.id}>
                  <span><TeamOutlined style={{ marginRight: 6, color: '#1677ff' }} />{group.name}</span>
                  <Badge count={group.memberCount} showZero
                    style={{ backgroundColor: '#52c41a', marginLeft: 8, fontSize: 10 }} />
                </Option>
              ))}
            </Select>

            <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }} size="middle">
              <Option value="all">All Status</Option>
              <Option value="pending">Pending Only</Option>
              <Option value="paid">Paid Only</Option>
            </Select>

            {hasActiveFilters && (
              <Button icon={<ClearOutlined />} onClick={resetFilters} size="middle">Clear</Button>
            )}
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activeFilters.search && (
                <Tag color="blue" closable onClose={() => setSearchText('')} style={{ fontSize: 11 }}>
                  Search: {searchText}
                </Tag>
              )}
              {activeFilters.status && statusFilter !== 'all' && (
                <Tag color="purple" closable onClose={() => setStatusFilter('all')} style={{ fontSize: 11 }}>
                  {statusFilter === 'pending' ? 'Pending Only' : 'Paid Only'}
                </Tag>
              )}
              {selectedGroupId && (
                <Tag color="orange" closable
                  onClose={() => { setSelectedGroupId(null); selectedGroupIdRef.current = null; loadAgentPaymentData(); }}
                  style={{ fontSize: 11 }}>
                  Group: {closingGroups.find((g) => g.id === selectedGroupId)?.name}
                </Tag>
              )}
            </div>
          )}

          {/* Row 2: count + selection mode */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#888' }}>
              <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{filteredData.length}</span>
              {' '}of{' '}
              <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{reportData.length}</span>
              {' '}members
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Radio.Group value={selectionMode}
                onChange={(e) => {
                  setSelectionMode(e.target.value);
                  if (e.target.value === 'all') { setSelectedMembers([]); setSelectAll(false); }
                }}
                optionType="button" buttonStyle="solid" size="small">
                <Radio.Button value="all">All ({filteredData.length})</Radio.Button>
                <Radio.Button value="custom">Custom</Radio.Button>
              </Radio.Group>
              {selectionMode === 'custom' && filteredData.length > 0 && (
                <Checkbox checked={selectAll} onChange={(e) => handleSelectAll(e.target.checked)}
                  indeterminate={selectedMembers.length > 0 && selectedMembers.length < filteredData.length}
                  style={{ fontSize: 12 }}>
                  Select All ({selectedMembers.length}/{filteredData.length})
                </Checkbox>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        {filteredData.length === 0 ? (
          <Empty description="No payment data found" style={{ padding: '48px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
        <Table
  rowSelection={selectionMode === 'custom' ? rowSelection : undefined}
  columns={columns}
  dataSource={filteredData}
  loading={loading}
  rowKey="memberId"
  size="small"
  scroll={{ x: 1000, y: 'calc(100vh - 460px)' }}

  pagination={{
    current: pagination.current,
    pageSize: pagination.pageSize,

    showSizeChanger: true,
    showQuickJumper: true,

    showTotal: (total, range) =>
      `${range[0]}-${range[1]} of ${total} members`,

    pageSizeOptions: ['10', '20', '50', '100'],
    size: 'small',

    onChange: (page, pageSize) => {
      setPagination({
        current: page,
        pageSize: pageSize,
      });
    },
  }}

  expandable={{
    expandedRowRender: (record) => {
      const marriages = record.marriages || [];

      if (!marriages.length) {
        return (
          <div
            style={{
              padding: 16,
              textAlign: 'center',
              color: '#888',
            }}
          >
            No marriage payment records found
          </div>
        );
      }

      return (
        <div
          style={{
            padding: '12px 16px',
            background: '#fafafa',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontWeight: 500,
              marginBottom: 10,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <MoneyCollectOutlined />
            Marriage Payment Details
          </div>

          <Table
            columns={marriageColumns}
            dataSource={marriages}
            rowKey="paymentId"
            pagination={false}
            size="small"
            bordered
          />
        </div>
      );
    },

    rowExpandable: (record) =>
      record.marriages?.length > 0,
  }}
/>
        )}
      </Card>

      {/* Member Details Modal */}
      <Modal
        title={<span><UserOutlined style={{ marginRight: 8 }} />Member Payment Details</span>}
        open={isDetailsModalVisible} onCancel={() => setIsDetailsModalVisible(false)}
        width={860}
        footer={[
          <Button key="close" onClick={() => setIsDetailsModalVisible(false)}>Close</Button>,
          <Button key="print" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>,
        ]}>
        {selectedMember && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card size="small" style={{ background: '#f0f5ff', border: '1px solid #d6e4ff' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <Avatar src={selectedMember.photoURL} size={72}
                  icon={!selectedMember.photoURL && <UserOutlined />}
                  style={{ border: '3px solid #fff', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
                    {selectedMember.displayName} {selectedMember.surname}
                  </div>
                  {selectedMember.groupInfo?.groupName && (
                    <Tag color="cyan" icon={<TeamOutlined />} style={{ marginBottom: 8 }}>
                      {selectedMember.groupInfo.groupName}
                    </Tag>
                  )}
                  <Row gutter={[16, 4]}>
                    <Col xs={24} sm={12}>
                      <div style={{ fontSize: 12, color: '#555' }}><strong>Reg No:</strong> {selectedMember.registrationNumber}</div>
                      <div style={{ fontSize: 12, color: '#555' }}><strong>Father:</strong> {selectedMember.fatherName || 'N/A'}</div>
                      <div style={{ fontSize: 12, color: '#555' }}><strong>Phone:</strong> {selectedMember.phone || 'N/A'}</div>
                    </Col>
                    <Col xs={24} sm={12}>
                      <div style={{ fontSize: 12, color: '#555' }}><strong>Village:</strong> {selectedMember.village || 'N/A'}</div>
                      <div style={{ fontSize: 12, color: '#555' }}><strong>District:</strong> {selectedMember.district || 'N/A'}</div>
                      <div style={{ fontSize: 12, color: '#555' }}><strong>Join Date:</strong> {selectedMember.dateJoin || 'N/A'}</div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Card>

            <Row gutter={12}>
              {[
                { label: 'Total Marriages', value: selectedMember.marriages?.length || 0, color: '#1677ff' },
                { label: 'Pending', value: selectedMember.marriages?.filter((m) => m.status === 'pending').length || 0, color: '#d46b08' },
                { label: 'Paid',    value: selectedMember.marriages?.filter((m) => m.status === 'paid').length    || 0, color: '#389e0d' },
                { label: 'Total Amount', value: selectedMember.marriages?.reduce((s, m) => s + (m.amount || 0), 0) || 0, color: '#1677ff', format: true },
              ].map((item, i) => (
                <Col xs={12} lg={6} key={i}>
                  <Card size="small" style={{ textAlign: 'center' }}>
                    <Statistic title={<span style={{ fontSize: 11 }}>{item.label}</span>}
                      value={item.value} valueStyle={{ color: item.color, fontSize: 18, fontWeight: 600 }}
                      formatter={item.format ? (v) => `₹${v?.toLocaleString('en-IN')}` : undefined} />
                  </Card>
                </Col>
              ))}
            </Row>

            <Card title="Marriage Payment Details" size="small">
              <Table columns={marriageColumns} dataSource={selectedMember.marriages || []}
                rowKey="paymentId" pagination={false} bordered size="small" />
            </Card>
          </div>
        )}
      </Modal>

      {/* PDF Drawer */}
      <Drawer
        title={<span><FilePdfOutlined style={{ color: '#f5222d', marginRight: 8 }} />{getFileName()}</span>}
        width={800} placement="right" onClose={() => setOpen(false)} open={open}
        maskClosable={false} destroyOnClose
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <PDFDownloadLink
              document={
                <PaymentReportPDF data={getExportData()} summary={summary} agentInfo={agentInfo}
                  programInfo={selectedProgram}
                  filters={{ searchText, dateRange: null, statusFilter,
                    groupName: selectedGroupId ? closingGroups.find((g) => g.id === selectedGroupId)?.name : null }}
                  selectionMode={selectionMode} selectedCount={getExportData().length} />
              }
              fileName={getFileName()}>
              {({ loading: pdfLoading }) => (
                <Button type="primary" icon={<DownloadOutlined />} loading={pdfLoading} disabled={getExportData().length === 0}>
                  Download PDF ({getExportData().length} members)
                </Button>
              )}
            </PDFDownloadLink>
          </div>
        }>
        <PDFViewer style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none' }}>
          <PaymentReportPDF data={getExportData()} summary={summary} agentInfo={agentInfo}
            programInfo={selectedProgram}
            filters={{ searchText, dateRange: null, statusFilter,
              groupName: selectedGroupId ? closingGroups.find((g) => g.id === selectedGroupId)?.name : null }}
            selectionMode={selectionMode} selectedCount={getExportData().length} />
        </PDFViewer>
      </Drawer>
      {receiptRun && (
        <ReceiptsDrawer
          key={receiptRun.key}
          open={!!receiptRun}
          onClose={() => setReceiptRun(null)}
          autoStart
          lockAgent
          agentInfo={{ displayName: agentInfo?.displayName, phone: agentInfo?.phone }}
          defaults={{ status: receiptRun.status, agentId, closingGroupId: receiptRun.closingGroupId, memberIds: receiptRun.memberIds, receiptStartNo, label: receiptRun.label }}
        />
      )}
    </div>
  );
};

export default MemberPayStatus;