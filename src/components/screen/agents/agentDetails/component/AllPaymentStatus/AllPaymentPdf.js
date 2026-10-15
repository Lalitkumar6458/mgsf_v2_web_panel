import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';
import React from 'react';
import dayjs from 'dayjs';
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';
import krinshnaImage from '@/app/api/helperfile/Images/KrinshnaImage';
import PdfHeaderCom from '../pdfcom/HeaderCom';
import { normalizeTrust } from '@/lib/trust/profile';
import { formatShortDate } from '@/lib/dateUtils';

Font.register({
  family: 'NotoSansDevanagari',
  fonts: [
    { src: NotoSansDevanagari, fontWeight: 'normal' },
    { src: NotoSansDevanagariBold, fontWeight: 'bold' },
  ]
});

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    fontFamily: 'NotoSansDevanagari',
    padding: 15,
    fontSize: 10,
  },
  outerBorder: { border: '2px solid #d4af37', padding: 6, minHeight: '100%' },
  innerBorder: { border: '1px solid #d4af37', padding: 10, minHeight: '100%' },

  topText: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  smallText: { fontSize: 10, color: '#8B0000', fontWeight: 'bold' },
  headerSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logoImage: { width: 70, height: 70 },
  centerContent: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  mainTitle: { fontSize: 20, color: '#8B0000', fontWeight: 'bold', marginBottom: 2 },
  subTitle: { fontSize: 12, color: '#000', fontWeight: 'bold', marginBottom: 2 },
  address: { fontSize: 9, color: '#333', textAlign: 'center', marginBottom: 2 },
  phoneNumbers: { fontSize: 10, color: '#000', fontWeight: 'bold', marginBottom: 4 },
  schemeBox: { backgroundColor: '#8B0000', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 12 },
  schemeText: { fontSize: 11, color: '#fff', fontWeight: 'bold' },

  agentInfoSection: {
    backgroundColor: '#f8f9fa', padding: 6, marginBottom: 6, borderRadius: 3,
    flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap',
  },
  infoItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  infoLabel: { fontSize: 8, color: '#8B0000', fontWeight: 'bold', marginRight: 3 },
  infoValue: { fontSize: 8, fontWeight: 'bold', color: '#1a0f5e' },

  tableSectionTitle: {
    fontSize: 10, color: '#8B0000', fontWeight: 'bold', marginBottom: 4,
    paddingBottom: 2, borderBottom: '1.5px solid #d4af37', textAlign: 'center',
  },

  table: { width: '100%', borderWidth: 1, borderColor: '#d9d9d9', marginBottom: 4 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#8B0000', borderBottomWidth: 1, borderBottomColor: '#d9d9d9' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0', minHeight: 18 },
  tableRowAlt: { backgroundColor: '#fafafa' },
  tableCell: { paddingVertical: 3, paddingHorizontal: 3, fontSize: 7, borderRightWidth: 0.5, borderRightColor: '#d9d9d9', justifyContent: 'center', overflow: 'hidden' },
  tableHeaderCell: { paddingVertical: 4, paddingHorizontal: 3, fontSize: 8, fontWeight: 'bold', color: '#fff', borderRightWidth: 0.5, borderRightColor: '#fff', justifyContent: 'center', alignItems: 'center' },

  colSrNo:          { width: '5%',  alignItems: 'center' },
  colRegNo:         { width: '10%', alignItems: 'center' },
  colName:          { width: '18%', alignItems: 'flex-start' },
  colFatherName:    { width: '15%', alignItems: 'flex-start' },
  colPhone:         { width: '11%', alignItems: 'center' },
  colProgram:       { width: '18%', alignItems: 'flex-start' },
  colAmountPending: { width: '11%', alignItems: 'flex-end' },
  colAmountPaid:    { width: '11%', alignItems: 'flex-end' },
  colStatus:        { width: '11%', alignItems: 'center' },

  // Closed-member report columns — own set so the main table is untouched.
  // 5+10+17+13+11+12+13+10+9 = 100%
  cmSrNo:       { width: '5%',  alignItems: 'center' },
  cmRegNo:      { width: '10%', alignItems: 'center' },
  cmName:       { width: '17%', alignItems: 'flex-start' },
  cmFatherName: { width: '13%', alignItems: 'flex-start' },
  cmPhone:      { width: '11%', alignItems: 'center' },
  cmClosingDate:{ width: '12%', alignItems: 'center' },
  cmGroup:      { width: '13%', alignItems: 'flex-start' },
  cmCollected:  { width: '10%', alignItems: 'flex-end' },
  cmDue:        { width: '9%',  alignItems: 'flex-end' },

  textLeft: { textAlign: 'left' },
  textCenter: { textAlign: 'center' },
  textRight: { textAlign: 'right' },
  smallTableText: { fontSize: 7, lineHeight: 1.1 },
  boldTableText: { fontSize: 7, fontWeight: 'bold', lineHeight: 1.1 },

  summaryRow: { flexDirection: 'row', backgroundColor: '#f8f9fa', borderTop: '2px solid #d4af37', minHeight: 22, alignItems: 'center' },
  summaryCell: { padding: 4, fontSize: 8, fontWeight: 'bold', borderRightWidth: 0.5, borderRightColor: '#d9d9d9', justifyContent: 'center', alignItems: 'center' },

  totalRow: { flexDirection: 'row', backgroundColor: '#1a0f5e', minHeight: 20, alignItems: 'center' },
  totalCell: { padding: 4, fontSize: 8, fontWeight: 'bold', color: '#fff', borderRightWidth: 0.5, borderRightColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  totalLabel: { textAlign: 'left', paddingLeft: 6 },
  totalAmount: { fontSize: 9, textAlign: 'right', paddingRight: 6, fontWeight: 'bold' },

  noDataBox: { padding: 30, textAlign: 'center', backgroundColor: '#fafafa', borderRadius: 4, border: '1px dashed #d9d9d9' },
  noDataText: { fontSize: 11, color: '#8c8c8c' },

  noticeSection: { marginTop: 4, marginBottom: 4, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#fff8e1', border: '1px solid #ffd54f', borderRadius: 3 },
  noticeText: { fontSize: 7, color: '#5d4037', fontWeight: 'bold', textAlign: 'center', lineHeight: 1.2 },

  footer: { marginTop: 4, width: '100%', paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', fontSize: 7, color: '#8c8c8c', borderTop: '0.5px solid #d4af37' },
  footerLeft: { flex: 1 },
  footerCenter: { flex: 1, textAlign: 'center' },
  footerRight: { flex: 1, textAlign: 'right' },

  memberInfo: { flexDirection: 'column' },
  memberName: { fontSize: 7, fontWeight: 'bold', color: '#1a0f5e', marginBottom: 1 },
  memberDetails: { fontSize: 6, color: '#666', lineHeight: 1.1 },
  regCinText: { fontSize: 7.8, color: '#333', fontWeight: 'bold', letterSpacing: 0.2, marginBottom: 3 },
});

// ─── Row counts ──────────────────────────────────────────────────────────────
const ROWS_FIRST_PAGE = 23; // less rows on page 1 because header takes space
const ROWS_OTHER_PAGE = 30; // full rows on subsequent pages

const AllPaymentPdf = ({ rowData = [], agentInfo = {}, paymentStatus = 'all', TrustData }) => {
  const TrsutData = TrustData && TrustData.name !== undefined ? TrustData : normalizeTrust(TrustData);
  const currentDate = dayjs().format('DD-MM-YYYY');
  const currentTime = dayjs().format('HH:mm');

  // 'all' | 'pending' | 'paid' | 'closed' — the caller already filters, but
  // filter again so the document is correct no matter who renders it.
  const mode = ['pending', 'paid', 'closed', 'closed_paid', 'closed_pending'].includes(paymentStatus)
    ? paymentStatus : 'all';
  const isClosedReport = mode.startsWith('closed');
  // Pending-only list: paid amount is not printed (column + summary lines),
  // columns then add up to 100%.
  const hidePaid = mode === 'pending';
  const programColStyle = hidePaid ? { width: '19%' } : null;

  const rows = (
    mode === 'pending' ? rowData.filter((r) => (r.pendingCount || 0) > 0)
    : mode === 'paid'  ? rowData.filter((r) => (r.paidCount    || 0) > 0)
    : mode === 'closed_paid'
      ? rowData.filter((r) => r.isClosed && (r.contributorsPaid || 0) > 0 && (r.contributorsPending || 0) === 0)
    : mode === 'closed_pending'
      ? rowData.filter((r) => r.isClosed && (r.contributorsPending || 0) > 0)
    : isClosedReport   ? rowData.filter((r) => r.isClosed)
    : rowData
  ).map((r, i) => ({ ...r, index: r.index ?? i + 1 }));

  const REPORT = {
    all:     { title: 'सभी योजना भुगतान सारांश',  tag: 'सभी सदस्य' },
    pending: { title: 'बकाया भुगतान सूची',        tag: 'केवल बकाया' },
    paid:    { title: 'भुगतान की गई सूची',        tag: 'केवल भुगतान' },
    closed:  { title: 'समापन सदस्य सूची',         tag: 'जिनका समापन हो चुका' },
    closed_pending: { title: 'समापन सदस्य - बकाया सूची',   tag: 'जिनकी राशि शेष है' },
    closed_paid:    { title: 'समापन सदस्य - पूर्ण भुगतान सूची', tag: 'पूरी राशि प्राप्त' },
  }[mode];

  const totalPaid         = rows.reduce((s, r) => s + (r.totalPaid    || 0), 0);
  const totalPending      = rows.reduce((s, r) => s + (r.totalPending || 0), 0);
  const totalMembers      = new Set(rows.map((r) => r.registrationNumber)).size;
  const totalPrograms     = new Set(rows.map((r) => r.programName)).size;
  const totalPaidCount    = rows.reduce((s, r) => s + (r.paidCount    || 0), 0);
  const totalPendingCount = rows.reduce((s, r) => s + (r.pendingCount || 0), 0);
  const noPaymentMembers  = rows.filter((r) => !r.paidCount && !r.pendingCount).length;

  // Closed-member report totals — money collected FOR these members by others
  const totalCollected    = rows.reduce((s, r) => s + (r.collectedForMember || 0), 0);
  const totalDue          = rows.reduce((s, r) => s + (r.dueForMember       || 0), 0);
  const totalContribPaid  = rows.reduce((s, r) => s + (r.contributorsPaid    || 0), 0);
  const totalContribPend  = rows.reduce((s, r) => s + (r.contributorsPending || 0), 0);

  const formatCurrency = (amt) => `₹${parseFloat(amt || 0).toLocaleString('en-IN')}`;

  // ── Split rowData into pages respecting the two limits ────────────────────
  const buildPages = () => {
    const pages = [];
    let remaining = [...rows];

    // Page 1 — 24 rows
    pages.push(remaining.splice(0, ROWS_FIRST_PAGE));

    // Subsequent pages — 30 rows each
    while (remaining.length > 0) {
      pages.push(remaining.splice(0, ROWS_OTHER_PAGE));
    }

    return pages;
  };

  // ── Sub-components ────────────────────────────────────────────────────────
  const PageHeader = () => (
    <>
    <PdfHeaderCom TrustData={TrsutData}/>

      <View style={styles.agentInfoSection}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>एजेंट:</Text>
          <Text style={styles.infoValue}>{agentInfo?.displayName || 'N/A'} ({agentInfo?.phone || ''})</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>रिपोर्ट:</Text>
          <Text style={styles.infoValue}>{REPORT.title} ({REPORT.tag})</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>दिनांक:</Text>
          <Text style={styles.infoValue}>{currentDate} {currentTime}</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>कुल रिकॉर्ड:</Text>
          <Text style={styles.infoValue}>{rows.length}</Text>
        </View>
      </View>
    </>
  );

  // ── Closed-member table ───────────────────────────────────────────────────
  const ClosedTableHeader = () => (
    <View style={styles.tableHeader}>
      <View style={[styles.tableHeaderCell, styles.cmSrNo]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>क्र.</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmRegNo]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>रजि. नं.</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmName]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>सदस्य नाम</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmFatherName]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>पिता/पति का नाम</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmPhone]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>फोन नं.</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmClosingDate]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>समापन दिनांक</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmGroup]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>समापन ग्रुप</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmCollected]}>
        <Text style={[styles.textRight, styles.smallTableText]}>प्राप्त राशि</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.cmDue, { borderRightWidth: 0 }]}>
        <Text style={[styles.textRight, styles.smallTableText]}>शेष राशि</Text>
      </View>
    </View>
  );

  const ClosedTableRow = ({ row, index }) => (
    <View style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
      <View style={[styles.tableCell, styles.cmSrNo]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>{row.index}</Text>
      </View>
      <View style={[styles.tableCell, styles.cmRegNo]}>
        <Text style={[styles.textCenter, styles.boldTableText]}>{row.registrationNumber || '-'}</Text>
      </View>
      <View style={[styles.tableCell, styles.cmName]}>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>{row.memberName || '-'}</Text>
          <Text style={styles.memberDetails}>गाँव: {row.village || '-'}</Text>
        </View>
      </View>
      <View style={[styles.tableCell, styles.cmFatherName]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>{row.fatherName || '-'}</Text>
      </View>
      <View style={[styles.tableCell, styles.cmPhone]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>{row.phone || '-'}</Text>
      </View>
      <View style={[styles.tableCell, styles.cmClosingDate]}>
        <Text style={[styles.textCenter, styles.boldTableText, { color: '#722ed1' }]}>
          {formatShortDate(row.closingDate, '-')}
        </Text>
      </View>
      <View style={[styles.tableCell, styles.cmGroup]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>{row.closingGroupName || '-'}</Text>
      </View>
      <View style={[styles.tableCell, styles.cmCollected]}>
        <Text style={[styles.textRight, styles.boldTableText, { color: '#52c41a' }]}>
          {formatCurrency(row.collectedForMember)}
        </Text>
        <Text style={[styles.textRight, styles.memberDetails]}>{row.contributorsPaid || 0} सदस्य</Text>
      </View>
      <View style={[styles.tableCell, styles.cmDue, { borderRightWidth: 0 }]}>
        <Text style={[styles.textRight, styles.boldTableText, { color: '#f5222d' }]}>
          {formatCurrency(row.dueForMember)}
        </Text>
        <Text style={[styles.textRight, styles.memberDetails]}>{row.contributorsPending || 0} सदस्य</Text>
      </View>
    </View>
  );

  const TableHeader = () => (
    <View style={styles.tableHeader}>
      <View style={[styles.tableHeaderCell, styles.colSrNo]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>क्र.</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.colRegNo]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>रजि. नं.</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.colName]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>सदस्य नाम</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.colFatherName]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>पिता/पति का नाम</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.colPhone]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>फोन नं.</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.colProgram, programColStyle]}>
        <Text style={[styles.textLeft, styles.smallTableText]}>योजना</Text>
      </View>
      <View style={[styles.tableHeaderCell, styles.colAmountPending]}>
        <Text style={[styles.textRight, styles.smallTableText]}>बकाया राशि</Text>
      </View>
      {!hidePaid && (
        <View style={[styles.tableHeaderCell, styles.colAmountPaid]}>
          <Text style={[styles.textRight, styles.smallTableText]}>भुगतान राशि</Text>
        </View>
      )}
      <View style={[styles.tableHeaderCell, styles.colStatus, { borderRightWidth: 0 }]}>
        <Text style={[styles.textCenter, styles.smallTableText]}>स्थिति</Text>
      </View>
    </View>
  );

  const TableRow = ({ row, index }) => {
    const hasPaid    = row.totalPaid    > 0;
    const hasPending = row.totalPending > 0;
    const hasBoth    = !hidePaid && row.status === 'both';

    return (
      <View style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
        <View style={[styles.tableCell, styles.colSrNo]}>
          <Text style={[styles.textCenter, styles.smallTableText]}>{row.index}</Text>
        </View>
        <View style={[styles.tableCell, styles.colRegNo]}>
          <Text style={[styles.textCenter, styles.boldTableText]}>{row.registrationNumber || '-'}</Text>
        </View>
        <View style={[styles.tableCell, styles.colName]}>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{row.memberName || '-'}</Text>
            <Text style={styles.memberDetails}>गाँव: {row.village || '-'}</Text>
          </View>
        </View>
        <View style={[styles.tableCell, styles.colFatherName]}>
          <Text style={[styles.textLeft, styles.smallTableText]}>{row.fatherName || '-'}</Text>
        </View>
        <View style={[styles.tableCell, styles.colPhone]}>
          <Text style={[styles.textCenter, styles.smallTableText]}>{row.phone || '-'}</Text>
        </View>
        <View style={[styles.tableCell, styles.colProgram, programColStyle]}>
          <Text style={[styles.textLeft, styles.boldTableText, { color: '#8B0000' }]}>{row.programName || '-'}</Text>
        </View>
        <View style={[styles.tableCell, styles.colAmountPending]}>
          <Text style={[styles.textRight, styles.boldTableText, { color: hasPending ? '#f5222d' : '#d9d9d9' }]}>
            {hasPending ? formatCurrency(row.totalPending) : '-'}
          </Text>
        </View>
        {!hidePaid && (
          <View style={[styles.tableCell, styles.colAmountPaid]}>
            <Text style={[styles.textRight, styles.boldTableText, { color: hasPaid ? '#52c41a' : '#d9d9d9' }]}>
              {hasPaid ? formatCurrency(row.totalPaid) : '-'}
            </Text>
          </View>
        )}
        <View style={[styles.tableCell, styles.colStatus, { borderRightWidth: 0 }]}>
          {hasBoth ? (
            <View style={{ backgroundColor: '#fa8c16', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
              <Text style={{ fontSize: 6, color: '#fff', fontWeight: 'bold' }}>Both</Text>
            </View>
          ) : hasPaid && !hidePaid ? (
            <View style={{ backgroundColor: '#52c41a', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
              <Text style={{ fontSize: 6, color: '#fff', fontWeight: 'bold' }}>Paid</Text>
            </View>
          ) : hasPending ? (
            <View style={{ backgroundColor: '#faad14', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
              <Text style={{ fontSize: 6, color: '#fff', fontWeight: 'bold' }}>Pending</Text>
            </View>
          ) : (
            <View style={{ backgroundColor: '#bfbfbf', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
              <Text style={{ fontSize: 6, color: '#fff', fontWeight: 'bold' }}>No Payment</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const SummaryRows = () => (
    <>
      {(isClosedReport
        ? [
            ['कुल समापन सदस्य:',        totalMembers.toString(),          '#722ed1'],
            ['भुगतान करने वाले सदस्य:',  totalContribPaid.toString(),      '#52c41a'],
            ['बकाया वाले सदस्य:',        totalContribPend.toString(),      '#faad14'],
            ['कुल प्राप्त राशि:',        formatCurrency(totalCollected),   '#52c41a'],
          ]
        : [
            ['कुल सदस्य (अद्वितीय):',   totalMembers.toString(),          '#1a0f5e'],
            ['कुल योजना (अद्वितीय):',    totalPrograms.toString(),         '#1a0f5e'],
            ...(mode === 'all'
              ? [['बिना किसी भुगतान वाले सदस्य:', noPaymentMembers.toString(), '#8c8c8c']]
              : []),
            ...(hidePaid ? [] : [['भुगतान लेनदेन:', totalPaidCount.toString(), '#52c41a']]),
            ['बकाया लेनदेन:',            totalPendingCount.toString(),     '#faad14'],
            ...(hidePaid ? [] : [['कुल भुगतान राशि:', formatCurrency(totalPaid), '#52c41a']]),
          ]
      ).map(([label, value, color]) => (
        <View key={label} style={styles.summaryRow}>
          <View style={[styles.summaryCell, { width: '85%', textAlign: 'left' }]}>
            <Text style={{ textAlign: 'left', paddingLeft: 6, color: '#8B0000' }}>{label}</Text>
          </View>
          <View style={[styles.summaryCell, { width: '15%', borderRightWidth: 0 }]}>
            <Text style={{ textAlign: 'right', paddingRight: 6, color }}>{value}</Text>
          </View>
        </View>
      ))}

      {/* Grand total pending */}
      <View style={styles.totalRow}>
        <View style={[styles.totalCell, { width: '85%' }]}>
          <Text style={[styles.totalLabel, { fontSize: 8 }]}>
            {isClosedReport ? 'कुल शेष राशि:' : 'कुल बकाया राशि:'}
          </Text>
        </View>
        <View style={[styles.totalCell, { width: '15%', borderRightWidth: 0, backgroundColor: '#8B0000' }]}>
          <Text style={[styles.totalAmount, { fontSize: 9 }]}>
            {formatCurrency(isClosedReport ? totalDue : totalPending)}
          </Text>
        </View>
      </View>
    </>
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!rows || rows.length === 0) {
    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <View style={styles.outerBorder}>
            <View style={styles.innerBorder}>
              <PageHeader />
              <View style={styles.noDataBox}>
                <Text style={[styles.noDataText, { fontSize: 13, marginBottom: 6, fontWeight: 'bold' }]}>
                  कोई भुगतान रिकॉर्ड नहीं है
                </Text>
                <Text style={styles.noDataText}>इस एजेंट के लिए कोई भुगतान रिकॉर्ड नहीं मिला</Text>
              </View>
              <View style={styles.noticeSection}>
                <Text style={styles.noticeText}>
                  यह दान स्वेच्छिक रूप से दिया गया है और किसी भी कारणवश इसकी वापसी नहीं की जाएगी।
                </Text>
              </View>
              <View style={styles.footer}>
                <Text style={styles.footerLeft}>जनरेट: {currentDate} {currentTime}</Text>
                <Text style={styles.footerCenter}>{TrsutData.name} © {dayjs().year()}</Text>
                <Text style={styles.footerRight}>एजेंट ID: {agentInfo?.uid || 'N/A'}</Text>
              </View>
            </View>
          </View>
        </Page>
      </Document>
    );
  }

  // ── Build pages ────────────────────────────────────────────────────────────
  const pageChunks = buildPages();
  const totalPages = pageChunks.length;

  return (
    <Document>
      {pageChunks.map((pageRows, pageIdx) => {
        const isFirstPage = pageIdx === 0;
        const isLastPage  = pageIdx === totalPages - 1;

        return (
          <Page key={`page-${pageIdx}`} size="A4" style={styles.page}>
            <View style={styles.outerBorder}>
              <View style={styles.innerBorder}>

                {/* Full letterhead only on page 1 */}
                {isFirstPage && <PageHeader />}

                {/* Section title */}
                <Text style={styles.tableSectionTitle}>
                  {REPORT.title}
                  {!isFirstPage && ` (पृष्ठ ${pageIdx + 1}/${totalPages})`}
                </Text>

                {/* Compact agent info on continuation pages */}
                {!isFirstPage && (
                  <View style={{ marginBottom: 4 }}>
                    <Text style={{ fontSize: 8, color: '#666', textAlign: 'center' }}>
                      पृष्ठ {pageIdx + 1} / {totalPages} • एजेंट: {agentInfo?.displayName || 'N/A'} • {currentDate}
                    </Text>
                  </View>
                )}

                {/* Table — header repeated on every page */}
                <View style={styles.table}>
                  {isClosedReport ? <ClosedTableHeader /> : <TableHeader />}
                  {pageRows.map((row, idx) =>
                    isClosedReport ? (
                      <ClosedTableRow
                        key={`${row.registrationNumber}-closed-${idx}`}
                        row={row}
                        index={idx}
                      />
                    ) : (
                      <TableRow
                        key={`${row.registrationNumber}-${row.programName}-${idx}`}
                        row={row}
                        index={idx}
                      />
                    )
                  )}
                </View>

                {/* Summary + notice only on last page */}
                {isLastPage && (
                  <>
                    <SummaryRows />
                    <View style={styles.noticeSection}>
                      <Text style={styles.noticeText}>
                        यह दान स्वेच्छिक रूप से दिया गया है और किसी भी कारणवश इसकी वापसी नहीं की जाएगी।
                      </Text>
                    </View>
                  </>
                )}

                {/* Footer on every page */}
                <View style={styles.footer}>
                  <Text style={styles.footerLeft}>
                    {!isFirstPage ? `एजेंट: ${agentInfo?.displayName || 'N/A'}` : ''}
                  </Text>
                  <Text style={styles.footerCenter}>पृष्ठ {pageIdx + 1} / {totalPages}</Text>
                  <Text style={styles.footerRight}>{currentDate} {currentTime}</Text>
                </View>

              </View>
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

export default AllPaymentPdf;