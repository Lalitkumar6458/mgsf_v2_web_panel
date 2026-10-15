'use client'
// Members page: status tabs with live counts, inline filters (+ more filters), column chooser,
// row selection with bulk actions, PDF (real file) / CSV / print export of exactly what is shown.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic';
import { AgGridReact } from 'ag-grid-react';
import {
    ClientSideRowModelModule, ModuleRegistry, NumberEditorModule,
    NumberFilterModule, PaginationModule, RowSelectionModule,
    TextEditorModule, TextFilterModule, ValidationModule, RowStyleModule, themeQuartz
} from 'ag-grid-community';
import {
    EyeOutlined, EditOutlined, PlusCircleOutlined, DeleteOutlined
} from '@ant-design/icons';
import {
    Avatar, Button, Dropdown, Tag, Tooltip, Select, Checkbox, Popover,
    DatePicker, Badge, message, Input, App, Empty
} from 'antd';
import {
    FiSearch, FiDownload, FiFileText, FiPrinter, FiColumns, FiSliders, FiX, FiRefreshCw,
    FiAward, FiCreditCard, FiUsers, FiAlertCircle, FiChevronDown
} from 'react-icons/fi';
import { MdOutlinePendingActions } from 'react-icons/md';
import { GrCertificate } from 'react-icons/gr';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllMembers } from '@/lib/services/firebaseService';
import { api } from '@/lib/client/api';
import { useAuth, useCan } from '@/lib/AuthProvider';
import { BsThreeDots } from 'react-icons/bs';
import MemberDetailsView from '../MemberDetailsView';
import EditMember from '../EditMember';
import MemberCertificateCom from '../MemberCertificates';
import { FaFile } from 'react-icons/fa';
import MemberRegForm from '../MemberRegForm';
import { setgetMemberDataChange } from '@/redux/slices/commonSlice';
import ClosingForm from './ClosingForm';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { fetchSingleMemberMarriageReport } from '@/lib/helper';
import MemberPaymentDetails from './MemberPaymentDetails';
import MemberExportPDF from './MemberExportPDF';
import JoinFeesMemberList from './JoinFeesCom/JoinFeesMemberList';
import { getStateLabel, getDistrictLabel } from '@/lib/staticData';
import { amountsHidden, useAmountsHidden, MASK, AmountsEye } from "@/lib/client/privacy";

const MemberPdfExportDrawer = dynamic(() => import('./MemberPdfExportDrawer'), { ssr: false });

dayjs.extend(customParseFormat);
const { RangePicker } = DatePicker;

ModuleRegistry.registerModules([
    NumberEditorModule, TextEditorModule, TextFilterModule,
    NumberFilterModule, RowSelectionModule, PaginationModule,
    ClientSideRowModelModule, ValidationModule, RowStyleModule
]);

// ── status buckets (same rules as the dashboard; they never overlap) ─────────
const TABS = [
    { key: 'all',      label: 'All',       color: '#52514e' },
    { key: 'active',   label: 'Active',    color: '#0ca30c' },
    { key: 'inactive', label: 'Inactive',  color: '#d99400' },
    { key: 'blocked',  label: 'Blocked',   color: '#d03b3b' },
    { key: 'closed',   label: 'Closed',    color: '#6250d6' },
    { key: 'pending',  label: 'Requests',  color: '#2a78d6' },
    { key: 'rejected', label: 'Rejected',  color: '#898781' },
];
const ON_BOOKS = ['active', 'inactive', 'blocked', 'closed'];
const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', blocked: 'Blocked', closed: 'Closed', pending: 'Request', rejected: 'Rejected' };
const STATUS_HI = { active: 'सक्रिय', inactive: 'निष्क्रिय', blocked: 'ब्लॉक', closed: 'क्लोज़', pending: 'अनुरोध', rejected: 'अस्वीकृत' };

function bucketOf(m) {
    if (m.status === 'pending') return 'pending';
    if (m.status === 'rejected' || m.status === 'removed') return 'rejected';
    if (m.closingDate || m.status === 'closed') return 'closed';
    if (m.isBlocked || m.blocked) return 'blocked';
    if (m.active === false) return 'inactive';
    return 'active';
}

const DATE_PRESETS = [
    { label: 'This month',    value: [dayjs().startOf('month'), dayjs().endOf('month')] },
    { label: 'Last month',    value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
    { label: 'Last 3 months', value: [dayjs().subtract(3, 'month').startOf('day'), dayjs()] },
    { label: 'This year',     value: [dayjs().startOf('year'), dayjs().endOf('year')] },
    { label: 'Last year',     value: [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')] },
];

const EMPTY_FILTERS = {
    q: '', agent: undefined, gender: 'all', fees: 'all', dues: 'all', joinRange: null,
    ageGroup: undefined, state: undefined, district: undefined, village: undefined, addedBy: 'all', kist: undefined,
};

const parseDMY = (s) => {
    if (!s) return null;
    const d = dayjs(s, ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], true);
    return d.isValid() ? d : null;
};
const inr = (n) => (amountsHidden() ? MASK : '₹' + Number(n || 0).toLocaleString('en-IN')); // hidden until the eye is clicked

const COLUMN_KEYS = [
    ['registrationNumber', 'Reg. No.'], ['applicationNumber', 'Application No.'], ['fatherName', 'Father / Husband'],
    ['gotra', 'Gotra'], ['phone', 'Phone'], ['gender', 'Gender'], ['village', 'Village'], ['_district', 'District'],
    ['_state', 'State'], ['guardian', 'Guardian'], ['agentName', 'Agent'], ['addedByName', 'Created by'],
    ['dateJoin', 'Join date'], ['ageGroupRange', 'Age group'], ['payAmount', 'Kist'], ['joinFeesDone', 'Join fees'],
    ['openAmount', 'Dues'], ['_bucket', 'Status'], ['aadhaarNo', 'Aadhaar'],
];
const DEFAULT_VISIBLE = ['registrationNumber', 'fatherName', 'phone', 'village', 'agentName', 'dateJoin', 'joinFeesDone', 'openAmount', '_bucket'];
const COLS_STORE = 'mgsf.memberCols.v1';
const GRID_THEME = themeQuartz.withParams({
    fontSize: 13, headerBackgroundColor: '#fafaf8', headerFontWeight: 600, rowHoverColor: '#f5f8fe',
    selectedRowBackgroundColor: '#eaf2fd', borderColor: '#eeede8', wrapperBorder: false, wrapperBorderRadius: 0,
    accentColor: '#2a78d6',
});

// ── main component ─────────────────────────────────────────────────────────────
const MemberList = () => {
    const [allMembersData,       setAllMembersData]       = useState([]);
    const [isLoading,            setIsLoading]            = useState(false);

    const [selectedMember,       setSelectedMember]       = useState(null);
    const [isDetailsView,        setIsDetailsView]        = useState(false);
    const [isEditmemberOpen,     setIsEditmemberOpen]     = useState(false);
    const [isCertModalOpen,      setIsCertModalOpen]      = useState(false);
    const [isOpenRegModal,       setIsOpenRegModal]       = useState(false);
    const [isOpenClosingForm,    setIsOpenClosingForm]    = useState(false);
    const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(false);
    const [paymentReport,        setPaymentReport]        = useState(null);
    const [loadingReport,        setLoadingReport]        = useState(false);

    const [isExportOpen,         setIsExportOpen]         = useState(false);   // print view
    const [isPdfOpen,            setIsPdfOpen]            = useState(false);   // real PDF
    const [JoinFeesMemberListOpen, setJoinFeesMemberListOpen] = useState(false);
    const [isCertDownloading,    setIsCertDownloading]    = useState(false);

    const [tab, setTab]           = useState('active');
    const [f, setF]               = useState(EMPTY_FILTERS);
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
    const [selectedIds, setSelectedIds] = useState([]);
    const [visibleCols, setVisibleCols] = useState(DEFAULT_VISIBLE);

    const dispatch           = useDispatch();
    const memberStatusChange = useSelector(s => s.data.getMemberDataChange);
    const selectedProgram    = useSelector(s => s.data.selectedProgram);
    const { agentsList }     = useSelector(s => s.data);
    const TrustData          = useSelector(s => s.data.trustData);
    const { user }           = useAuth();
    const can                = useCan();
    const { modal }          = App.useApp();
    const gridRef            = useRef();
    const amountsAreHidden   = useAmountsHidden();
    useEffect(() => { gridRef.current?.api?.refreshCells({ force: true }); }, [amountsAreHidden]);

    // remembered column choice
    useEffect(() => {
        try { const v = JSON.parse(localStorage.getItem(COLS_STORE)); if (Array.isArray(v) && v.length) setVisibleCols(v); } catch { /* ignore */ }
    }, []);
    useEffect(() => { try { localStorage.setItem(COLS_STORE, JSON.stringify(visibleCols)); } catch { /* ignore */ } }, [visibleCols]);

    // ── fetch ──────────────────────────────────────────────────────────────────
    const onGridReady = useCallback(async () => {
        if (!selectedProgram) return;
        setIsLoading(true);
        try {
            const memberData = await fetchAllMembers(selectedProgram.id);
            dispatch(setgetMemberDataChange(false));
            setAllMembersData(memberData);
        } catch (e) {
            console.error('Error fetching members:', e);
            message.error('Failed to load members');
        } finally {
            setIsLoading(false);
        }
    }, [selectedProgram, dispatch]);

    useEffect(() => { onGridReady(); }, [selectedProgram, memberStatusChange]);
    useEffect(() => { setF(EMPTY_FILTERS); setSelectedIds([]); }, [selectedProgram?.id]);

    // enrich once: status bucket + readable state / district
    const enriched = useMemo(() => allMembersData.map((m) => {
        const b = bucketOf(m);
        return {
            ...m,
            _bucket: b,
            _statusLabel: STATUS_HI[b],
            _state: getStateLabel(m.state) || m.state || '',
            _district: getDistrictLabel(m.district, m.state) || m.district || '',
            _join: parseDMY(m.dateJoin),
            openAmount: Number(m.openAmount || 0),
            openDues: Number(m.openDues || 0),
        };
    }), [allMembersData]);

    // option lists from the data itself
    const options = useMemo(() => {
        const uniq = (k) => [...new Set(enriched.map((m) => m[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
        return {
            ageGroup: uniq('ageGroupRange'), state: uniq('_state'), village: uniq('village'),
            district: [...new Set(enriched.filter((m) => !f.state || m._state === f.state).map((m) => m._district).filter(Boolean))].sort(),
            kist: [...new Set(enriched.map((m) => m.payAmount).filter((v) => v !== undefined && v !== null && v !== ''))].sort((a, b) => a - b),
        };
    }, [enriched, f.state]);

    // every filter except the status tab
    const base = useMemo(() => {
        const q = f.q.trim().toLowerCase();
        const [from, to] = f.joinRange || [];
        return enriched.filter((m) => {
            if (f.agent === '__none' ? m.agentId : f.agent && m.agentId !== f.agent) return false;
            if (f.gender !== 'all' && (m.gender || '').toLowerCase() !== f.gender) return false;
            if (f.fees === 'paid' && !m.joinFeesDone) return false;
            if (f.fees === 'pending' && m.joinFeesDone) return false;
            if (f.dues === 'has' && !(m.openAmount > 0)) return false;
            if (f.dues === 'none' && m.openAmount > 0) return false;
            if (from && to && !(m._join && !m._join.isBefore(from.startOf('day')) && !m._join.isAfter(to.endOf('day')))) return false;
            if (f.ageGroup && m.ageGroupRange !== f.ageGroup) return false;
            if (f.state && m._state !== f.state) return false;
            if (f.district && m._district !== f.district) return false;
            if (f.village && m.village !== f.village) return false;
            if (f.addedBy !== 'all' && (m.addedBy || 'admin') !== f.addedBy) return false;
            if (f.kist !== undefined && String(m.payAmount) !== String(f.kist)) return false;
            if (q) {
                const hay = [m.displayName, m.registrationNumber, m.applicationNumber, m.fatherName, m.aadhaarNo, m.phone,
                    m.village, m.city, m._district, m._state, m.gotra, m.guardian, m.agentName].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [enriched, f]);

    const counts = useMemo(() => {
        const c = Object.fromEntries(TABS.map((t) => [t.key, 0]));
        for (const m of base) c[m._bucket]++;
        c.all = ON_BOOKS.reduce((s, k) => s + c[k], 0);
        return c;
    }, [base]);

    const filteredMembersData = useMemo(
        () => base.filter((m) => (tab === 'all' ? ON_BOOKS.includes(m._bucket) : m._bucket === tab)),
        [base, tab]
    );
    const selectedRows = useMemo(() => {
        const s = new Set(selectedIds);
        return filteredMembersData.filter((m) => s.has(m.id));
    }, [filteredMembersData, selectedIds]);
    const exportRows = selectedRows.length ? selectedRows : filteredMembersData;

    // summary of what is shown
    const summary = useMemo(() => {
        const r = filteredMembersData;
        return {
            male: r.filter((m) => m.gender === 'male').length,
            female: r.filter((m) => m.gender === 'female').length,
            feesPending: r.filter((m) => !m.joinFeesDone).length,
            withDues: r.filter((m) => m.openAmount > 0).length,
            dues: r.reduce((s, m) => s + m.openAmount, 0),
        };
    }, [filteredMembersData]);

    // ── filter chips / text ────────────────────────────────────────────────────
    const agentName = (id) => id === '__none' ? 'No agent (admin)' : (agentsList?.find((a) => a.id === id)?.displayName || id);
    const chips = [
        f.q && { k: 'q', label: `Search: "${f.q}"` },
        f.agent && { k: 'agent', label: `Agent: ${agentName(f.agent)}` },
        f.gender !== 'all' && { k: 'gender', label: f.gender === 'male' ? 'Male' : 'Female' },
        f.fees !== 'all' && { k: 'fees', label: f.fees === 'paid' ? 'Join fees paid' : 'Join fees pending' },
        f.dues !== 'all' && { k: 'dues', label: f.dues === 'has' ? 'Has pending dues' : 'No dues' },
        f.joinRange && { k: 'joinRange', label: `Joined ${f.joinRange[0].format('DD/MM/YY')} – ${f.joinRange[1].format('DD/MM/YY')}` },
        f.ageGroup && { k: 'ageGroup', label: `Age: ${f.ageGroup}` },
        f.state && { k: 'state', label: f.state },
        f.district && { k: 'district', label: f.district },
        f.village && { k: 'village', label: `Village: ${f.village}` },
        f.addedBy !== 'all' && { k: 'addedBy', label: f.addedBy === 'agent' ? 'Added by agent' : 'Added by admin' },
        f.kist !== undefined && { k: 'kist', label: `Kist ₹${f.kist}` },
    ].filter(Boolean);
    const moreCount = ['ageGroup', 'state', 'district', 'village', 'kist'].filter((k) => f[k] !== undefined).length + (f.addedBy !== 'all' ? 1 : 0);
    const clearChip = (k) => set(k, EMPTY_FILTERS[k]);

    const filterSummary = [
        TABS.find((t) => t.key === tab)?.label + ' members',
        ...chips.map((c) => c.label),
        selectedRows.length ? `${selectedRows.length} selected` : null,
    ].filter(Boolean).join(' · ');
    const filtersTextHi = [
        tab === 'all' ? 'सभी सदस्य' : `${STATUS_HI[tab]} सदस्य`,
        ...chips.map((c) => c.label),
        selectedRows.length ? `${selectedRows.length} चुने हुए` : null,
    ].filter(Boolean).join('  •  ');

    // ── CSV ─────────────────────────────────────────────────────────────────────
    const exportCsv = () => {
        const head = ['#', 'Reg No', 'Application No', 'Name', 'Father/Husband', 'Gotra', 'Phone', 'Gender', 'Village', 'District', 'State',
            'Guardian', 'Agent', 'Created by', 'Join date', 'Age group', 'Kist', 'Join fees', 'Open dues', 'Dues amount', 'Status', 'Aadhaar'];
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = exportRows.map((m, i) => [i + 1, m.registrationNumber, m.applicationNumber, m.displayName, m.fatherName, m.gotra, m.phone, m.gender,
            m.village, m._district, m._state, [m.guardian, m.guardianRelation].filter(Boolean).join(' '), m.agentName || 'Admin', m.addedByName,
            m.dateJoin, m.ageGroupRange, m.payAmount, m.joinFeesDone ? 'Paid' : 'Pending', m.openDues, m.openAmount, STATUS_LABEL[m._bucket], m.aadhaarNo].map(esc).join(','));
        const blob = new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `members-${(selectedProgram?.name || 'list').replace(/\s+/g, '_')}-${dayjs().format('YYYY-MM-DD')}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // ── payment ────────────────────────────────────────────────────────────────
    const handleShowPaymentDetails = async (data) => {
        setSelectedMember(data);
        setLoadingReport(true);
        setIsPaymentDetailsOpen(true);
        try {
            const res = await fetchSingleMemberMarriageReport({
                userId: user.uid, programId: selectedProgram.id, memberId: data.id
            });
            setPaymentReport(res);
        } catch (e) {
            console.error(e);
            message.error('Failed to load payment details');
        } finally {
            setLoadingReport(false);
        }
    };


  const downloadMultipleCertificates = async (membersArray, selectedProgram) => {
        if (!membersArray || membersArray.length === 0) {
            message.warning('No members selected for certificate download');
            return;
        }

        setIsCertDownloading(true);
        const loadingMessage = message.loading('Generating certificates, please wait...', 0);

        const membersData = membersArray.map(member => ({
            ...member,
            agentPhone: agentsList?.find(a => a.id === member.agentId)?.phone || 'N/A'
        }));

        try {
            const response = await fetch('/api/certificate-send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    memberData: membersData,
                    selectedProgram: selectedProgram
                }),
            });

            const data = await response.json();
            
            const binaryString = atob(data.base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            // Open in new tab instead of downloading
            window.open(url, '_blank');
            
            // Clean up after a delay
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 100);
            
            message.success('Certificate generated successfully!');
            
        } catch (error) {
            console.error('Error:', error);
            message.error('Failed to generate certificates. Please try again.');
        } finally {
            loadingMessage();
            setIsCertDownloading(false);
        }
    };
    // ── Delete member from row dropdown ──────────────────────────────────────────
    const handleDeleteMember = useCallback((member) => {
        modal.confirm({
            title: `Delete Member: ${member.displayName}?`,
            content: (
                <div>
                    <p>This will permanently delete:</p>
                    <ul>
                        <li>Member login account (disabled)</li>
                        <li>Unpaid dues of this member</li>
                        <li>Member is hidden from this program (paid records are kept)</li>
                    </ul>
                    <p style={{ color: 'red', fontWeight: 'bold' }}>This action cannot be undone!</p>
                </div>
            ),
            okText: 'Yes, Delete',
            okType: 'danger',
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    const data = await api.del(`/members/${member.id}`);
                    if (data.success) {
                        message.success('Member deleted successfully');
                        dispatch(setgetMemberDataChange(true));
                    } else {
                        message.error(data.error || 'Delete failed');
                    }
                } catch (err) {
                    message.error(err.message);
                }
            },
        });
    }, [user, selectedProgram, dispatch]);

    // ── Delete member from details drawer ──────────────────────────────────────────
    const showDeleteConfirm = useCallback((member) => {
        modal.confirm({
            title: `Delete Member: ${member.displayName}?`,
            content: (
                <div>
                    <p>This will permanently delete:</p>
                    <ul>
                        <li>✔ Member login account (disabled)</li>
                        <li>✔ Unpaid dues of this member</li>
                        <li>✔ Member is hidden from this program (paid records are kept)</li>
                    </ul>
                    <p style={{ color: 'red', fontWeight: 'bold' }}>This action cannot be undone!</p>
                </div>
            ),
            okText: 'Yes, Delete',
            okType: 'danger',
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    const data = await api.del(`/members/${member.id}`);
                    if (data.success) {
                        message.success('Member deleted successfully');
                        setIsDetailsView(false);
                        setSelectedMember(null);
                        dispatch(setgetMemberDataChange(true));
                    } else {
                        message.error(data.error || 'Delete failed');
                    }
                } catch (err) {
                    message.error(err.message);
                }
            },
        });
    }, [user, selectedProgram, dispatch]);


    // ── grid columns ───────────────────────────────────────────────────────────
    const hidden = (k) => !visibleCols.includes(k);
    const StatusPill = ({ b }) => {
        const t = TABS.find((x) => x.key === b);
        return <span className="mm-pill" style={{ color: t?.color, background: (t?.color || '#888') + '18' }}><span className="mm-dot" style={{ background: t?.color }} />{STATUS_LABEL[b]}</span>;
    };

    const rowActions = (data) => {
        const isDeleted = data.delete_flag === true;
        const isBlocked = data._bucket === 'blocked';
        const isClosed  = data._bucket === 'closed';
        const isRequest = data._bucket === 'pending' || data._bucket === 'rejected';
        const items = [
            !(isDeleted || isBlocked || isClosed || isRequest) && can('closings', 'add') && { key: 'close', icon: <PlusCircleOutlined />, label: 'Close form (closing)', onClick: () => { setSelectedMember(data); setIsOpenClosingForm(true); } },
            !isDeleted && { key: 'cert', icon: <GrCertificate />, label: 'Certificate', onClick: () => { setSelectedMember(data); setIsCertModalOpen(true); } },
            !(isDeleted || isRequest) && { key: 'pay', icon: <MdOutlinePendingActions />, label: 'Payment details', onClick: () => handleShowPaymentDetails(data) },
            !(isDeleted || isRequest) && can('reports') && { key: 'history', icon: <FaFile />, label: 'Payment history report (late / time par)', onClick: () => { window.location.href = `/reports?member=${data.id}`; } },
            !isDeleted && { key: 'reg', icon: <FaFile />, label: 'Registration form', onClick: () => { setSelectedMember(data); setIsOpenRegModal(true); } },
            !isDeleted && can('members', 'delete') && { type: 'divider' },
            !isDeleted && can('members', 'delete') && { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Delete', onClick: () => handleDeleteMember(data) },
        ].filter(Boolean);
        return (
            <div className="flex items-center gap-1.5 h-full">
                <Tooltip title="View details">
                    <Button type="primary" icon={<EyeOutlined />} size="small"
                        onClick={() => { setSelectedMember(data); setIsDetailsView(true); }} />
                </Tooltip>
                {can('members', 'edit') && <Tooltip title="Edit">
                    <Button icon={<EditOutlined />} size="small" disabled={isDeleted || isBlocked || isClosed}
                        onClick={() => { setSelectedMember(data); setIsEditmemberOpen(true); }} />
                </Tooltip>}
                <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
                    <Button icon={<BsThreeDots />} size="small" disabled={isDeleted} />
                </Dropdown>
            </div>
        );
    };

    const COL_DEFS = useMemo(() => [
        {
            field: 'displayName', headerName: 'Member', pinned: 'left', minWidth: 230, flex: 1.6,
            cellRenderer: ({ data }) => (
                <div className="flex items-center gap-2.5 h-full min-w-0">
                    <Avatar src={data.photoURL || undefined} size={32}>{(data.displayName || '?').charAt(0)}</Avatar>
                    <div className="flex flex-col min-w-0 leading-tight">
                        <span className="font-semibold text-[13px] text-gray-900 truncate">{data.displayName}</span>
                        <span className="text-[11px] text-gray-400 truncate">
                            {data.registrationNumber || '—'}{data.village ? ` · ${data.village}` : ''}
                        </span>
                    </div>
                </div>
            ),
        },
        { field: 'registrationNumber', headerName: 'Reg. No.', minWidth: 110, hide: hidden('registrationNumber'), cellClass: 'font-semibold' },
        { field: 'applicationNumber', headerName: 'App. No.', minWidth: 100, hide: hidden('applicationNumber'),
          comparator: (a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) },
        { field: 'fatherName', headerName: 'Father / Husband', minWidth: 150, hide: hidden('fatherName') },
        { field: 'gotra', headerName: 'Gotra', minWidth: 100, hide: hidden('gotra') },
        { field: 'phone', headerName: 'Phone', minWidth: 120, hide: hidden('phone') },
        {
            field: 'gender', headerName: 'Gender', minWidth: 95, hide: hidden('gender'),
            cellRenderer: ({ value }) => value ? <Tag bordered={false} color={value === 'male' ? 'blue' : value === 'female' ? 'magenta' : 'default'} className="capitalize !m-0">{value}</Tag> : '—',
        },
        { field: 'village', headerName: 'Village', minWidth: 110, hide: hidden('village') },
        { field: '_district', headerName: 'District', minWidth: 110, hide: hidden('_district') },
        { field: '_state', headerName: 'State', minWidth: 100, hide: hidden('_state') },
        { colId: 'guardian', headerName: 'Guardian', minWidth: 140, hide: hidden('guardian'),
          valueGetter: ({ data }) => [data.guardian, data.guardianRelation].filter(Boolean).join(' ') },
        { field: 'agentName', headerName: 'Agent', minWidth: 130, hide: hidden('agentName'),
          valueGetter: ({ data }) => data.agentName || 'Admin',
          cellRenderer: ({ value }) => <span className={value === 'Admin' ? 'text-gray-400' : ''}>{value}</span> },
        { field: 'addedByName', headerName: 'Created by', minWidth: 120, hide: hidden('addedByName') },
        {
            field: 'dateJoin', headerName: 'Join date', minWidth: 110, hide: hidden('dateJoin'),
            comparator: (a, b, na, nb) => (na.data._join?.valueOf() || 0) - (nb.data._join?.valueOf() || 0),
        },
        { field: 'ageGroupRange', headerName: 'Age group', minWidth: 100, hide: hidden('ageGroupRange') },
        { field: 'payAmount', headerName: 'Kist', minWidth: 80, hide: hidden('payAmount'), type: 'rightAligned',
          valueFormatter: ({ value }) => value ? `₹${value}` : '—' },
        {
            field: 'joinFeesDone', headerName: 'Join fees', minWidth: 105, hide: hidden('joinFeesDone'),
            cellRenderer: ({ value }) => value
                ? <Tag bordered={false} color="success" className="!m-0">Paid</Tag>
                : <Tag bordered={false} color="error" className="!m-0">Pending</Tag>,
        },
        {
            field: 'openAmount', headerName: 'Dues', minWidth: 110, hide: hidden('openAmount'), type: 'rightAligned',
            cellRenderer: ({ data }) => data.openAmount > 0
                ? <span className="text-red-600 font-semibold" title={`${data.openDues} pending closings`}>{inr(data.openAmount)} <span className="text-[11px] text-gray-400 font-normal">({data.openDues})</span></span>
                : <span className="text-gray-300">—</span>,
        },
        { field: '_bucket', headerName: 'Status', minWidth: 110, hide: hidden('_bucket'), cellRenderer: ({ value }) => <StatusPill b={value} /> },
        { field: 'aadhaarNo', headerName: 'Aadhaar', minWidth: 130, hide: hidden('aadhaarNo') },
        { colId: 'actions', headerName: '', pinned: 'right', width: 118, minWidth: 118, maxWidth: 118, sortable: false, filter: false, resizable: false,
          cellRenderer: ({ data }) => rowActions(data) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [visibleCols, selectedProgram?.id, user]);

    const defaultColDef = useMemo(() => ({ sortable: true, filter: false, resizable: true, flex: 1, suppressHeaderMenuButton: true }), []);
    const rowSelection = useMemo(() => ({ mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false }), []);
    const getRowClass = useCallback(({ data }) => data?._bucket === 'blocked' ? 'mm-row-blocked' : data?._bucket === 'closed' ? 'mm-row-closed' : '', []);
    const onSelectionChanged = useCallback((e) => setSelectedIds(e.api.getSelectedRows().map((r) => r.id)), []);
    useEffect(() => { setSelectedIds([]); gridRef.current?.api?.deselectAll(); }, [tab, f]);

    // ── column chooser ────────────────────────────────────────────────────────
    const columnChooser = (
        <div className="w-64">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Show columns</span>
                <span className="space-x-2 text-xs">
                    <button className="text-blue-600" onClick={() => setVisibleCols(COLUMN_KEYS.map(([k]) => k))}>All</button>
                    <button className="text-blue-600" onClick={() => setVisibleCols(DEFAULT_VISIBLE)}>Default</button>
                </span>
            </div>
            <Checkbox.Group value={visibleCols} onChange={setVisibleCols} className="w-full">
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 w-full max-h-72 overflow-y-auto">
                    {COLUMN_KEYS.map(([k, label]) => <Checkbox key={k} value={k}>{label}</Checkbox>)}
                </div>
            </Checkbox.Group>
        </div>
    );

    const moreFilters = (
        <div className="w-72 space-y-3">
            {[
                ['ageGroup', 'Age group', options.ageGroup],
                ['state', 'State', options.state],
                ['district', 'District', options.district],
                ['village', 'Village', options.village],
            ].map(([k, label, opts]) => (
                <div key={k}>
                    <div className="text-xs font-semibold text-gray-500 mb-1">{label}</div>
                    <Select allowClear showSearch className="w-full" placeholder={`Any ${label.toLowerCase()}`} value={f[k]}
                        onChange={(v) => { set(k, v); if (k === 'state') set('district', undefined); }}
                        options={opts.map((o) => ({ value: o, label: o }))} />
                </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">Added by</div>
                    <Select className="w-full" value={f.addedBy} onChange={(v) => set('addedBy', v)}
                        options={[{ value: 'all', label: 'Anyone' }, { value: 'admin', label: 'Admin' }, { value: 'agent', label: 'Agent' }]} />
                </div>
                <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">Kist (₹)</div>
                    <Select allowClear className="w-full" placeholder="Any" value={f.kist} onChange={(v) => set('kist', v)}
                        options={options.kist.map((o) => ({ value: o, label: `₹${o}` }))} />
                </div>
            </div>
        </div>
    );

    const exportMenu = {
        items: [
            { key: 'pdf', icon: <FiFileText />, label: 'Download PDF (choose columns)' },
            { key: 'csv', icon: <FiDownload />, label: 'Download CSV / Excel' },
            { key: 'print', icon: <FiPrinter />, label: 'Print view' },
        ],
        onClick: ({ key }) => key === 'pdf' ? setIsPdfOpen(true) : key === 'csv' ? exportCsv() : setIsExportOpen(true),
    };

    // ── render ─────────────────────────────────────────────────────────────────
    return (
        <div className="mm">
            <style>{MM_CSS}</style>

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="mm-title">Members</h1>
                    <p className="mm-sub">{selectedProgram?.name || '—'} · {isLoading && !allMembersData.length ? 'loading members…' : `${counts.all.toLocaleString('en-IN')} members on books`}{counts.pending ? ` · ${counts.pending} requests waiting` : ''}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button icon={<FiCreditCard />} onClick={() => setJoinFeesMemberListOpen(true)}>Join fees list</Button>
                    <Button icon={<FiAward />} loading={isCertDownloading} disabled={!exportRows.length}
                        onClick={() => downloadMultipleCertificates(exportRows, selectedProgram)}>
                        Certificates{selectedRows.length ? ` (${selectedRows.length})` : ''}
                    </Button>
                    <Dropdown menu={exportMenu} trigger={['click']} disabled={!exportRows.length}>
                        <Button type="primary" icon={<FiDownload />}>Export {selectedRows.length ? `${selectedRows.length} selected` : ''} <FiChevronDown /></Button>
                    </Dropdown>
                </div>
            </div>

            {/* ── Status tabs ──────────────────────────────────────────────── */}
            <div className="mm-tabs" role="tablist">
                {TABS.map((t) => (
                    <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                        className={`mm-tab ${tab === t.key ? 'mm-tab-on' : ''}`}>
                        {t.key !== 'all' && <span className="mm-dot" style={{ background: t.color }} />}
                        {t.label}
                        <span className="mm-count">{isLoading && !allMembersData.length ? '…' : (counts[t.key] || 0).toLocaleString('en-IN')}</span>
                    </button>
                ))}
            </div>

            {/* ── Filters ──────────────────────────────────────────────────── */}
            <div className="mm-card p-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                    <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Search name, reg no, father, phone, village, Aadhaar…"
                        value={f.q} onChange={(e) => set('q', e.target.value)} className="mm-search" />
                    <Select allowClear showSearch optionFilterProp="label" placeholder="All agents" value={f.agent} onChange={(v) => set('agent', v)}
                        style={{ minWidth: 170 }}
                        options={[{ value: '__none', label: 'No agent (admin)' }, ...(agentsList || []).map((a) => ({ value: a.id, label: a.displayName || a.id }))]} />
                    <Select value={f.gender} onChange={(v) => set('gender', v)} style={{ width: 125 }}
                        options={[{ value: 'all', label: 'All genders' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
                    <Select value={f.fees} onChange={(v) => set('fees', v)} style={{ width: 160 }}
                        options={[{ value: 'all', label: 'Join fees: all' }, { value: 'paid', label: 'Join fees paid' }, { value: 'pending', label: 'Join fees pending' }]} />
                    <Select value={f.dues} onChange={(v) => set('dues', v)} style={{ width: 150 }}
                        options={[{ value: 'all', label: 'Dues: all' }, { value: 'has', label: 'Has pending dues' }, { value: 'none', label: 'No dues' }]} />
                    <RangePicker value={f.joinRange} onChange={(v) => set('joinRange', v)} format="DD-MM-YYYY" presets={DATE_PRESETS}
                        placeholder={['Joined from', 'Joined to']} allowClear style={{ width: 250 }} />
                    <Popover trigger="click" placement="bottomLeft" content={moreFilters} title="More filters">
                        <Badge count={moreCount} size="small" color="#2a78d6">
                            <Button icon={<FiSliders />}>More filters</Button>
                        </Badge>
                    </Popover>
                    <div className="flex-1" />
                    <Popover trigger="click" placement="bottomRight" content={columnChooser}>
                        <Button icon={<FiColumns />}>Columns</Button>
                    </Popover>
                    <Tooltip title="Reload"><Button icon={<FiRefreshCw className={isLoading ? 'animate-spin' : ''} />} onClick={onGridReady} /></Tooltip>
                </div>
                {chips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {chips.map((c) => <Tag key={c.k} closable onClose={(e) => { e.preventDefault(); clearChip(c.k); }} className="mm-chip">{c.label}</Tag>)}
                        <button className="text-xs font-semibold text-blue-600 ml-1" onClick={() => setF(EMPTY_FILTERS)}>Clear all</button>
                    </div>
                )}
            </div>

            {/* ── Summary / selection bar ──────────────────────────────────── */}
            {selectedRows.length > 0 ? (
                <div className="mm-selbar">
                    <b>{selectedRows.length} selected</b>
                    <span className="opacity-70">Export and certificates now use only the selected members.</span>
                    <div className="flex-1" />
                    <Button size="small" icon={<FiFileText />} onClick={() => setIsPdfOpen(true)}>PDF</Button>
                    <Button size="small" icon={<FiDownload />} onClick={exportCsv}>CSV</Button>
                    <Button size="small" icon={<FiAward />} loading={isCertDownloading} onClick={() => downloadMultipleCertificates(selectedRows, selectedProgram)}>Certificates</Button>
                    <Button size="small" type="text" icon={<FiX />} onClick={() => gridRef.current?.api?.deselectAll()}>Clear</Button>
                </div>
            ) : (
                <div className="mm-summary">
                    <span><FiUsers className="inline -mt-0.5 mr-1" /><b>{filteredMembersData.length.toLocaleString('en-IN')}</b> shown</span>
                    <span>{summary.male} male · {summary.female} female</span>
                    <span className={summary.feesPending ? 'text-red-600' : ''}>{summary.feesPending} join fees pending</span>
                    <span className={summary.withDues ? 'text-red-600' : ''}><FiAlertCircle className="inline -mt-0.5 mr-1" />{summary.withDues} with dues · {inr(summary.dues)}</span>
                </div>
            )}

            {/* ── Grid ─────────────────────────────────────────────────────── */}
            <div className="mm-card overflow-hidden">
                <div className="mm-grid" style={{ height: 'calc(100vh - 330px)', minHeight: 420, width: '100%' }}>
                    <AgGridReact
                        ref={gridRef}
                        theme={GRID_THEME}
                        rowData={filteredMembersData}
                        columnDefs={COL_DEFS}
                        defaultColDef={defaultColDef}
                        getRowId={({ data }) => data.id}
                        rowSelection={rowSelection}
                        selectionColumnDef={{ pinned: 'left', width: 44, maxWidth: 44 }}
                        onSelectionChanged={onSelectionChanged}
                        getRowClass={getRowClass}
                        rowHeight={52}
                        headerHeight={42}
                        pagination
                        paginationPageSize={50}
                        paginationPageSizeSelector={[25, 50, 100, 200, 500]}
                        loading={isLoading}
                        overlayNoRowsTemplate={'<span style="color:#898781">No members match these filters</span>'}
                        onRowDoubleClicked={({ data }) => { setSelectedMember(data); setIsDetailsView(true); }}
                    />
                </div>
            </div>

            {/* ── Exports ──────────────────────────────────────────────────── */}
            {isPdfOpen && (
                <MemberPdfExportDrawer
                    open={isPdfOpen} onClose={() => setIsPdfOpen(false)}
                    members={exportRows} filtersText={filtersTextHi} programName={selectedProgram?.name}
                    TrustData={TrustData}
                    defaultTitle={tab === 'all' ? 'सदस्य सूची' : `${STATUS_HI[tab]} सदस्य सूची`}
                />
            )}
            <MemberExportPDF
                open={isExportOpen}
                onClose={() => setIsExportOpen(false)}
                members={exportRows}
                filterSummary={filterSummary}
                programName={selectedProgram?.name || ''}
            />
            {JoinFeesMemberListOpen && (
                <JoinFeesMemberList onSuccess={onGridReady} selectedProgram={selectedProgram}
                    agentData={f.agent && f.agent !== '__none' ? agentsList?.find(a => a.id === f.agent) : undefined}
                    membersData={filteredMembersData} open={JoinFeesMemberListOpen} onClose={() => setJoinFeesMemberListOpen(false)} />
            )}

            {/* ── member modals ─────────────────────────────────────────────── */}
            <MemberDetailsView
                isModalVisible={isDetailsView}
                handleCloseModal={() => setIsDetailsView(false)}
                showDeleteConfirm={showDeleteConfirm}
                selectedMember={selectedMember}
            />
            <EditMember
                open={isEditmemberOpen}
                setOpen={setIsEditmemberOpen}
                memberData={selectedMember}
                programId={selectedProgram?.id}
                onSuccess={onGridReady}
            />
            <MemberCertificateCom
                open={isCertModalOpen}
                onClose={() => setIsCertModalOpen(false)}
                memberData={selectedMember}
            />
            <MemberRegForm
                open={isOpenRegModal}
                onClose={() => setIsOpenRegModal(false)}
                memberData={selectedMember}
            />
            {isOpenClosingForm && (
                <ClosingForm
                    open={isOpenClosingForm}
                    onClose={() => setIsOpenClosingForm(false)}
                    memberData={selectedMember}
                    user={user}
                    selectedProgram={selectedProgram}
                    onSuccess={onGridReady}
                />
            )}
            <MemberPaymentDetails
                visible={isPaymentDetailsOpen}
                onClose={() => { setIsPaymentDetailsOpen(false); setPaymentReport(null); }}
                memberData={selectedMember}
                paymentReport={paymentReport}
                loading={loadingReport}
                onChanged={async () => {
                    // silent refresh after a correction (no drawer skeleton)
                    if (!selectedMember) return;
                    try {
                        const res = await fetchSingleMemberMarriageReport({
                            userId: user.uid, programId: selectedProgram.id, memberId: selectedMember.id
                        });
                        setPaymentReport(res);
                    } catch (e) { console.error(e); }
                }}
            />
        </div>
    );
};

const MM_CSS = `
.mm { display: flex; flex-direction: column; gap: 12px; }
.mm-title { font-size: 22px; font-weight: 800; color: #0b0b0b; letter-spacing: -0.02em; }
.mm-sub { font-size: 13px; color: #52514e; margin-top: 2px; }
.mm-card { background: #fff; border: 1px solid rgba(11,11,11,0.08); border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
.mm-search { width: 300px; max-width: 100%; }
@media (max-width: 640px) { .mm-search { width: 100%; } }
.mm-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.mm-tab { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: #52514e; background: #fff; border: 1px solid rgba(11,11,11,0.10); transition: all .15s; }
.mm-tab:hover { border-color: rgba(42,120,214,0.45); color: #0b0b0b; }
.mm-tab-on { background: #0b0b0b; color: #fff; border-color: #0b0b0b; }
.mm-tab-on:hover { color: #fff; }
.mm-count { font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: rgba(11,11,11,0.06); font-variant-numeric: tabular-nums; }
.mm-tab-on .mm-count { background: rgba(255,255,255,0.18); }
.mm-dot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; flex-shrink: 0; }
.mm-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; line-height: 18px; }
.mm-chip { border-radius: 999px !important; padding: 2px 10px !important; background: #eef4fd !important; border-color: #cfe0f7 !important; color: #1c5cab !important; }
.mm-summary { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12.5px; color: #52514e; padding: 0 4px; }
.mm-selbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-size: 13px; padding: 8px 12px; border-radius: 12px; background: #eef4fd; border: 1px solid #cfe0f7; color: #1c5cab; }
.mm-grid .ag-cell { display: flex; align-items: center; }
.mm-grid .ag-right-aligned-cell { justify-content: flex-end; }
.mm-row-blocked { background: #fff6f6 !important; }
.mm-row-closed { background: #f8f6ff !important; }
`;

export default MemberList;
