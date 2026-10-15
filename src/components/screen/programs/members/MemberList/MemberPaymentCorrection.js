'use client'
/**
 * MemberPaymentCorrection
 *
 * One member → every closing of the program, side by side:
 *   what the member SHOULD pay for (by rule)  vs  what is actually in
 *   payment_pending.
 *
 * Rule (same as the onMemberMarriageUpdate cloud function):
 *   a member pays for a closing when
 *     - member's join date is on/before the closing date, and
 *     - the member was not already closed on/before that closing date, and
 *     - it is not the member's own closing.
 *
 * The rule only SUGGESTS — the admin decides:
 *   Missing  → "Add" creates the entry (doc id `closingId_memberId`)
 *   Extra    → "Remove" deletes a PENDING entry
 *   Paid entries are never deleted here (revert the payment first).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Drawer, Table, Tag, Typography, Button, Space, Alert, Segmented,
    Popconfirm, Row, Col, Card, Statistic, App, Tooltip, Empty,
} from 'antd';
import {
    CheckCircleOutlined, ExclamationCircleOutlined, PlusOutlined,
    DeleteOutlined, ReloadOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '@/lib/client/api';
import { toLegacyMember, toLegacyDue } from '@/lib/client/legacy';
import { fetchAllMembers } from '@/lib/services/firebaseService';
import { useAuth } from '@/lib/AuthProvider';
import { useSelector } from 'react-redux';
import { parseAnyDate, formatShortDate } from '@/lib/dateUtils';

const { Text } = Typography;

const STATE_META = {
    missing:   { color: 'red',     label: 'Missing' },
    extra:     { color: 'orange',  label: 'Extra' },
    duplicate: { color: 'volcano', label: 'Duplicate' },
    ok:        { color: 'green',   label: 'OK' },
    none:      { color: 'default', label: 'Not applicable' },
};

function MemberPaymentCorrection({ open, onClose, memberData, onChanged }) {
    const { user } = useAuth();
    const { message } = App.useApp();
    const selectedProgram = useSelector((s) => s.data.selectedProgram);

    const memberId = memberData?.id || memberData?.memberId;
    const programId = memberData?.programId || selectedProgram?.id;
    const base = user?.uid && programId ? `users/${user.uid}/programs/${programId}` : null;

    const [loading, setLoading] = useState(false);
    const [working, setWorking] = useState(false);
    const [member, setMember] = useState(null);
    const [closings, setClosings] = useState([]);   // closed members
    const [entries, setEntries] = useState([]);     // this member's payment_pending docs
    const [view, setView] = useState('problems');
    const [selectedKeys, setSelectedKeys] = useState([]);

    const load = useCallback(async () => {
        if (!open || !base || !memberId) return;
        setLoading(true);
        try {
            const [m, closed, dues] = await Promise.all([
                api.get(`/members/${memberId}`),
                fetchAllMembers(programId, { closed: 'true' }),
                api.get(`/members/${memberId}/dues`),
            ]);
            setMember(m.member ? toLegacyMember(m.member) : null);
            setClosings(closed.filter((c) => c.delete_flag !== true));
            setEntries(dues.dues.map((d) => ({ docId: d.id, ...toLegacyDue(d, memberId) })));
            setSelectedKeys([]);
        } catch (e) {
            console.error('Payment correction load failed', e);
            message.error('Failed to load closing data');
        } finally {
            setLoading(false);
        }
    }, [open, base, memberId, message]);

    useEffect(() => { load(); }, [load]);

    // ── Compare expected vs actual ───────────────────────────────────────────
    const { rows, counts, joinDate, ownClosingDate } = useMemo(() => {
        const empty = { rows: [], counts: { expected: 0, actual: 0, missing: 0, extra: 0 }, joinDate: null, ownClosingDate: null };
        if (!member) return empty;

        const joinDate = parseAnyDate(member.dateJoin);
        const ownClosingDate = member.marriage_flag === true
            ? parseAnyDate(member.marriage_date || member.closing_date)
            : null;

        const byClosing = new Map();
        entries.forEach((e) => {
            const key = e.closingMemberId || '__none__';
            if (!byClosing.has(key)) byClosing.set(key, []);
            byClosing.get(key).push(e);
        });

        const rows = [];
        const closingIds = new Set();

        closings.forEach((c) => {
            closingIds.add(c.id);
            const list = byClosing.get(c.id) || [];
            const closingDate = parseAnyDate(c.marriage_date || c.closing_date);
            const isSelf = c.id === memberId;

            let expected = true;
            let reason = '';
            if (isSelf) {
                expected = false; reason = "Member's own closing";
            } else if (!closingDate) {
                expected = false; reason = 'Closing date missing / invalid';
            } else if (!joinDate) {
                expected = false; reason = 'Member join date missing / invalid';
            } else if (joinDate > closingDate) {
                expected = false; reason = `Joined (${formatShortDate(joinDate)}) after this closing`;
            } else if (ownClosingDate && ownClosingDate <= closingDate) {
                expected = false; reason = `Member already closed on ${formatShortDate(ownClosingDate)}`;
            }

            // Keep the best entry (paid first, then the deterministic id);
            // the rest are duplicates.
            const sorted = [...list].sort((a, b) =>
                (b.status === 'paid') - (a.status === 'paid') ||
                (b.docId === `${c.id}_${memberId}`) - (a.docId === `${c.id}_${memberId}`)
            );
            const [main, ...dups] = sorted;

            const common = {
                closingId: c.id,
                closing: c,
                closingName: c.displayName || '-',
                closingFather: c.fatherName || '',
                closingRegNo: c.registrationNumber || '-',
                closingVillage: c.village || '',
                closingDate,
                closingDateText: formatShortDate(c.marriage_date || c.closing_date, '-'),
                reason,
            };

            if (main) {
                rows.push({ ...common, key: main.docId, entry: main, state: expected ? 'ok' : 'extra' });
            } else {
                rows.push({ ...common, key: `new_${c.id}`, entry: null, state: expected ? 'missing' : 'none' });
            }
            dups.forEach((d) => rows.push({
                ...common, key: d.docId, entry: d, state: 'duplicate',
                reason: 'More than one entry for this closing',
            }));
        });

        // Entries pointing at a closing that does not exist / is not closed
        byClosing.forEach((list, cid) => {
            if (closingIds.has(cid)) return;
            list.forEach((e) => rows.push({
                key: e.docId, entry: e, state: 'extra',
                closingId: cid === '__none__' ? '' : cid,
                closing: null,
                closingName: e.paymentFor || e.closingMemberName || '-',
                closingFather: e.closingFatherName || '',
                closingRegNo: e.closingRegNo || '-',
                closingVillage: e.village || '',
                closingDate: parseAnyDate(e.closing_date),
                closingDateText: formatShortDate(e.closing_date, '-'),
                reason: cid === '__none__'
                    ? 'Entry is not linked to any closing'
                    : 'Closing member not found or not closed any more',
            }));
        });

        rows.sort((a, b) => (a.closingDate?.getTime() ?? Infinity) - (b.closingDate?.getTime() ?? Infinity));

        const counts = {
            expected: rows.filter((r) => r.state === 'ok' || r.state === 'missing').length,
            actual: entries.length,
            missing: rows.filter((r) => r.state === 'missing').length,
            extra: rows.filter((r) => r.state === 'extra' || r.state === 'duplicate').length,
        };
        return { rows, counts, joinDate, ownClosingDate };
    }, [member, closings, entries, memberId]);

    const visibleRows = useMemo(() => {
        if (view === 'all') return rows;
        if (view === 'entries') return rows.filter((r) => r.entry);
        return rows.filter((r) => ['missing', 'extra', 'duplicate'].includes(r.state));
    }, [rows, view]);

    // ── Actions ──────────────────────────────────────────────────────────────
    const afterChange = async () => {
        await load();
        onChanged?.();
    };

    const addEntries = async (targetRows) => {
        const list = targetRows.filter((r) => !r.entry && r.closing);
        if (!list.length) return;
        setWorking(true);
        try {
            const r = await api.post(`/members/${memberId}/dues/check`, { addClosingIds: list.map((x) => x.closingId) });
            message.success(`${r.added} payment entr${r.added === 1 ? 'y' : 'ies'} added`);
            await afterChange();
        } catch (e) {
            console.error(e);
            message.error('Failed to add: ' + e.message);
        } finally {
            setWorking(false);
        }
    };

    const removeEntry = async (row) => {
        if (!row.entry || row.entry.status === 'paid' || row.entry.status === 'partial') return;
        setWorking(true);
        try {
            await api.post(`/members/${memberId}/dues/check`, { removeDueIds: [row.entry.docId] });
            message.success('Entry removed');
            await afterChange();
        } catch (e) {
            console.error(e);
            message.error('Failed to remove: ' + e.message);
        } finally {
            setWorking(false);
        }
    };

    const missingRows = rows.filter((r) => r.state === 'missing');
    const selectedRows = visibleRows.filter((r) => selectedKeys.includes(r.key));

    const columns = [
        { title: 'Closing Date', dataIndex: 'closingDateText', width: 105 },
        {
            title: 'Closing Member',
            render: (_, r) => (
                <div>
                    <div style={{ fontWeight: 600 }}>
                        {r.closingName}{r.closingFather ? ` / ${r.closingFather}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                        Reg: {r.closingRegNo}{r.closingVillage ? ` · ${r.closingVillage}` : ''}
                    </div>
                </div>
            ),
        },
        {
            title: 'Entry',
            width: 110,
            render: (_, r) => !r.entry
                ? <Text type="secondary">No entry</Text>
                : (
                    <div>
                        <Tag color={r.entry.status === 'paid' ? 'green' : r.entry.status === 'partial' ? 'blue' : 'gold'}>
                            {r.entry.status || 'pending'}
                        </Tag>
                        <div style={{ fontSize: 12 }}>₹{Number(r.entry.payAmount) || 0}</div>
                    </div>
                ),
        },
        {
            title: 'Check',
            width: 220,
            render: (_, r) => (
                <div>
                    <Tag color={STATE_META[r.state].color}>{STATE_META[r.state].label}</Tag>
                    {r.reason && r.state !== 'ok' && (
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{r.reason}</div>
                    )}
                </div>
            ),
        },
        {
            title: 'Action',
            width: 110,
            align: 'center',
            render: (_, r) => {
                if (!r.entry) {
                    if (!r.closing || r.closingId === memberId) return null;
                    return (
                        <Popconfirm
                            title={r.state === 'missing' ? 'Add this payment entry?' : 'Rule says not applicable. Add anyway?'}
                            onConfirm={() => addEntries([r])}
                            okText="Add"
                        >
                            <Button size="small" type={r.state === 'missing' ? 'primary' : 'default'} icon={<PlusOutlined />}>
                                Add
                            </Button>
                        </Popconfirm>
                    );
                }
                const locked = r.entry.status === 'paid' || r.entry.status === 'partial';
                if (locked) {
                    return r.state === 'ok' ? null : (
                        <Tooltip title="This entry has a payment. Revert the payment from the Payments page first, then remove it.">
                            <Tag icon={<WarningOutlined />} color="default">Has payment</Tag>
                        </Tooltip>
                    );
                }
                return (
                    <Popconfirm
                        title="Remove this pending entry?"
                        description="It is deleted permanently."
                        onConfirm={() => removeEntry(r)}
                        okText="Remove"
                        okButtonProps={{ danger: true }}
                    >
                        <Button size="small" danger={r.state !== 'ok'} icon={<DeleteOutlined />}>
                            Remove
                        </Button>
                    </Popconfirm>
                );
            },
        },
    ];

    const notEligibleNow = member && (member.status !== 'accepted' || member.active_flag === false);

    return (
        <Drawer
            title={
                <div>
                    <div style={{ fontWeight: 700 }}>
                        Correct Payments: {member?.displayName || memberData?.displayName || ''}
                    </div>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                        Reg: {member?.registrationNumber || '-'} · Joined: {formatShortDate(member?.dateJoin, '-')}
                        {ownClosingDate ? ` · Own closing: ${formatShortDate(ownClosingDate)}` : ''}
                    </Text>
                </div>
            }
            placement="right"
            width={900}
            open={open}
            onClose={onClose}
            destroyOnHidden
            extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>}
        >
            <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col xs={12} lg={6}><Card size="small"><Statistic title="Should pay (by rule)" value={counts.expected} /></Card></Col>
                <Col xs={12} lg={6}><Card size="small"><Statistic title="Entries now" value={counts.actual} /></Card></Col>
                <Col xs={12} lg={6}><Card size="small"><Statistic title="Missing" value={counts.missing} valueStyle={{ color: counts.missing ? '#cf1322' : '#3f8600' }} /></Card></Col>
                <Col xs={12} lg={6}><Card size="small"><Statistic title="Extra / duplicate" value={counts.extra} valueStyle={{ color: counts.extra ? '#d46b08' : '#3f8600' }} /></Card></Col>
            </Row>

            {member && !joinDate && (
                <Alert type="error" showIcon style={{ marginBottom: 12 }}
                    message="Join date is missing or not in DD-MM-YYYY format"
                    description="The rule cannot be checked without a valid join date. Fix it in Edit Member, then refresh." />
            )}
            {notEligibleNow && (
                <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                    message={`Member is currently ${member.active_flag === false ? 'inactive' : member.status}`}
                    description="New closings do not create entries for this member until they are accepted and active." />
            )}
            {member && counts.missing === 0 && counts.extra === 0 && !loading && (
                <Alert type="success" showIcon icon={<CheckCircleOutlined />} style={{ marginBottom: 12 }}
                    message="All entries match the rule — nothing to correct." />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                <Segmented
                    value={view}
                    onChange={(v) => { setView(v); setSelectedKeys([]); }}
                    options={[
                        { value: 'problems', label: `Problems (${counts.missing + counts.extra})` },
                        { value: 'entries', label: `Entries (${counts.actual})` },
                        { value: 'all', label: `All closings (${rows.length})` },
                    ]}
                />
                <Space>
                    {selectedRows.length > 0 && (
                        <Popconfirm
                            title={`Add ${selectedRows.length} selected entr${selectedRows.length === 1 ? 'y' : 'ies'}?`}
                            onConfirm={() => addEntries(selectedRows)}
                            okText="Add"
                        >
                            <Button icon={<PlusOutlined />} loading={working}>Add selected ({selectedRows.length})</Button>
                        </Popconfirm>
                    )}
                    <Popconfirm
                        title={`Add all ${missingRows.length} missing entr${missingRows.length === 1 ? 'y' : 'ies'}?`}
                        onConfirm={() => addEntries(missingRows)}
                        okText="Add all"
                        disabled={missingRows.length === 0}
                    >
                        <Button type="primary" icon={<PlusOutlined />} disabled={missingRows.length === 0} loading={working}>
                            Add all missing ({missingRows.length})
                        </Button>
                    </Popconfirm>
                </Space>
            </div>

            <Table
                size="small"
                rowKey="key"
                loading={loading || working}
                columns={columns}
                dataSource={visibleRows}
                pagination={{ pageSize: 50, hideOnSinglePage: true }}
                rowSelection={{
                    selectedRowKeys: selectedKeys,
                    onChange: setSelectedKeys,
                    getCheckboxProps: (r) => ({ disabled: Boolean(r.entry) || !r.closing || r.closingId === memberId }),
                }}
                locale={{
                    emptyText: (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={view === 'problems' ? 'No problems found' : 'Nothing to show'} />
                    ),
                }}
            />

            <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
                <ExclamationCircleOutlined /> Rule: a member pays for a closing when they joined on or before the closing
                date and were not already closed by then. Paid entries are never removed from here.
            </div>
        </Drawer>
    );
}

export default MemberPaymentCorrection;
