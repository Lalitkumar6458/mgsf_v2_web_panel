'use client';
import {
  App, DatePicker, Input, Tag, Badge, Tooltip, Modal, Empty,
  Spin, Steps, Divider, Statistic, Card, Row, Col, Space,
  Button, Drawer, Form, Select, Tabs
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllMembers, fetchClosingGroups as loadClosingGroups } from '@/lib/services/firebaseService';
import { api } from '@/lib/client/api';
import { useAuth } from '@/lib/AuthProvider';
import {
  DollarOutlined,
  UserOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CloseOutlined,
  SearchOutlined,
  FilterOutlined,
  CreditCardOutlined,
  WalletOutlined,
  AppstoreOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  RocketOutlined,
  ClockCircleOutlined,
  StopOutlined,
  CheckSquareOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { createSearchIndex } from '@/lib/commonFun';
import { setClosingGroups } from '@/redux/slices/commonSlice';

const { Option } = Select;
const { TextArea } = Input;
const { Search } = Input;

/* ─────────────────────────────────────────────
   STATUS TAB DEFINITIONS
───────────────────────────────────────────── */
const STATUS_TABS = [
  {
    key: 'pending',
    label: 'Pending',
    icon: <ClockCircleOutlined />,
    color: '#f97316',
    bg: '#fff7ed',
    border: '#fed7aa',
    dot: '#f97316',
  },
  {
    key: 'paid',
    label: 'Paid',
    icon: <CheckSquareOutlined />,
    color: '#10b981',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    dot: '#10b981',
  },
  {
    key: 'not_eligible',
    label: 'Not Eligible',
    icon: <StopOutlined />,
    color: '#ef4444',
    bg: '#fef2f2',
    border: '#fecaca',
    dot: '#ef4444',
  },
];

/* ─────────────────────────────────────────────
   STEP CONFIG
───────────────────────────────────────────── */
const STEPS = [
  { title: 'Program', icon: <AppstoreOutlined />, gradient: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
  { title: 'Payer',   icon: <TeamOutlined />,      gradient: 'linear-gradient(135deg,#0ea5e9,#3b82f6)' },
  { title: 'Closing', icon: <UnorderedListOutlined />, gradient: 'linear-gradient(135deg,#f97316,#ef4444)' },
  { title: 'Payment', icon: <DollarOutlined />,    gradient: 'linear-gradient(135deg,#10b981,#0ea5e9)' },
];

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */
const AddPaymentModal = () => {
  /* ── State ── */
  const [isDrawerVisible, setIsDrawerVisible]           = useState(false);
  const [marriages, setMarriages]                       = useState([]);
  const [filteredMarriages, setFilteredMarriages]       = useState([]);
  const [members, setMembers]                           = useState([]);
  const { message }                                     = App.useApp();
  const [fetchingMarriages, setFetchingMarriages]       = useState(false);
  const [fetchingMembers, setFetchingMembers]           = useState(false);
  const [selectedProgram, setSelectedProgram]           = useState(null);
  const [form]                                          = Form.useForm();
  const [loading, setLoading]                           = useState(false);
  const { user }                                        = useAuth();
  const dispatch                                        = useDispatch();
  const programList                                     = useSelector((s) => s.data.programList);
  const closingGroupList                                = useSelector((s) => s.data.closingGroupList);

  const [paymentMethod, setPaymentMethod]               = useState('cash');
  const [selectedMarriages, setSelectedMarriages]       = useState([]);
  const [selectedMember, setSelectedMember]             = useState(null);
  const [totalAmount, setTotalAmount]                   = useState(0);
  const [paymentPendingEntries, setPaymentPendingEntries] = useState([]);
  const [alreadyPaidMarriages, setAlreadyPaidMarriages] = useState([]);
  const [checkingReference, setCheckingReference]       = useState(false);
  const [isReferenceValid, setIsReferenceValid]         = useState(true);
  const [marriageSearchText, setMarriageSearchText]     = useState('');
  const [currentStep, setCurrentStep]                   = useState(0);
  const [paymentSummary, setPaymentSummary]             = useState(null);

  /* ── Status tab + Closing Group filter ── */
  const [activeStatusTab, setActiveStatusTab]           = useState('pending');
  const [selectedClosingGroup, setSelectedClosingGroup] = useState(null);

  /* ─────────────────────────────────────────── */
  const showDrawer = () => { setIsDrawerVisible(true); setCurrentStep(0); };

  const findClosingGroupName = (id) =>
    closingGroupList.find((g) => g.id === id)?.name || 'N/A';

  /* ── Tab counts ── */
  const tabCounts = useMemo(() => {
    const pendingIds = paymentPendingEntries
      .filter((p) => p.memberId === selectedMember)
      .map((p) => p.closingMemberId);

    const pending     = marriages.filter((m) => pendingIds.includes(m.id) && !alreadyPaidMarriages.includes(m.id)).length;
    const paid        = alreadyPaidMarriages.length;
    const notEligible = marriages.filter((m) => !pendingIds.includes(m.id) && !alreadyPaidMarriages.includes(m.id)).length;
    return { pending, paid, not_eligible: notEligible };
  }, [marriages, paymentPendingEntries, alreadyPaidMarriages, selectedMember]);

  /* ── Duplicate reference check ── */
  const checkDuplicateReference = async (reference, programId) => {
    if (!reference || !programId || !user) return false;
    try {
      setCheckingReference(true);
      const r = await api.get(`/programs/${programId}/transactions`, { q: reference, pageSize: 20 });
      const ref = String(reference).trim();
      if (r.transactions.some((t) => t.onlineReference === ref || t.transactionNumber === ref)) {
        setIsReferenceValid(false); return true;
      }

      setIsReferenceValid(true);
      return false;
    } catch (e) {
      console.error(e);
      message.error('Failed to verify reference number');
      setIsReferenceValid(false);
      return true;
    } finally {
      setCheckingReference(false);
    }
  };

  /* ── Fetch member payment info ── */
  const fetchMemberPaymentInfo = async (memberId) => {
    if (!memberId || !selectedProgram || !user) return;
    try {
      // what this member owes / has paid — one call
      const { dues } = await api.get(`/members/${memberId}/dues`);
      const pendingEntries = dues
        .filter((d) => d.status !== 'paid')
        .map((d) => ({ id: d.id, memberId, closingMemberId: d.closingMemberId, status: 'pending', payAmount: d.amount - d.paidAmount }));
      setPaymentPendingEntries(pendingEntries);
      const alreadyPaidIds = [...new Set(dues.filter((d) => d.status === 'paid').map((d) => d.closingMemberId))];
      setAlreadyPaidMarriages(alreadyPaidIds);
      return { pendingEntries, alreadyPaidIds };
    } catch (e) {
      console.error(e);
      message.error('Failed to load payment information');
      return { pendingEntries: [], alreadyPaidIds: [] };
    }
  };

  /* ── Handle submit ── */
  const handleSubmit = async (values) => {
    if (!selectedProgram || !user)   { message.error('Please select a program first'); return; }
    if (!selectedMarriages.length)   { message.error('Please select at least one marriage'); return; }
    if (!selectedMember)             { message.error('Please select a paying member'); return; }

    if (values.paymentMethod === 'online') {
      if (!values.onlineReference?.trim()) { message.error('Please enter transaction reference/UTR number'); return; }
      const isDuplicate = await checkDuplicateReference(values.onlineReference, selectedProgram.id);
      if (isDuplicate) {
        Modal.error({
          title: 'Duplicate Transaction Reference',
          content: `The reference "${values.onlineReference}" already exists.`,
          okText: 'Got it',
        });
        return;
      }
    }

    const alreadyPaidSelected = selectedMarriages.filter((id) => alreadyPaidMarriages.includes(id));
    if (alreadyPaidSelected.length > 0) {
      const remaining = selectedMarriages.length - alreadyPaidSelected.length;
      if (remaining === 0) { message.warning('All selected Closings are already paid'); return; }
      Modal.confirm({
        title: 'Already Paid Closings',
        content: (
          <div>
            <p>{alreadyPaidSelected.length} Closings are already paid.</p>
            <p className="font-medium text-green-600">Continue with {remaining} remaining?</p>
          </div>
        ),
        okText: 'Continue', cancelText: 'Cancel',
        onOk: async () => {
          await processPayment(selectedMarriages.filter((id) => !alreadyPaidMarriages.includes(id)), values);
        },
      });
      return;
    }
    await processPayment(selectedMarriages, values);
  };

  /* ── Process payment ── */
  const processPayment = async (marriageIds, values) => {
    setLoading(true);
    try {
      // the server pays every selected closing in one transaction (and refuses ones that are already paid)
      const r = await api.post(`/programs/${selectedProgram.id}/payments`, {
        type: 'single',
        payerId: selectedMember,
        closingIds: marriageIds,
        paymentMethod: values.paymentMethod,
        paymentDate: dayjs(values.paymentDate).format('YYYY-MM-DD'),
        note: values.note || '',
        onlineReference: values.paymentMethod === 'online' ? values.onlineReference : '',
      });
      if (r.skipped > 0) {
        message.warning(`${r.skipped} selected closing(s) are not owed by this member and were skipped. Add them via Members → Payment Details → Correct Payments if needed.`, 6);
      }
      setPaymentSummary({ count: r.processed, amount: r.totalPaid, method: values.paymentMethod, reference: values.onlineReference });
      message.success({ content: <div><div className="font-medium">Payment Successful!</div><div className="text-xs">Processed {r.processed} payment(s) of ₹{r.totalPaid}</div></div>, duration: 3 });
      setTimeout(handleCloseDrawer, 2000);
    } catch (e) {
      console.error(e);
      message.error(e.message || 'Failed to save payments. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Fetch closing data ── */
  const getClosingData = async () => {
    if (!user || !selectedProgram) return;
    setFetchingMarriages(true);
    try {
      const data = (await fetchAllMembers(selectedProgram.id, { closed: 'true' }))
        .filter((m) => m.active_flag && !m.delete_flag)
        .sort((a, b) => (b.closing_date_query || '').localeCompare(a.closing_date_query || ''));
      setMarriages(data);
      setFilteredMarriages(data);
    } catch (e) {
      console.error(e);
      message.error('Failed to fetch marriages');
    } finally {
      setFetchingMarriages(false);
    }
  };

  /* ── Fetch member data ── */
  const getmemberData = async () => {
    setFetchingMembers(true);
    try {
      const data = (await fetchAllMembers(selectedProgram.id, { status: 'accepted' }))
        .filter((m) => m.active_flag && !m.delete_flag);
      setMembers(data);
    } catch (e) {
      console.error(e);
      message.error('Failed to fetch members');
    } finally {
      setFetchingMembers(false);
    }
  };

  /* ── Fetch closing groups ── */
  const fetchClosingGroups = async (programId) => {
    if (!user?.uid || !programId) return;
    try {
      dispatch(setClosingGroups(await loadClosingGroups(programId)));
    } catch (e) {
      console.error(e);
    }
  };

  /* ── Effects ── */
  // members / closings are loaded only when the drawer is opened (not on every page)
  useEffect(() => {
    if (selectedProgram && isDrawerVisible) { getClosingData(); getmemberData(); }
  }, [selectedProgram, isDrawerVisible]);

  useEffect(() => {
    if (selectedMember && selectedProgram) fetchMemberPaymentInfo(selectedMember);
  }, [selectedMember, selectedProgram]);

  /* ── Filter marriages by tab + search + closing group ── */
  useEffect(() => {
    let filtered = [...marriages];

    /* Closing group filter */
    if (selectedClosingGroup) {
      filtered = filtered.filter((m) => m.closingGroupId === selectedClosingGroup);
    }

    /* Text search */
    if (marriageSearchText) {
      const s = marriageSearchText.toLowerCase();
      filtered = filtered.filter((m) =>
        m.displayName?.toLowerCase().includes(s) ||
        m.fatherName?.toLowerCase().includes(s) ||
        m.registrationNumber?.toLowerCase().includes(s)
      );
    }

    /* Status tab */
    const pendingIds = paymentPendingEntries.filter((p) => p.memberId === selectedMember).map((p) => p.closingMemberId);
    if (activeStatusTab === 'pending') {
      filtered = filtered.filter((m) => pendingIds.includes(m.id) && !alreadyPaidMarriages.includes(m.id));
    } else if (activeStatusTab === 'paid') {
      filtered = filtered.filter((m) => alreadyPaidMarriages.includes(m.id));
    } else if (activeStatusTab === 'not_eligible') {
      filtered = filtered.filter((m) => !pendingIds.includes(m.id) && !alreadyPaidMarriages.includes(m.id));
    }

    setFilteredMarriages(filtered);
  }, [marriageSearchText, activeStatusTab, marriages, paymentPendingEntries, selectedMember, alreadyPaidMarriages, selectedClosingGroup]);

  /* ── Handlers ── */
  const handleMemberSelect = async (memberId) => {
    setSelectedMember(memberId);
    setSelectedMarriages([]);
    setMarriageSearchText('');
    const member = members.find((m) => m.id === memberId);
    form.setFieldsValue({ amount: member?.payAmount || 200 });
    const { alreadyPaidIds } = await fetchMemberPaymentInfo(memberId);
    if (alreadyPaidIds.length > 0) message.info(`${alreadyPaidIds.length} marriage(s) already paid`, 2);
    setCurrentStep(1);
  };

  const handleAmountChange = (value) => {
    const amount = Number(value) || 0;
    const count  = selectedMarriages.length || 1;
    setTotalAmount(amount * count);
  };

  /* ── FIX: Select All Pending respects active filters ── */
  const handleSelectAllPending = () => {
    const pendingIds = paymentPendingEntries
      .filter((e) => e.memberId === selectedMember)
      .map((e) => e.closingMemberId)
      .filter((id) => !alreadyPaidMarriages.includes(id));

    // Use filteredMarriages — already has closing group + search text + status tab applied
    const available = filteredMarriages
      .filter((m) => pendingIds.includes(m.id))
      .map((m) => m.id);

    if (!available.length) { message.info('No pending payments in current filter'); return; }

    // Merge with existing selections (don't wipe other groups)
    setSelectedMarriages((prev) => [...new Set([...prev, ...available])]);
    message.success(`Selected ${available.length} pending payment(s)`);
  };

  const handleCloseDrawer = () => {
    setIsDrawerVisible(false);
    form.resetFields();
    setPaymentMethod('cash');
    setSelectedProgram(null);
    setMarriages([]);
    setFilteredMarriages([]);
    setMembers([]);
    setSelectedMarriages([]);
    setSelectedMember(null);
    setTotalAmount(0);
    setPaymentPendingEntries([]);
    setAlreadyPaidMarriages([]);
    setIsReferenceValid(true);
    setMarriageSearchText('');
    setCurrentStep(0);
    setPaymentSummary(null);
    setActiveStatusTab('pending');
    setSelectedClosingGroup(null);
  };

  const handleReferenceChange = async (e) => {
    const v = e.target.value;
    form.setFieldsValue({ onlineReference: v });
    if (v && v.length >= 3) await checkDuplicateReference(v, selectedProgram?.id);
    else setIsReferenceValid(true);
  };

  const handleNextStep = () => {
    if (currentStep === 0 && !selectedProgram)          { message.warning('Please select a program'); return; }
    if (currentStep === 1 && !selectedMember)           { message.warning('Please select a member'); return; }
    if (currentStep === 2 && !selectedMarriages.length) { message.warning('Please select at least one marriage'); return; }
    setCurrentStep((s) => s + 1);
  };

  /* ── Computed stats ── */
  const stats = useMemo(() => {
    const perAmount  = form.getFieldValue('amount') || 0;
    const totalSel   = selectedMarriages.length;
    const pendingSel = paymentPendingEntries.filter((p) => selectedMarriages.includes(p.closingMemberId) && p.memberId === selectedMember).length;
    return {
      totalSelected:      totalSel,
      pendingSelected:    pendingSel,
      newPayments:        totalSel - pendingSel,
      perAmount,
      totalAmount:        perAmount * totalSel,
      availableMarriages: filteredMarriages.length,
      pendingCount:       paymentPendingEntries.filter((p) => p.memberId === selectedMember).length,
      paidCount:          alreadyPaidMarriages.length,
    };
  }, [selectedMarriages, paymentPendingEntries, selectedMember, alreadyPaidMarriages, filteredMarriages]);

  const memberDetails = members.find((m) => m.id === selectedMember) || null;

  /* ─────────────────────────────────────────────
     STEP 0 — Program Selection
  ───────────────────────────────────────────── */
  const renderStep0 = () => (
    <div className="pmStep">
      <div className="pmStepHeader" style={{ background: STEPS[0].gradient }}>
        <div className="pmStepHeaderIcon">{STEPS[0].icon}</div>
        <div>
          <div className="pmStepHeaderTitle">Select Program</div>
          <div className="pmStepHeaderSub">Choose the program to record payment for</div>
        </div>
      </div>
      <div className="pmStepBody">
        <Form.Item name="program" rules={[{ required: true, message: 'Select program' }]}>
          <Select
            placeholder="Search & select program…"
            size="large"
            showSearch
            optionFilterProp="label"
            onChange={(v) => {
              const prog = programList.find((p) => p.id === v);
              setSelectedProgram(prog);
              fetchClosingGroups(v);
              form.setFieldsValue({ program: v });
            }}
            value={selectedProgram?.id}
            className="pmSelect"
            optionLabelProp="label"
          >
            {programList.map((prog) => (
              <Option key={prog.id} value={prog.id} label={prog.name}>
                <div className="pmSelectOption">
                  <span className="pmSelectAvatar" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    <AppstoreOutlined />
                  </span>
                  <div>
                    <div className="pmSelectMain">{prog.name}</div>
                    {prog.description && <div className="pmSelectSub">{prog.description}</div>}
                  </div>
                </div>
              </Option>
            ))}
          </Select>
        </Form.Item>

        {selectedProgram && (
          <div className="pmInfoBanner" style={{ borderColor: '#bfdbfe', background: 'linear-gradient(135deg,#eff6ff,#eef2ff)' }}>
            <div className="pmInfoBannerIcon" style={{ background: '#dbeafe' }}>
              <CheckCircleOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
            </div>
            <div>
              <p className="pmInfoTitle" style={{ color: '#1d4ed8' }}>Program selected</p>
              <p className="pmInfoBody" style={{ color: '#3b82f6' }}>{selectedProgram.name}</p>
            </div>
          </div>
        )}

        {!programList.length && (
          <div className="pmEmptyHint">
            <InfoCircleOutlined style={{ color: '#94a3b8', fontSize: 18 }} />
            <span>No programs available. Please create a program first.</span>
          </div>
        )}
      </div>
    </div>
  );

  /* ─────────────────────────────────────────────
     STEP 1 — Payer Selection
  ───────────────────────────────────────────── */
  const renderStep1 = () => (
    <div className="pmStep">
      <div className="pmStepHeader" style={{ background: STEPS[1].gradient }}>
        <div className="pmStepHeaderIcon">{STEPS[1].icon}</div>
        <div>
          <div className="pmStepHeaderTitle">Select Payer</div>
          <div className="pmStepHeaderSub">Who is making this payment?</div>
        </div>
      </div>
      <div className="pmStepBody">
        <Form.Item name="member" rules={[{ required: true, message: 'Select member' }]}>
          <Select
            loading={fetchingMembers}
            placeholder="Search by name, reg. no. or phone…"
            size="large"
            showSearch
            filterOption={(input, option) =>
              (option['data-search'] || '').toLowerCase().includes(input.toLowerCase())
            }
            onChange={handleMemberSelect}
            value={selectedMember}
            disabled={!selectedProgram}
            className="pmSelect"
            notFoundContent={fetchingMembers ? <Spin size="small" /> : 'No members found'}
            optionLabelProp="label"
          >
            {members.map((member) => {
              const pending = paymentPendingEntries.filter((p) => p.memberId === member.id).length;
              return (
                <Option
                  key={member.id} value={member.id}
                  label={member.displayName}
                  data-search={`${member.displayName} ${member.fatherName} ${member.registrationNumber} ${member.phone}`}
                >
                  <div className="pmSelectOption">
                    <span className="pmSelectAvatar" style={{ background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', borderRadius: '50%' }}>
                      {member.displayName?.charAt(0).toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="pmSelectMain" style={{ flex: 1 }}>{member.displayName}</span>
                        {pending > 0 && (
                          <Badge count={pending} style={{ backgroundColor: '#f97316', fontSize: 10 }} />
                        )}
                      </div>
                      <div className="pmSelectSub">{member.registrationNumber} · {member.fatherName}</div>
                    </div>
                  </div>
                </Option>
              );
            })}
          </Select>
        </Form.Item>

        {memberDetails && (
          <div className="pmMemberCard">
            <div className="pmMemberAvatarLg">
              {memberDetails.displayName?.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pmMemberName">{memberDetails.displayName}</div>
              <div className="pmMemberReg">{memberDetails.registrationNumber} · {memberDetails.fatherName}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="pmStatPill pmStatPillBlue">
                  <DollarOutlined style={{ fontSize: 10 }} />
                  ₹{memberDetails.payAmount || 200} / marriage
                </span>
                {stats.pendingCount > 0 && (
                  <span className="pmStatPill pmStatPillOrange">
                    <ClockCircleOutlined style={{ fontSize: 10 }} />
                    {stats.pendingCount} Pending
                  </span>
                )}
                {stats.paidCount > 0 && (
                  <span className="pmStatPill pmStatPillGreen">
                    <CheckCircleOutlined style={{ fontSize: 10 }} />
                    {stats.paidCount} Paid
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* ─────────────────────────────────────────────
     STEP 2 — Closing Selection
  ───────────────────────────────────────────── */
  const renderStep2 = () => (
    <div className="pmStep">
      <div className="pmStepHeader" style={{ background: STEPS[2].gradient }}>
        <div className="pmStepHeaderIcon">{STEPS[2].icon}</div>
        <div>
          <div className="pmStepHeaderTitle">Select Closings</div>
          <div className="pmStepHeaderSub">
            {selectedMarriages.length > 0
              ? `${selectedMarriages.length} selected · ₹${(form.getFieldValue('amount') || 0) * selectedMarriages.length} total`
              : 'Tap to select closings for payment'}
          </div>
        </div>
        {selectedMarriages.length > 0 && (
          <div className="pmHeaderBadge">{selectedMarriages.length}</div>
        )}
      </div>

      <div className="pmStepBody">

        {/* ── Status Tabs ── */}
        <div className="pmTabRow">
          {STATUS_TABS.map((tab) => {
            const count  = tabCounts[tab.key] ?? 0;
            const active = activeStatusTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`pmTab ${active ? 'pmTabActive' : ''}`}
                style={active ? { borderColor: tab.color, background: tab.bg, color: tab.color } : {}}
                onClick={() => setActiveStatusTab(tab.key)}
              >
                <span className="pmTabIcon" style={active ? { color: tab.color } : {}}>{tab.icon}</span>
                <span className="pmTabLabel">{tab.label}</span>
                <span
                  className="pmTabBadge"
                  style={active
                    ? { background: tab.color, color: '#fff' }
                    : { background: '#e5e7eb', color: '#6b7280' }
                  }
                >
                  {count}
                </span>
                {tab.key === 'pending' && !active && count > 0 && (
                  <span className="pmTabPulse" style={{ background: tab.color }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Filters Row ── */}
        <div className="pmFiltersRow">
          <Search
            placeholder="Search name, reg. no…"
            value={marriageSearchText}
            onChange={(e) => setMarriageSearchText(e.target.value)}
            allowClear
            size="middle"
            style={{ flex: 1, minWidth: 0 }}
          />
          <Select
            placeholder={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <FilterOutlined style={{ fontSize: 12, color: '#6b7280' }} />
                <span>All Groups</span>
              </span>
            }
            allowClear
            showSearch
            size="middle"
            optionFilterProp="label"
            value={selectedClosingGroup}
            onChange={setSelectedClosingGroup}
            style={{ width: 155 }}
          >
            {closingGroupList.map((g) => (
              <Option key={g.id} value={g.id} label={g.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="pmGroupDot" />
                  {g.name}
                </div>
              </Option>
            ))}
          </Select>
        </div>

        {/* ── Active filter chip ── */}
        {selectedClosingGroup && (
          <div className="pmActiveFilter">
            <FilterOutlined style={{ fontSize: 11, color: '#6366f1' }} />
            <span>Group: <strong>{closingGroupList.find(g => g.id === selectedClosingGroup)?.name}</strong></span>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>· {filteredMarriages.length} result{filteredMarriages.length !== 1 ? 's' : ''}</span>
            <button className="pmActiveFilterClear" onClick={() => setSelectedClosingGroup(null)}>
              <CloseOutlined style={{ fontSize: 9 }} />
            </button>
          </div>
        )}

        {/* ── Quick select pending ── */}
        {activeStatusTab === 'pending' && stats.pendingCount > 0 && (
          <div className="pmQuickAction">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ClockCircleOutlined style={{ color: '#f97316', fontSize: 13 }} />
              <span style={{ fontSize: 12, color: '#9a3412' }}>
                <strong>{filteredMarriages.filter(m => {
                  const pendingIds = paymentPendingEntries.filter(p => p.memberId === selectedMember).map(p => p.closingMemberId);
                  return pendingIds.includes(m.id) && !alreadyPaidMarriages.includes(m.id);
                }).length}</strong> pending
                {selectedClosingGroup ? ' in this group' : ' payment(s)'}
              </span>
            </div>
            <button type="button" className="pmQuickBtn" onClick={handleSelectAllPending}>
              <CheckSquareOutlined style={{ fontSize: 11 }} />
              Select All
            </button>
          </div>
        )}

        {/* ── Marriage list ── */}
        <div className="pmCardList">
          {fetchingMarriages ? (
            <div className="pmEmptyState">
              <Spin size="small" />
              <p>Loading closings…</p>
            </div>
          ) : filteredMarriages.length === 0 ? (
            <Empty
              description={
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {marriageSearchText
                    ? 'No matches found'
                    : selectedClosingGroup
                      ? 'No closings in this group'
                      : 'No closings in this category'}
                </span>
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ padding: '32px 0' }}
            />
          ) : (
            filteredMarriages.map((marriage) => {
              const isPending  = paymentPendingEntries.some((p) => p.closingMemberId === marriage.id && p.memberId === selectedMember);
              const isPaid     = alreadyPaidMarriages.includes(marriage.id);
              const isSelected = selectedMarriages.includes(marriage.id);
              const selIdx     = selectedMarriages.findIndex((id) => id === marriage.id) + 1;
              const groupName  = findClosingGroupName(marriage.closingGroupId);

              return (
                <div
                  key={marriage.id}
                  className={`pmCard ${isSelected ? 'pmCardSelected' : ''} ${isPaid ? 'pmCardPaid' : ''}`}
                  onClick={() => {
                    if (isPaid) return;
                    setSelectedMarriages((prev) =>
                      isSelected ? prev.filter((id) => id !== marriage.id) : [...prev, marriage.id]
                    );
                  }}
                >
                  <div
                    className="pmCardStripe"
                    style={{ background: isPaid ? '#10b981' : isPending ? '#f97316' : '#d1d5db' }}
                  />

                  <div className={`pmCardAvatar ${isPending && !isPaid ? 'pmCardAvatarPending' : ''} ${isPaid ? 'pmCardAvatarPaid' : ''} ${isSelected ? 'pmCardAvatarSelected' : ''}`}>
                    {isPaid
                      ? <CheckCircleOutlined />
                      : isPending
                        ? <CalendarOutlined />
                        : <UserOutlined />}
                  </div>

                  <div className="pmCardBody">
                    <div className="pmCardTop">
                      <span className="pmCardName">{marriage.displayName}</span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        {isPending && !isPaid && (
                          <span className="pmPill" style={{ background: '#fff7ed', color: '#ea580c', border: '1px solid #fdba74' }}>PENDING</span>
                        )}
                        {isPaid && (
                          <span className="pmPill" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac' }}>PAID</span>
                        )}
                      </div>
                    </div>
                    <div className="pmCardMeta">
                      <span className="pmMono">{marriage.registrationNumber}</span>
                      {marriage.fatherName && <><span className="pmDot" /><span>{marriage.fatherName}</span></>}
                      {groupName !== 'N/A' && (
                        <>
                          <span className="pmDot" />
                          <span style={{ color: '#6366f1', fontWeight: 600, fontSize: 10 }}>{groupName}</span>
                        </>
                      )}
                    </div>
                    {marriage.closing_date && (
                      <div className="pmCardDate">
                        <CalendarOutlined style={{ fontSize: 10 }} />
                        <span>Closing: {marriage.closing_date}</span>
                      </div>
                    )}
                  </div>

                  {isSelected && <div className="pmSelBadge">{selIdx}</div>}
                </div>
              );
            })
          )}
        </div>

        {/* ── Selection summary bar ── */}
        {selectedMarriages.length > 0 && (
          <div className="pmSelSummary">
            <div className="pmSelSummaryLeft">
              <span className="pmSelCount">{selectedMarriages.length}</span>
              <span className="pmSelLabel">selected</span>
            </div>
            <div className="pmSelDivider" />
            <span className="pmSelTotal">₹{(form.getFieldValue('amount') || 0) * selectedMarriages.length}</span>
            <button className="pmClearBtn" onClick={() => setSelectedMarriages([])}>
              <CloseOutlined style={{ fontSize: 10 }} /> Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );

  /* ─────────────────────────────────────────────
     STEP 3 — Payment Details
  ───────────────────────────────────────────── */
  const renderStep3 = () => (
    <div className="pmStep">
      <div className="pmStepHeader" style={{ background: STEPS[3].gradient }}>
        <div className="pmStepHeaderIcon">{STEPS[3].icon}</div>
        <div>
          <div className="pmStepHeaderTitle">Payment Details</div>
          <div className="pmStepHeaderSub">Review and confirm the payment</div>
        </div>
      </div>

      <div className="pmStepBody">
        {/* Amount hero */}
        <div className="pmAmountHero">
          <div className="pmAmountLabel">Total Payable</div>
          <div className="pmAmountValue">₹{stats.totalAmount.toLocaleString('en-IN')}</div>
          <div className="pmAmountSub">
            {stats.totalSelected} closing{stats.totalSelected !== 1 ? 's' : ''} × ₹{stats.perAmount}
          </div>
        </div>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="amount"
              label={<span className="pmLabel">Per Marriage (₹)</span>}
              rules={[
                { required: true, message: 'Enter amount' },
                { validator: (_, v) => Number(v) > 0 ? Promise.resolve() : Promise.reject('Must be > 0') },
              ]}
            >
              <Input
                type="number"
                placeholder="200"
                prefix={<span style={{ color: '#9ca3af', fontWeight: 600 }}>₹</span>}
                onChange={(e) => handleAmountChange(e.target.value)}
                size="large"
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="paymentMethod" label={<span className="pmLabel">Method</span>} rules={[{ required: true }]}>
              <Select onChange={setPaymentMethod} size="large" value={paymentMethod}>
                <Option value="cash">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <WalletOutlined style={{ color: '#10b981' }} /><span>Cash</span>
                  </div>
                </Option>
                <Option value="online">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CreditCardOutlined style={{ color: '#3b82f6' }} /><span>Online Transfer</span>
                  </div>
                </Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="paymentDate" label={<span className="pmLabel">Payment Date</span>} rules={[{ required: true, message: 'Select date' }]}>
          <DatePicker className="w-full" format="DD/MM/YYYY" size="large" suffixIcon={<CalendarOutlined style={{ color: '#9ca3af' }} />} />
        </Form.Item>

        {paymentMethod === 'online' && (
          <Form.Item
            name="onlineReference"
            label={<span className="pmLabel">UTR / Transaction Reference</span>}
            rules={[{ required: true, message: 'Enter reference' }, { min: 3, message: 'Min 3 characters' }]}
            validateStatus={!isReferenceValid ? 'error' : checkingReference ? 'validating' : ''}
            help={!isReferenceValid ? 'Reference already exists in this program' : ''}
          >
            <Input
              placeholder="e.g. 426711234567"
              onChange={handleReferenceChange}
              size="large"
              suffix={
                checkingReference ? <Spin size="small" /> :
                isReferenceValid && form.getFieldValue('onlineReference') ? <CheckCircleOutlined style={{ color: '#10b981' }} /> :
                !isReferenceValid ? <WarningOutlined style={{ color: '#ef4444' }} /> : null
              }
            />
          </Form.Item>
        )}

        <Form.Item name="note" label={<span className="pmLabel">Note (Optional)</span>}>
          <TextArea rows={2} placeholder="Add any notes…" maxLength={200} showCount size="large" />
        </Form.Item>

        {/* Summary table */}
        <div className="pmSummaryTable">
          <div className="pmSummaryTableTitle">Payment Summary</div>
          <div className="pmSummaryRow">
            <span>Payer</span>
            <span style={{ fontWeight: 600 }}>{memberDetails?.displayName || '—'}</span>
          </div>
          <div className="pmSummaryRow">
            <span>Selected Closings</span>
            <span>{selectedMarriages.length}</span>
          </div>
          <div className="pmSummaryRow">
            <span>Per Marriage</span>
            <span>₹{form.getFieldValue('amount') || 0}</span>
          </div>
          <div className="pmSummaryRow">
            <span>Payment Method</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {paymentMethod === 'cash'
                ? <><WalletOutlined style={{ color: '#10b981' }} /> Cash</>
                : <><CreditCardOutlined style={{ color: '#3b82f6' }} /> Online Transfer</>}
            </span>
          </div>
          <div className="pmSummaryDivider" />
          <div className="pmSummaryTotal">
            <span>Total Payable</span>
            <span>₹{stats.totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );

  /* ─────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────── */
  return (
    <div>
      <Button
        type="primary"
        title="Add Payment"
        onClick={showDrawer}
        icon={<PlusOutlined />}
        size="middle"
        className="bg-gradient-to-r from-green-500 to-blue-500 border-0 shadow-lg hover:shadow-xl transition-all"
      >
        Add Payment
      </Button>

      <Drawer
        title={
          <div className="pmDrawerHeader">
            <div className="pmDrawerLogo">
              <DollarOutlined style={{ fontSize: 18, color: '#fff' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pmDrawerTitle">Record Payment</div>
              <div className="pmDrawerSub">Process marriage closing payments</div>
            </div>
            {selectedProgram && (
              <div className="pmDrawerProgramChip">
                <AppstoreOutlined style={{ fontSize: 10, flexShrink: 0 }} />
                <span>{selectedProgram.name}</span>
              </div>
            )}
          </div>
        }
        placement="right"
        onClose={handleCloseDrawer}
        open={isDrawerVisible}
        width={600}
        closable
        destroyOnHidden
        className="pmDrawer"
        footer={
          <div className="pmFooter">
            <Steps
              current={currentStep}
              size="small"
              className="pmSteps"
              items={STEPS.map((s) => ({ title: s.title, icon: s.icon }))}
            />
            <div className="pmFooterActions">
              {currentStep > 0 && (
                <Button onClick={() => setCurrentStep((s) => s - 1)} disabled={loading} size="large" className="pmBackBtn">
                  ← Back
                </Button>
              )}
              {currentStep < 3 ? (
                <Button
                  type="primary"
                  onClick={handleNextStep}
                  size="large"
                  block={currentStep === 0}
                  className="pmNextBtn"
                >
                  Continue →
                </Button>
              ) : (
                <Button
                  type="primary"
                  onClick={() => form.submit()}
                  loading={loading}
                  disabled={
                    !selectedMarriages.length ||
                    !form.getFieldValue('amount') ||
                    (paymentMethod === 'online' && !isReferenceValid) ||
                    checkingReference
                  }
                  icon={<CheckCircleOutlined />}
                  block
                  size="large"
                  className="pmConfirmBtn"
                >
                  Confirm Payment · ₹{stats.totalAmount.toLocaleString('en-IN')}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          size="large"
          initialValues={{ paymentDate: dayjs(), paymentMethod: 'cash', amount: 200 }}
        >
          {currentStep === 0 && renderStep0()}
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </Form>

        {/* Success overlay */}
        {paymentSummary && (
          <div className="pmSuccessOverlay">
            <div className="pmSuccessCard">
              <div className="pmSuccessRing">
                <div className="pmSuccessIcon">
                  <CheckCircleOutlined style={{ color: '#10b981', fontSize: 40 }} />
                </div>
              </div>
              <h3 className="pmSuccessTitle">Payment Successful!</h3>
              <p className="pmSuccessBody">
                {paymentSummary.count} payment{paymentSummary.count !== 1 ? 's' : ''} of&nbsp;
                <strong>₹{paymentSummary.amount.toLocaleString('en-IN')}</strong> processed via{' '}
                {paymentSummary.method === 'cash' ? 'Cash' : 'Online Transfer'}.
              </p>
              {paymentSummary.reference && (
                <div className="pmSuccessRef">Ref: {paymentSummary.reference}</div>
              )}
              <div className="pmSuccessRedirect">
                <Spin size="small" style={{ marginRight: 6 }} />
                Closing drawer…
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* ── All styles ── */}
      <style jsx global>{`
        /* ── Drawer shell ───────────────────────────── */
        .pmDrawer .ant-drawer-content-wrapper {
          border-radius: 16px 0 0 16px !important;
          overflow: hidden;
          box-shadow: -12px 0 48px rgba(0,0,0,0.14) !important;
        }
        .pmDrawer .ant-drawer-body   { padding: 0 !important; overflow-x: hidden; background: #f8fafc; }
        .pmDrawer .ant-drawer-header { padding: 14px 20px !important; background: #fff; border-bottom: 1px solid #f1f5f9 !important; }
        .pmDrawer .ant-drawer-footer { padding: 0 !important; border-top: none !important; }
        .pmDrawer .ant-drawer-close  { top: 12px; right: 16px; color: #94a3b8; }
        .pmDrawer .ant-drawer-close:hover { color: #475569; }

        /* ── Drawer header ──────────────────────────── */
        .pmDrawerHeader      { display:flex;align-items:center;gap:12px; }
        .pmDrawerLogo        { width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#6366f1);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(99,102,241,.3); }
        .pmDrawerTitle       { font-size:15px;font-weight:700;color:#0f172a;line-height:1.2; }
        .pmDrawerSub         { font-size:11px;color:#94a3b8;margin-top:1px; }
        .pmDrawerProgramChip { display:flex;align-items:center;gap:5px;padding:4px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;font-size:11px;color:#1d4ed8;font-weight:500;max-width:150px;overflow:hidden;flex-shrink:0; }
        .pmDrawerProgramChip span { white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }

        /* ── Step layout ────────────────────────────── */
        .pmStep              { display:flex;flex-direction:column;min-height:100%; }

        /* ── Step header banner ─────────────────────── */
        .pmStepHeader        { display:flex;align-items:center;gap:14px;padding:3px 24px;color:#fff; }
        .pmStepHeaderIcon    { width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0; }
        .pmStepHeaderTitle   { font-size:16px;font-weight:700;color:#fff;margin:0; }
        .pmStepHeaderSub     { font-size:12px;color:rgba(255,255,255,.8);margin-top:2px; }
        .pmHeaderBadge       { margin-left:auto;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0; }

        .pmStepBody          { padding:20px 24px 16px;flex:1; }

        /* ── Select ─────────────────────────────────── */
        .pmSelect            { width:100% !important; }
        .pmSelectOption      { display:flex;align-items:center;gap:10px;padding:2px 0; }
        .pmSelectAvatar      { width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0;border-radius:8px; }
        .pmSelectMain        { font-size:13px;font-weight:500;color:#0f172a; }
        .pmSelectSub         { font-size:11px;color:#94a3b8;margin-top:1px; }

        /* ── Info banner ────────────────────────────── */
        .pmInfoBanner        { display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border-width:1px;border-style:solid;margin-top:4px; }
        .pmInfoBannerIcon    { width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .pmInfoTitle         { font-size:12px;font-weight:600;margin:0 0 2px; }
        .pmInfoBody          { font-size:13px;font-weight:500;margin:0; }

        /* ── Empty hint ─────────────────────────────── */
        .pmEmptyHint         { display:flex;align-items:center;gap:8px;padding:16px;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:10px;font-size:12px;color:#94a3b8; }

        /* ── Member card ────────────────────────────── */
        .pmMemberCard        { display:flex;align-items:center;gap:14px;padding:14px 16px;background:#fff;border:1.5px solid #e0e7ff;border-radius:14px;margin-top:4px;box-shadow:0 2px 8px rgba(99,102,241,.06); }
        .pmMemberAvatarLg    { width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#0ea5e9,#3b82f6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:700;flex-shrink:0;box-shadow:0 4px 12px rgba(14,165,233,.3); }
        .pmMemberName        { font-size:15px;font-weight:700;color:#0f172a; }
        .pmMemberReg         { font-size:12px;color:#64748b;margin-top:2px; }

        /* ── Stat pills ─────────────────────────────── */
        .pmStatPill          { display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600; }
        .pmStatPillBlue      { background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe; }
        .pmStatPillOrange    { background:#fff7ed;color:#ea580c;border:1px solid #fed7aa; }
        .pmStatPillGreen     { background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0; }

        /* ── Status tabs ────────────────────────────── */
        .pmTabRow            { display:flex;gap:8px;margin-bottom:12px; }
        .pmTab               { flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:9px 6px;border-radius:10px;border:1.5px solid #e5e7eb;background:#fff;cursor:pointer;transition:all .18s ease;font-size:12px;color:#6b7280;font-weight:500;position:relative;overflow:hidden; }
        .pmTab:hover         { border-color:#d1d5db;background:#f9fafb; }
        .pmTabActive         { font-weight:700 !important;box-shadow:0 2px 8px rgba(0,0,0,.08); }
        .pmTabIcon           { font-size:13px; }
        .pmTabLabel          { white-space:nowrap; }
        .pmTabBadge          { border-radius:20px;padding:1px 7px;font-size:11px;font-weight:700;min-width:20px;text-align:center;transition:all .18s; }
        .pmTabPulse          { position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;animation:pmPulse 2s infinite; }
        @keyframes pmPulse   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }

        /* ── Filters row ────────────────────────────── */
        .pmFiltersRow        { display:flex;gap:8px;margin-bottom:8px;align-items:center; }

        /* ── Active filter chip ─────────────────────── */
        .pmActiveFilter      { display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:20px;font-size:12px;color:#6366f1;margin-bottom:10px; }
        .pmActiveFilterClear { display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#ddd6fe;border:none;cursor:pointer;color:#6366f1;padding:0;margin-left:2px; }
        .pmActiveFilterClear:hover { background:#c4b5fd; }

        /* ── Group dot ──────────────────────────────── */
        .pmGroupDot          { width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);flex-shrink:0; }

        /* ── Quick action ───────────────────────────── */
        .pmQuickAction       { display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin-bottom:10px; }
        .pmQuickBtn          { display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#ea580c;background:none;border:1.5px solid #fed7aa;border-radius:6px;padding:4px 10px;cursor:pointer;transition:all .15s; }
        .pmQuickBtn:hover    { background:#ffedd5;border-color:#f97316; }

        /* ── Card list ──────────────────────────────── */
        .pmCardList          { max-height:310px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:8px; }
        .pmCardList::-webkit-scrollbar       { width:4px; }
        .pmCardList::-webkit-scrollbar-track { background:transparent; }
        .pmCardList::-webkit-scrollbar-thumb { background:#cbd5e1;border-radius:4px; }

        /* ── Marriage card ──────────────────────────── */
        .pmCard              { display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1.5px solid #e2e8f0;background:#fff;margin-bottom:6px;cursor:pointer;transition:all .15s ease;position:relative;overflow:hidden; }
        .pmCard:last-child   { margin-bottom:0; }
        .pmCard:hover:not(.pmCardPaid) { border-color:#93c5fd;box-shadow:0 2px 10px rgba(59,130,246,.12);transform:translateY(-1px); }
        .pmCardSelected      { border-color:#3b82f6 !important;background:#eff6ff !important;box-shadow:0 3px 14px rgba(59,130,246,.18) !important; }
        .pmCardPaid          { cursor:default;opacity:.7; }
        .pmCardStripe        { position:absolute;left:0;top:0;bottom:0;width:3px; }
        .pmCardAvatar        { width:34px;height:34px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;flex-shrink:0; }
        .pmCardAvatarPending { background:#fff7ed;color:#f97316; }
        .pmCardAvatarPaid    { background:#f0fdf4;color:#10b981; }
        .pmCardAvatarSelected{ background:#dbeafe;color:#3b82f6; }
        .pmCardBody          { flex:1;min-width:0; }
        .pmCardTop           { display:flex;align-items:center;gap:6px;margin-bottom:3px; }
        .pmCardName          { font-size:13px;font-weight:600;color:#0f172a;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .pmCardMeta          { display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:11px;color:#64748b; }
        .pmCardDate          { display:flex;align-items:center;gap:4px;font-size:10px;color:#94a3b8;margin-top:3px; }
        .pmMono              { font-family:ui-monospace,monospace;font-size:11px;color:#475569; }
        .pmDot               { width:3px;height:3px;border-radius:50%;background:#cbd5e1;flex-shrink:0; }
        .pmPill              { font-size:9px;font-weight:700;padding:2px 6px;border-radius:20px;letter-spacing:.4px;white-space:nowrap; }
        .pmSelBadge          { width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(59,130,246,.4); }

        /* ── Selection summary bar ──────────────────── */
        .pmSelSummary        { display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(135deg,#eff6ff,#eef2ff);border:1.5px solid #bfdbfe;border-radius:10px;margin-top:10px; }
        .pmSelSummaryLeft    { display:flex;align-items:baseline;gap:4px; }
        .pmSelCount          { font-size:22px;font-weight:800;color:#1d4ed8;line-height:1; }
        .pmSelLabel          { font-size:11px;color:#3b82f6;font-weight:500; }
        .pmSelDivider        { width:1px;height:24px;background:#bfdbfe; }
        .pmSelTotal          { font-size:14px;font-weight:700;color:#1d4ed8;flex:1; }
        .pmClearBtn          { display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#3b82f6;background:#fff;border:1px solid #bfdbfe;border-radius:6px;padding:4px 10px;cursor:pointer;transition:all .15s; }
        .pmClearBtn:hover    { background:#dbeafe;border-color:#93c5fd; }

        /* ── Amount hero ────────────────────────────── */
        .pmAmountHero        { text-align:center;padding:22px;background:linear-gradient(135deg,#eef2ff,#ede9fe);border-radius:14px;border:1px solid #c7d2fe;margin-bottom:20px; }
        .pmAmountLabel       { font-size:11px;font-weight:600;color:#6366f1;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px; }
        .pmAmountValue       { font-size:34px;font-weight:800;color:#1e1b4b;line-height:1; }
        .pmAmountSub         { font-size:12px;color:#818cf8;margin-top:6px; }

        /* ── Summary table ──────────────────────────── */
        .pmSummaryTable      { background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-top:8px; }
        .pmSummaryTableTitle { font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px; }
        .pmSummaryRow        { display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#475569;padding:6px 0;border-bottom:1px solid #f1f5f9; }
        .pmSummaryRow:last-of-type { border-bottom:none; }
        .pmSummaryRow span:last-child { font-weight:500;color:#0f172a; }
        .pmSummaryDivider    { border-top:2px dashed #e2e8f0;margin:8px 0; }
        .pmSummaryTotal      { display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:800;color:#0f172a;padding-top:4px; }
        .pmSummaryTotal span:last-child { color:#10b981;font-size:20px; }

        /* ── Form label ─────────────────────────────── */
        .pmLabel             { font-size:12px;font-weight:600;color:#475569;letter-spacing:.2px; }

        /* ── Footer ─────────────────────────────────── */
        .pmFooter            { padding:12px 20px 16px;background:#fff;border-top:1px solid #f1f5f9;box-shadow:0 -4px 16px rgba(0,0,0,.04); }
        .pmSteps             { margin-bottom:12px; }
        .pmSteps .ant-steps-item-title { font-size:11px !important; }
        .pmFooterActions     { display:flex;gap:8px; }
        .pmBackBtn           { border-radius:10px !important; }
        .pmNextBtn           { background:#3b82f6 !important;border:none !important;border-radius:10px !important;font-weight:600 !important; }
        .pmConfirmBtn        { background:linear-gradient(135deg,#10b981,#3b82f6) !important;border:none !important;border-radius:10px !important;font-weight:700 !important;height:46px !important;font-size:14px !important; }

        /* ── Empty state ────────────────────────────── */
        .pmEmptyState        { display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 0;gap:10px; }
        .pmEmptyState p      { font-size:12px;color:#94a3b8;margin:0; }

        /* ── Success overlay ────────────────────────── */
        .pmSuccessOverlay    { position:fixed;inset:0;background:rgba(15,23,42,.65);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(8px); }
        .pmSuccessCard       { background:#fff;border-radius:24px;padding:40px 36px;max-width:340px;width:90%;text-align:center;animation:pmBounce .5s cubic-bezier(.34,1.56,.64,1);box-shadow:0 24px 64px rgba(0,0,0,.2); }
        .pmSuccessRing       { width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,#d1fae5,#a7f3d0);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 24px rgba(16,185,129,.2); }
        .pmSuccessIcon       { width:64px;height:64px;background:#ecfdf5;border-radius:50%;display:flex;align-items:center;justify-content:center; }
        .pmSuccessTitle      { font-size:22px;font-weight:800;color:#0f172a;margin:0 0 8px; }
        .pmSuccessBody       { font-size:14px;color:#64748b;margin:0;line-height:1.5; }
        .pmSuccessRef        { display:inline-block;margin-top:12px;padding:4px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;font-size:12px;color:#1d4ed8;font-weight:600; }
        .pmSuccessRedirect   { display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;color:#94a3b8;margin-top:18px; }

        @keyframes pmBounce  { 0%{opacity:0;transform:scale(.3)} 60%{opacity:1;transform:scale(1.06)} 80%{transform:scale(.97)} 100%{transform:scale(1)} }

        /* ── Ant Design overrides ───────────────────── */
        .pmDrawer .ant-form-item          { margin-bottom:16px; }
        .pmDrawer .ant-form-item-label    { padding-bottom:4px; }
        .pmDrawer .ant-form-item-label label { font-size:12px;color:#475569; }
        .pmDrawer .ant-input-affix-wrapper,
        .pmDrawer .ant-input,
        .pmDrawer .ant-select:not(.ant-select-customize-input) .ant-select-selector { border-radius:10px !important; }
        .pmDrawer .ant-picker               { border-radius:10px !important;width:100%; }
        .pmDrawer .ant-select-selection-item { font-size:13px; }
        .pmDrawer .ant-badge-count          { box-shadow:none; }
        .pmDrawer .ant-steps-item-icon      { width:26px !important;height:26px !important;font-size:12px !important;line-height:26px !important; }
      `}</style>
    </div>
  );
};

export default AddPaymentModal;