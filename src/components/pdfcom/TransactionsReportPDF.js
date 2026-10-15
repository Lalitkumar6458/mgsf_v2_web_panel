// component/pdfcom/TransactionsReportPDF.jsx
// ✅ Multi-page support, no cut rows, proper column widths, clean design
import React, { memo } from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';
import dayjs from 'dayjs';
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';

Font.register({
  family: 'NotoSansDevanagari',
  fonts: [
    { src: NotoSansDevanagari, fontWeight: 'normal' },
    { src: NotoSansDevanagariBold, fontWeight: 'bold' },
  ],
});

// ─── A4 Portrait: 595 × 842 pt, padding 20 → content width = 555pt ──────────
// Column widths must sum to exactly 555
const COL = {
  no:     28,   // S.No
  date:   46,   // Date
  payer:  108,  // Payer (name + reg)
  benef:  108,  // Beneficiary (name + reg)
  amount: 58,   // Amount ₹
  method: 46,   // Method pill
  trx:    80,   // TRX ID
  ref:    81,   // Reference  → 28+46+108+108+58+46+80+81 = 555 ✓
};

const COLORS = {
  maroon:     '#8B0000',
  navy:       '#1a1a4e',
  gold:       '#c9a227',
  lightGold:  '#f5e9c3',
  rowEven:    '#fdf8f0',
  rowOdd:     '#ffffff',
  green:      '#15803d',
  greenBg:    '#dcfce7',
  blue:       '#1d4ed8',
  blueBg:     '#dbeafe',
  headerText: '#ffffff',
  border:     '#e5e7eb',
  subText:    '#9ca3af',
  footerBg:   '#f9fafb',
  totalBg:    '#1a1a4e',
};

const S = StyleSheet.create({
  page: {
    backgroundColor: '#fff',
    fontFamily: 'NotoSansDevanagari',
    paddingTop: 20,
    paddingBottom: 40,   // room for fixed footer
    paddingHorizontal: 20,
    fontSize: 8,
  },

  // ── Outer decorative border ──
  outerBorder: {
    border: `2px solid ${COLORS.gold}`,
    padding: 3,
    flex: 1,
  },
  innerBorder: {
    border: `1px solid ${COLORS.gold}`,
    padding: 8,
    flex: 1,
    flexDirection: 'column',
  },

  // ── Header ──
  topStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  topText: { fontSize: 7.5, color: COLORS.maroon, fontWeight: 'bold' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  logo: { width: 68, height: 68, objectFit: 'contain' },
  centerBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  orgName:  { fontSize: 19, color: COLORS.maroon, fontWeight: 'bold', marginBottom: 1 },
  orgCity:  { fontSize: 10, color: '#222', fontWeight: 'bold', marginBottom: 1 },
  orgAddr:  { fontSize: 7.5, color: '#555', textAlign: 'center', marginBottom: 1 },
  orgPhone: { fontSize: 8.5, color: '#222', fontWeight: 'bold', marginBottom: 4 },
  reportBadge: {
    backgroundColor: COLORS.maroon,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 4,
  },
  reportBadgeText: { fontSize: 9, color: '#fff', fontWeight: 'bold' },

  // ── Info bar ──
  infoBar: {
    backgroundColor: '#eef2ff',
    borderLeft: `3px solid ${COLORS.maroon}`,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 5,
    borderRadius: 2,
  },
  infoItem:  { flexDirection: 'row', alignItems: 'center', marginBottom: 1 },
  infoLabel: { fontSize: 7.5, color: COLORS.maroon, fontWeight: 'bold', marginRight: 3 },
  infoValue: { fontSize: 7.5, color: COLORS.navy, fontWeight: 'bold' },

  // ── Filter strip ──
  filterBar: {
    backgroundColor: '#fffde7',
    border: `1px solid #fde68a`,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  filterText: { fontSize: 7, color: '#78350f' },

  // ── Summary cards ──
  summaryRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
    border: `1px solid ${COLORS.border}`,
  },
  summaryLabel: { fontSize: 6.5, color: COLORS.subText, marginBottom: 2, textAlign: 'center' },
  summaryValue: { fontSize: 13, fontWeight: 'bold', textAlign: 'center' },

  // ── Table ──
  tableWrapper: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    marginBottom: 8,
  },

  // Header row
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.navy,
    minHeight: 24,
    alignItems: 'center',
  },
  th: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 7,
    paddingHorizontal: 3,
    paddingVertical: 5,
    textAlign: 'center',
    borderRight: '0.5px solid rgba(255,255,255,0.15)',
    letterSpacing: 0.2,
  },
  thLeft: { textAlign: 'left' },
  thRight: { textAlign: 'right' },
  thLast: { borderRight: 0 },

  // Data rows — wrap={false} prevents mid-row page breaks
  tableRow: {
    flexDirection: 'row',
    borderBottom: `0.5px solid ${COLORS.border}`,
    minHeight: 26,
    alignItems: 'stretch',
  },
  rowEven: { backgroundColor: COLORS.rowEven },
  rowOdd:  { backgroundColor: COLORS.rowOdd },

  // Cell base
  td: {
    fontSize: 7.5,
    paddingHorizontal: 3,
    paddingVertical: 4,
    borderRight: `0.5px solid ${COLORS.border}`,
  },
  tdLast:  { borderRight: 0 },
  tLeft:   { textAlign: 'left' },
  tCenter: { textAlign: 'center' },
  tRight:  { textAlign: 'right' },
  subText: { fontSize: 6.5, color: COLORS.subText, marginTop: 1 },
  monoText:{ fontFamily: 'Courier', letterSpacing: -0.3 },

  // Amount
  amtText: { fontSize: 8, fontWeight: 'bold', color: COLORS.green, textAlign: 'right' },

  // Method pills
  cashPill: {
    backgroundColor: COLORS.greenBg,
    color: COLORS.green,
    fontSize: 7,
    fontWeight: 'bold',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 10,
    textAlign: 'center',
  },
  onlinePill: {
    backgroundColor: COLORS.blueBg,
    color: COLORS.blue,
    fontSize: 7,
    fontWeight: 'bold',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 10,
    textAlign: 'center',
  },

  // Total row
  totalRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.totalBg,
    minHeight: 24,
    alignItems: 'center',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  totalCell: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#fff',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  // ── Notice ──
  notice: {
    backgroundColor: '#fffde7',
    border: `1px solid #fde68a`,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 8,
    color: '#78350f',
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 1.4,
  },

  // ── Footer (fixed, appears on every page) ──
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: `0.5px solid ${COLORS.gold}`,
    paddingTop: 4,
  },
  footerText: { fontSize: 6.5, color: '#9ca3af' },
  pageNum:    { fontSize: 6.5, color: '#9ca3af' },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt   = (n) => `₹${(n || 0).toLocaleString('hi-IN')}`;
const fmtD  = (d) => (d ? dayjs(d).format('DD/MM/YY') : '-');
const trunc = (s, n) => (!s ? '-' : s.length > n ? s.slice(0, n - 1) + '…' : s);

// ─── Reusable page header (shown on every page via fixed=true on wrapper) ──
const PageHeader = memo(({ programInfo, summary, currentDate, currentTime,TrustData }) => (
  <View>
    {/* Decorative top strip */}
    <View style={S.topStrip}>
    {
      (TrustData.topTitle || []).map((item,index)=>(
        <Text key={index} style={S.topText}>{item}</Text>
      ))
    }
    </View>

    {/* Logo + title */}
    <View style={S.headerRow}>
      {TrustData.logo ? <Image src={TrustData.logo} style={S.logo} /> : <View style={S.logo} />}
      <View style={S.centerBlock}>
        <Text style={S.orgName}>{TrustData.name}</Text>
        <Text style={S.orgCity}>{TrustData.cityState}</Text>
        <Text style={S.orgAddr}>{TrustData.address}</Text>
        <Text style={S.orgPhone}>{TrustData.contact}</Text>
        <View style={S.reportBadge}>
          <Text style={S.reportBadgeText}>लेन-देन रिपोर्ट</Text>
        </View>
      </View>
      {(TrustData.RightLogo || TrustData.logo) ? <Image src={TrustData.RightLogo || TrustData.logo} style={S.logo} /> : <View style={S.logo} />}
    </View>

    {/* Info bar */}
    <View style={S.infoBar}>
      <View style={S.infoItem}>
        <Text style={S.infoLabel}>योजना:</Text>
        <Text style={S.infoValue}>{trunc(programInfo?.name || programInfo?.hiname || 'N/A', 28)}</Text>
      </View>
      <View style={S.infoItem}>
        <Text style={S.infoLabel}>तिथि:</Text>
        <Text style={S.infoValue}>{currentDate}  {currentTime}</Text>
      </View>
      <View style={S.infoItem}>
        <Text style={S.infoLabel}>कुल लेन-देन:</Text>
        <Text style={S.infoValue}>{summary.totalTransactions}</Text>
      </View>
      <View style={S.infoItem}>
        <Text style={S.infoLabel}>कुल राशि:</Text>
        <Text style={S.infoValue}>{fmt(summary.totalAmount)}</Text>
      </View>
    </View>
  </View>
));

// ─── Table column header row ──────────────────────────────────────────────────
const TableHead = memo(() => (
  <View style={S.tableHeader}>
    <Text style={[S.th, { width: COL.no }]}>क्र.</Text>
    <Text style={[S.th, S.thLeft, { width: COL.trx }]}>TRX ID</Text>
    <Text style={[S.th, { width: COL.date }]}>तिथि</Text>
    <Text style={[S.th, S.thLeft, { width: COL.payer }]}>भुगतानकर्ता</Text>
    <Text style={[S.th, S.thLeft, { width: COL.benef }]}>लाभार्थी</Text>
    <Text style={[S.th, S.thRight, { width: COL.amount }]}>राशि (₹)</Text>
    <Text style={[S.th, { width: COL.method }]}>विधि</Text>
    <Text style={[S.th, S.thLeft, S.thLast, { width: COL.ref }]}>रेफरेंस / नोट</Text>
  </View>
));

// ─── Single data row ──────────────────────────────────────────────────────────
// One <Text> per cell (no wrapper Views, no font switching): each text node costs layout
// time, and a report can have thousands of rows.
const cell = (w, extra) => [S.td, { width: w }, extra];
const DataRow = memo(({ t, idx }) => {
  const isEven = idx % 2 === 0;
  const cash = t.paymentMethod === 'cash';
  const ref = t.onlineReference ? trunc(t.onlineReference, 16) : '';
  const note = t.note ? trunc(t.note, 18) : '';
  return (
    <View style={[S.tableRow, isEven ? S.rowEven : S.rowOdd]} wrap={false}>
      <Text style={cell(COL.no, { textAlign: 'center', fontSize: 7, color: '#9ca3af' })}>{idx + 1}</Text>
      <Text style={cell(COL.trx, { fontSize: 6.5, color: '#374151' })}>{trunc(t.transactionNumber, 16)}</Text>
      <Text style={cell(COL.date, S.tCenter)}>{fmtD(t.paymentDate)}</Text>
      <Text style={cell(COL.payer, { fontWeight: 'bold' })}>
        {trunc(t.payerName, 18)}
        {t.payerRegistrationNumber ? <Text style={S.subText}>{'\n'}{t.payerRegistrationNumber}</Text> : null}
      </Text>
      <Text style={cell(COL.benef, { fontWeight: 'bold' })}>
        {trunc(t.marriageMemberName, 18)}
        {t.marriageRegistrationNumber ? <Text style={S.subText}>{'\n'}{t.marriageRegistrationNumber}</Text> : null}
      </Text>
      <Text style={cell(COL.amount, S.amtText)}>{fmt(t.amount)}</Text>
      <Text style={cell(COL.method, { textAlign: 'center', fontWeight: 'bold', fontSize: 7, color: cash ? COLORS.green : COLORS.blue })}>
        {cash ? 'नकद' : 'ऑनलाइन'}
      </Text>
      <Text style={cell(COL.ref, [S.tdLast, { fontSize: 7, color: ref || note ? '#374151' : COLORS.subText }])}>
        {ref || (note ? '' : '—')}
        {note ? <Text style={S.subText}>{ref ? '\n' : ''}{note}</Text> : null}
      </Text>
    </View>
  );
});

// ─── Main Document ────────────────────────────────────────────────────────────
// Rows are cut into pages here (fixed rows per page) instead of letting react-pdf flow one
// long wrapping table: that flow is roughly quadratic — 500 rows took 16 s, 3,000 rows 6 min.
// Cut by hand it is linear (3,000 rows ≈ a few seconds) and page numbers need no second pass.
const ROWS_FIRST = 17;   // page 1 also carries the trust header, filters and summary cards
const ROWS_NEXT = 25;    // later pages: a one-line header
const ROWS_TAIL = 3;     // room the total row + notice need on the last page

export function paginate(n) {
  const pages = [];
  let i = 0;
  pages.push([0, Math.min(n, ROWS_FIRST)]);
  i = pages[0][1];
  while (i < n) { pages.push([i, Math.min(n, i + ROWS_NEXT)]); i += ROWS_NEXT; }
  const last = pages[pages.length - 1];
  const cap = pages.length === 1 ? ROWS_FIRST : ROWS_NEXT;
  if (last[1] - last[0] > cap - ROWS_TAIL) pages.push([n, n]); // total + notice on a page of their own
  return pages;
}

const MiniHeader = ({ TrustData, programInfo, page, pages }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${COLORS.gold}`, paddingBottom: 4, marginBottom: 6 }}>
    <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.maroon }}>{TrustData?.name || ''}</Text>
    <Text style={{ fontSize: 7.5, color: COLORS.navy, fontWeight: 'bold' }}>लेन-देन रिपोर्ट · {trunc(programInfo?.name || programInfo?.hiname || '', 28)} · पृष्ठ {page}/{pages}</Text>
  </View>
);

const TransactionsReportPDF = ({
  transactions = [],
  summary,
  programInfo,
  filters,
  generatedDate,
  TrustData = {},
}) => {
  const now         = new Date();
  const currentDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const currentTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const trust = { ...TrustData, topTitle: Array.isArray(TrustData?.topTitle) ? TrustData.topTitle : [] };

  let cashTotal = 0, onlineTotal = 0;
  for (const t of transactions) (t.paymentMethod === 'cash' ? (cashTotal += t.amount || 0) : (onlineTotal += t.amount || 0));
  const avg = summary?.totalTransactions > 0 ? (summary.totalAmount / summary.totalTransactions) : 0;

  const getFilterText = () => {
    const parts = [];
    if (filters?.dateRange?.start && filters?.dateRange?.end)
      parts.push(`तिथि: ${filters.dateRange.start} – ${filters.dateRange.end}`);
    if (filters?.paymentMethod && filters.paymentMethod !== 'all')
      parts.push(`विधि: ${filters.paymentMethod === 'cash' ? 'नकद' : 'ऑनलाइन'}`);
    if (filters?.searchText)
      parts.push(`खोज: "${filters.searchText}"`);
    return parts.length ? `फ़िल्टर: ${parts.join('  |  ')}` : 'कोई फ़िल्टर नहीं — सभी लेन-देन';
  };

  const pages = paginate(transactions.length);
  const footerLeft = `जनरेट: ${generatedDate || `${currentDate} ${currentTime}`}`;
  const year = now.getFullYear();

  return (
    <Document title="Transactions Report" author={trust.name}>
      {pages.map(([from, to], pi) => {
        const first = pi === 0;
        const last = pi === pages.length - 1;
        return (
          <Page key={pi} size="A4" style={S.page} wrap={false}>
            <View style={S.outerBorder}>
              <View style={S.innerBorder}>
                {first ? (
                  <>
                    <PageHeader programInfo={programInfo} summary={summary} currentDate={currentDate} currentTime={currentTime} TrustData={trust} />
                    <View style={S.filterBar}>
                      <Text style={S.filterText}>{getFilterText()}</Text>
                    </View>
                    <View style={S.summaryRow}>
                      <View style={[S.summaryCard, { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }]}>
                        <Text style={S.summaryLabel}>कुल लेन-देन</Text>
                        <Text style={[S.summaryValue, { color: COLORS.blue }]}>{summary?.totalTransactions ?? 0}</Text>
                      </View>
                      <View style={[S.summaryCard, { backgroundColor: '#dcfce7', borderColor: '#86efac' }]}>
                        <Text style={S.summaryLabel}>कुल राशि</Text>
                        <Text style={[S.summaryValue, { color: COLORS.green, fontSize: 11 }]}>{fmt(summary?.totalAmount)}</Text>
                      </View>
                      <View style={[S.summaryCard, { backgroundColor: '#fef9c3', borderColor: '#fde68a' }]}>
                        <Text style={S.summaryLabel}>नकद राशि</Text>
                        <Text style={[S.summaryValue, { color: '#a16207', fontSize: 11 }]}>{fmt(cashTotal)}</Text>
                      </View>
                      <View style={[S.summaryCard, { backgroundColor: '#ede9fe', borderColor: '#c4b5fd' }]}>
                        <Text style={S.summaryLabel}>ऑनलाइन राशि</Text>
                        <Text style={[S.summaryValue, { color: '#6d28d9', fontSize: 11 }]}>{fmt(onlineTotal)}</Text>
                      </View>
                      <View style={[S.summaryCard, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
                        <Text style={S.summaryLabel}>औसत राशि</Text>
                        <Text style={[S.summaryValue, { color: '#c2410c', fontSize: 11 }]}>{fmt(Math.round(avg))}</Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <MiniHeader TrustData={trust} programInfo={programInfo} page={pi + 1} pages={pages.length} />
                )}

                {(to > from || last) && (
                  <View style={S.tableWrapper}>
                    {to > from && <TableHead />}
                    {transactions.slice(from, to).map((t, i) => (
                      <DataRow key={t.id || from + i} t={t} idx={from + i} />
                    ))}
                    {last && (
                      <View style={S.totalRow}>
                        <View style={{ width: COL.no + COL.trx + COL.date + COL.payer + COL.benef }}>
                          <Text style={[S.totalCell, { textAlign: 'right', paddingRight: 6 }]}>कुल योग →</Text>
                        </View>
                        <View style={{ width: COL.amount }}>
                          <Text style={[S.totalCell, { textAlign: 'right', color: '#86efac' }]}>{fmt(summary?.totalAmount)}</Text>
                        </View>
                        <View style={{ width: COL.method + COL.ref }}>
                          <Text style={[S.totalCell, { textAlign: 'center', fontSize: 7, color: 'rgba(255,255,255,0.6)' }]}>
                            {summary?.totalTransactions} entries
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {last && (
                  <View style={S.notice}>
                    <Text style={S.noticeText}>
                      यह दान स्वेच्छिक रूप से दिया गया है और किसी भी कारणवश इसकी वापसी नहीं की जाएगी।
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <View style={S.footer}>
              <Text style={S.footerText}>{footerLeft}</Text>
              <Text style={S.footerText}>{trust.name} © {year}</Text>
              <Text style={S.pageNum}>पृष्ठ {pi + 1} / {pages.length}</Text>
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

export default memo(TransactionsReportPDF);
