'use client'
import React, { use, useEffect, useMemo, useState } from 'react';
import { 
    Drawer, 
    Table, 
    Tag, 
    Typography, 
    Card, 
    Statistic, 
    Row, 
    Col,
    Tabs,
    Space,
    Badge,
    Button,
    Divider,
    Tooltip,
    Select,
    Empty
} from 'antd';
import { 
    DollarOutlined, 
    CheckCircleOutlined, 
    ClockCircleOutlined,
    CalendarOutlined,
    CreditCardOutlined,
    WalletOutlined,
    DownloadOutlined,
    TeamOutlined,
    FolderOpenOutlined,
    ToolOutlined
} from '@ant-design/icons';
import { fetchClosingGroups } from '@/lib/services/firebaseService';
import { useAuth } from '@/lib/AuthProvider';
import { PDFDownloadLink, PDFViewer } from '@react-pdf/renderer';
import SingleMemberPendingPaymentPdf from './PendingPaymentPdf';
import MemberPaymentCorrection from './MemberPaymentCorrection';
import AdvanceModal, { useAdvance } from '@/components/common/advance/AdvanceModal';
import { useFeature } from '@/lib/AuthProvider';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
const { Title, Text } = Typography;
const { TabPane } = Tabs;

function MemberPaymentDetails({ visible, onClose, memberData, paymentReport, loading = false, onChanged }) {
    const [activeTab, setActiveTab] = useState('1');
    // "Correct Payments" — compare this member's entries with the closing list
    const [correctionOpen, setCorrectionOpen] = useState(false);
    const [advanceOpen, setAdvanceOpen] = useState(false);
    const advanceOn = useFeature()('advancePayment');
    const adv = useAdvance(advanceOn && visible ? memberData?.id : null, visible);
    const TrustData =useSelector(state => state.data.trustData) 
    console.log(paymentReport,'paymentReport')
    const selectedProgram = useSelector((state) => state.data.selectedProgram);
    const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
    // Which receipt is being previewed/downloaded: 'pending' | 'paid'
    const [pdfStatus, setPdfStatus] = useState('pending');

    // Closing group filter — null means "all groups"
    const [closingGroups, setClosingGroups] = useState([]);
    const [groupFilter, setGroupFilter] = useState(null);
    const { user } = useAuth();

    // Group id → name, so payments (which only store the id) can be labelled
    useEffect(() => {
        const load = async () => {
            if (!visible || !user?.uid || !selectedProgram?.id) return;
            try {
                const groups = await fetchClosingGroups(selectedProgram.id);
                setClosingGroups(groups.map(g => ({ id: g.id, name: g.name })));
            } catch (e) {
                console.error('Failed to load closing groups', e);
            }
        };
        load();
    }, [visible, user?.uid, selectedProgram?.id]);

    // Reset the filter each time the drawer opens for a different member
    useEffect(() => { if (visible) setGroupFilter(null); }, [visible, memberData?.memberId]);

    const groupNameById = useMemo(
        () => new Map(closingGroups.map(g => [g.id, g.name])),
        [closingGroups]
    );

    const handleDownloadPDF = (status) => {
        setPdfStatus(status);
        setPdfPreviewOpen(true);
    };

    if (!memberData || !paymentReport) return null;
    const { report, summary } = paymentReport;
    const member = memberData;

    const allMarriages = report.marriages || [];

    // Only groups this member actually has payments in — no empty options
    const availableGroups = Array.from(
        new Set(allMarriages.map(m => m.closingGroupId).filter(Boolean))
    ).map(id => ({
        id,
        name: groupNameById.get(id) || 'Unnamed group',
        count: allMarriages.filter(m => m.closingGroupId === id).length,
    }));

    const ungroupedCount = allMarriages.filter(m => !m.closingGroupId).length;

    const marriages = groupFilter === null
        ? allMarriages
        : groupFilter === '__none__'
            ? allMarriages.filter(m => !m.closingGroupId)
            : allMarriages.filter(m => m.closingGroupId === groupFilter);

    // Counts per bucket — used to disable a receipt option when there is
    // nothing to print (a fully paid member has no pending receipt).
    const pendingCount = marriages.filter(m => m.status === 'pending').length;
    const paidCount    = marriages.filter(m => m.status === 'paid').length;
    const isPaidPdf    = pdfStatus === 'paid';

    const activeGroupName = groupFilter === null
        ? null
        : groupFilter === '__none__'
            ? 'No group'
            : (groupNameById.get(groupFilter) || 'Unnamed group');

    // The PDF receives the already-filtered list so it matches what is on screen
    const filteredReport = {
        ...paymentReport,
        report: { ...report, marriages },
    };

    const filteredTotal = marriages.reduce((s, m) => s + (parseFloat(m.amount) || 0), 0);

    // Format currency
    const formatCurrency = (amount) => {
        return `₹${amount?.toFixed(2) || '0.00'}`;
    };

    // Get status color and icon
    const getStatusInfo = (status) => {
        switch(status) {
            case 'paid':
                return { color: 'success', icon: <CheckCircleOutlined />, text: 'Paid' };
            case 'pending':
                return { color: 'warning', icon: <ClockCircleOutlined />, text: 'Pending' };
            default:
                return { color: 'default', icon: null, text: status };
        }
    };

    // Columns for marriages table
    const marriageColumns = [
        {
            title: 'Closings Date',
            dataIndex: 'marriageDate',
            key: 'marriageDate',
            render: (date) => date || '-',
            width: 120,
        },
        {
            title: 'Beneficiary',
            key: 'beneficiary',
            render: (_, record) => (
                <div>
                    <div className="font-medium">{record.paymentFor || '-'}</div>
                    <div className="text-xs text-gray-500">
                        Reg: {record.closingRegNo || '-'}
                    </div>
                </div>
            ),
        },
        {
            title: 'Amount',
            dataIndex: 'amount',
            key: 'amount',
            render: (amount) => (
                <Text strong className="text-green-600">
                    {formatCurrency(amount)}
                </Text>
            ),
            align: 'right',
            sorter: (a, b) => a.amount - b.amount,
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (status) => {
                const { color, icon, text } = getStatusInfo(status);
                return (
                    <Tag icon={icon} color={color}>
                        {text}
                    </Tag>
                );
            },
            filters: [
                { text: 'Paid', value: 'paid' },
                { text: 'Pending', value: 'pending' },
            ],
            onFilter: (value, record) => record.status === value,
        },
    ];


  const getFileName = () => {
    const namePart = member.displayName.replace(/\s+/g, '_');
    const datePart = dayjs().format('YYYYMMDD_HHmmss');
    const kindPart = isPaidPdf ? 'Paid' : 'Pending';
    const groupPart = activeGroupName ? `_${activeGroupName.replace(/\s+/g, '_')}` : '';
    return `${kindPart}_Receipt_${namePart}${groupPart}_${datePart}.pdf`;
  }
    return (
        <Drawer
            title={
                <div>
                    <Title level={4} style={{ margin: 0 }}>
                        Payment Details: {member.displayName}
                    </Title>
                    <Text type="secondary">{member.registrationNumber}</Text>
                </div>
            }
            placement="right"
            width={860}
            onClose={onClose}
            open={visible}
            loading={loading}
            extra={
                <div className='flex items-center gap-2'>
                    {advanceOn ? (
                        <Tooltip title="Advance (अग्रिम) jama karein / hisaab dekhein">
                            <Button onClick={() => setAdvanceOpen(true)} style={adv.data?.balance > 0 ? { borderColor: '#10b981', color: '#047857', fontWeight: 600 } : undefined}>
                                Advance ₹{(adv.data?.balance || 0).toLocaleString('en-IN')}
                            </Button>
                        </Tooltip>
                    ) : null}
                    <Tooltip title="Find missing / extra closing entries for this member and fix them">
                        <Button icon={<ToolOutlined />} onClick={() => setCorrectionOpen(true)}>
                            Correct Payments
                        </Button>
                    </Tooltip>
                    <Tooltip
                        title={pendingCount === 0 ? 'No pending payments for this member' : ''}
                    >
                        <Button
                            type="primary"
                            icon={<ClockCircleOutlined />}
                            disabled={pendingCount === 0}
                            onClick={() => handleDownloadPDF('pending')}
                        >
                            Pending Receipt ({pendingCount})
                        </Button>
                    </Tooltip>
                    <Tooltip
                        title={paidCount === 0 ? 'No paid payments for this member' : ''}
                    >
                        <Button
                            icon={<CheckCircleOutlined />}
                            disabled={paidCount === 0}
                            onClick={() => handleDownloadPDF('paid')}
                        >
                            Paid Receipt ({paidCount})
                        </Button>
                    </Tooltip>
                    <Button onClick={onClose}>Close</Button>
                </div>
            }
        >
            {/* Summary Cards */}
            <Row gutter={16} className="mb-6">
                <Col xs={24} sm={12} lg={8}>
                    <Card size="small" className="bg-blue-50">
                        <Statistic
                            title="Total Marriages"
                            value={report?.summary?.totalMarriages || 0}
                            prefix={<CalendarOutlined />}
                            valueStyle={{ color: '#1890ff', fontSize: '20px' }}
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                    <Card size="small" className="bg-green-50">
                        <Statistic
                            title="Paid"
                            value={report?.summary?.paidAmount || 0}
                            precision={2}
                            prefix={<DollarOutlined />}
                            valueStyle={{ color: '#52c41a', fontSize: '20px' }}
                        />
                        <div className="text-xs text-gray-500">
                            {report?.summary?.paidMarriages || 0} Closings
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                    <Card size="small" className="bg-orange-50">
                        <Statistic
                            title="Pending"
                            value={report?.summary?.pendingAmount || 0}
                            precision={2}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: '#fa8c16', fontSize: '20px' }}
                        />
                        <div className="text-xs text-gray-500">
                            {report?.summary?.pendingMarriages || 0} Closings
                        </div>
                    </Card>
                </Col>
            </Row>

          

            {/* Marriage Payments Table */}
            <Card
                title={
                    <Space>
                        <CreditCardOutlined />
                        <span>Closings Payments</span>
                        <Badge
                            count={marriages.length}
                            style={{ backgroundColor: '#1890ff' }}
                        />
                        {activeGroupName && (
                            <Tag color="blue" icon={<FolderOpenOutlined />} closable
                                onClose={(e) => { e.preventDefault(); setGroupFilter(null); }}>
                                {activeGroupName}
                            </Tag>
                        )}
                    </Space>
                }
                extra={
                    <Select
                        placeholder="All closing groups"
                        style={{ minWidth: 240 }}
                        value={groupFilter}
                        onChange={(v) => setGroupFilter(v ?? null)}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        suffixIcon={<TeamOutlined />}
                        options={[
                            ...availableGroups.map(g => ({
                                value: g.id,
                                label: `${g.name} (${g.count})`,
                            })),
                            ...(ungroupedCount > 0
                                ? [{ value: '__none__', label: `No group (${ungroupedCount})` }]
                                : []),
                        ]}
                        notFoundContent="No closing groups"
                    />
                }
                className="mb-4"
            >
                <Table
                    columns={marriageColumns}
                    dataSource={marriages}
                    rowKey="paymentId"
                    pagination={false}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    activeGroupName
                                        ? `No payments in "${activeGroupName}"`
                                        : 'No payments'
                                }
                            />
                        ),
                    }}
                    summary={() => (
                        <Table.Summary fixed>
                            <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={2}>
                                    <Text strong>
                                        {activeGroupName ? 'Filtered Total:' : 'Total Amount:'}
                                    </Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={1}>
                                    <Text strong className="text-green-600">
                                        {formatCurrency(
                                            activeGroupName ? filteredTotal : (summary?.totalAmount || 0)
                                        )}
                                    </Text>
                                </Table.Summary.Cell>

                            </Table.Summary.Row>
                        </Table.Summary>
                    )}
                />
            </Card>

            <MemberPaymentCorrection
                open={correctionOpen}
                onClose={() => setCorrectionOpen(false)}
                memberData={member}
                onChanged={onChanged}
            />

        <Drawer
                title={getFileName()}
                width={800}
                placement="right"
                onClose={() => setPdfPreviewOpen(false)}
                open={pdfPreviewOpen}
                maskClosable={false}
                destroyOnHidden={true}
                keyboard={false}
                footer={
                    <Space style={{ float: 'right' }}>
                        <Button onClick={() => setPdfPreviewOpen(false)} size="large">
                            Cancel
                        </Button>
                        <PDFDownloadLink
                          document={
                    <SingleMemberPendingPaymentPdf
                        memberData={member}
                        paymentReport={filteredReport}
                        programInfo={selectedProgram}
                        TrustData={TrustData}
                        paymentStatus={pdfStatus}
                        closingGroupName={activeGroupName}
                    />
                }
                            fileName={getFileName()}
                        >
                            {({ loading }) => (
                                <Button 
                                    type="primary" 
                                    icon={<DownloadOutlined />} 
                                    size="large"
                                    loading={loading}
                                  
                                >
                                    Download PDF members
                                </Button>
                            )}
                        </PDFDownloadLink>
                    </Space>
                }
            >
                <PDFViewer style={{ width: '100%', height: '100vh', border: 'none' }}>
                  <SingleMemberPendingPaymentPdf
            memberData={member}
            paymentReport={filteredReport}
            programInfo={selectedProgram}
            TrustData={TrustData}
            paymentStatus={pdfStatus}
            closingGroupName={activeGroupName}
        />
                </PDFViewer>
            </Drawer>
                    {advanceOn ? <AdvanceModal open={advanceOpen} member={member} onClose={() => setAdvanceOpen(false)} onChanged={() => adv.reload()} /> : null}
        </Drawer>
    );
}

export default MemberPaymentDetails;