// Closed Members report (A4 landscape): trust letterhead, filters used, summary,
// one row per closed member with payment progress, totals on the last page.
import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';
import { PdfTrustHeader } from '@/components/screen/agents/agentDetails/component/pdfcom/HeaderCom';

Font.register({
  family: 'NotoSansDevanagari',
  fonts: [
    { src: NotoSansDevanagari, fontWeight: 'normal' },
    { src: NotoSansDevanagariBold, fontWeight: 'bold' },
  ],
});

const NAVY = '#1a0f5e', LINE = '#d9d6e8', MUTED = '#6b6b6b', GREEN = '#0a7d0a', RED = '#c62828';

const S = StyleSheet.create({
  page: { fontFamily: 'NotoSansDevanagari', fontSize: 7.6, padding: 18, paddingBottom: 30, color: '#111' },
  band: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: NAVY, color: '#fff', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 3, marginBottom: 5 },
  bandTitle: { fontSize: 10, fontWeight: 'bold', color: '#fff' },
  bandRight: { fontSize: 7.5, color: '#fff' },
  filters: { fontSize: 7.2, color: MUTED, marginBottom: 5 },
  sumRow: { flexDirection: 'row', gap: 5, marginBottom: 6 },
  sumBox: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 4 },
  sumLabel: { fontSize: 6.5, color: MUTED },
  sumValue: { fontSize: 10, fontWeight: 'bold' },
  th: { flexDirection: 'row', backgroundColor: '#efedf7', borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, fontWeight: 'bold', color: NAVY },
  tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderColor: LINE, minHeight: 15, alignItems: 'center' },
  trAlt: { backgroundColor: '#fafafe' },
  tot: { flexDirection: 'row', backgroundColor: '#efedf7', borderBottomWidth: 1, borderColor: LINE, fontWeight: 'bold', minHeight: 16, alignItems: 'center' },
  c: { paddingHorizontal: 3, paddingVertical: 2.5 },
  r: { textAlign: 'right' },
  ctr: { textAlign: 'center' },
  sub: { fontSize: 6.4, color: MUTED },
  footer: { position: 'absolute', bottom: 12, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: MUTED },
});

// column widths (sum = 100%)
const W = { n: '3%', reg: '7%', name: '17%', village: '9%', date: '7%', group: '8%', agent: '10%', payers: '5%', paid: '5%', pend: '5%', coll: '8%', due: '8%', pct: '8%' };

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => {
  if (!d) return '-';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return y && m && day ? `${day}-${m}-${y}` : String(d);
};

const Head = () => (
  <View style={S.th} fixed>
    <Text style={[S.c, { width: W.n }]}>#</Text>
    <Text style={[S.c, { width: W.reg }]}>रजि. नं.</Text>
    <Text style={[S.c, { width: W.name }]}>नाम / पिता</Text>
    <Text style={[S.c, { width: W.village }]}>गाँव</Text>
    <Text style={[S.c, { width: W.date }]}>क्लोज़िंग</Text>
    <Text style={[S.c, { width: W.group }]}>ग्रुप</Text>
    <Text style={[S.c, { width: W.agent }]}>एजेंट</Text>
    <Text style={[S.c, S.r, { width: W.payers }]}>कुल</Text>
    <Text style={[S.c, S.r, { width: W.paid }]}>जमा</Text>
    <Text style={[S.c, S.r, { width: W.pend }]}>बाकी</Text>
    <Text style={[S.c, S.r, { width: W.coll }]}>प्राप्त राशि</Text>
    <Text style={[S.c, S.r, { width: W.due }]}>बकाया राशि</Text>
    <Text style={[S.c, S.r, { width: W.pct }]}>प्रगति</Text>
  </View>
);

const ClosedMembersReportPDF = ({ rows = [], summary = {}, filtersText = '', programName = '', TrustData }) => {
  const now = new Date();
  const generated = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  const totalPayers = rows.reduce((s, r) => s + (r.totalDues || 0), 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <Document title="Closed Members Report" author={TrustData?.name}>
      <Page size="A4" orientation="landscape" style={S.page}>
        <View fixed>
          <PdfTrustHeader height={74} TrustData={TrustData} />
        </View>

        <View style={S.band}>
          <Text style={S.bandTitle}>क्लोज़ सदस्य रिपोर्ट  •  Closed Members{programName ? `  •  ${programName}` : ''}</Text>
          <Text style={S.bandRight}>दिनांक: {generated}</Text>
        </View>
        {filtersText ? <Text style={S.filters}>फ़िल्टर: {filtersText}</Text> : null}

        <View style={S.sumRow}>
          <View style={S.sumBox}><Text style={S.sumLabel}>क्लोज़ सदस्य</Text><Text style={S.sumValue}>{rows.length}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>कुल भुगतानकर्ता (एंट्री)</Text><Text style={S.sumValue}>{totalPayers}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>जमा / बाकी</Text><Text style={S.sumValue}>{summary.totalPaidCount || 0} / {summary.totalPendingCount || 0}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>प्राप्त राशि</Text><Text style={[S.sumValue, { color: GREEN }]}>{inr(summary.totalCollected)}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>बकाया राशि</Text><Text style={[S.sumValue, { color: RED }]}>{inr(summary.totalPendingAmount)}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>कुल प्रगति</Text><Text style={S.sumValue}>{pct(summary.totalCollected, (summary.totalCollected || 0) + (summary.totalPendingAmount || 0))}%</Text></View>
        </View>

        <Head />
        {rows.length === 0 ? (
          <View style={[S.tr, { justifyContent: 'center', minHeight: 40 }]}><Text style={{ color: MUTED }}>कोई क्लोज़ सदस्य नहीं मिला</Text></View>
        ) : rows.map((r, i) => {
          const total = (r.collectedAmount || 0) + (r.pendingAmount || 0);
          return (
            <View key={r.id} style={[S.tr, i % 2 ? S.trAlt : null]} wrap={false}>
              <Text style={[S.c, { width: W.n }]}>{i + 1}</Text>
              <Text style={[S.c, { width: W.reg }]}>{r.registrationNumber || '-'}</Text>
              <View style={[S.c, { width: W.name }]}>
                <Text style={{ fontWeight: 'bold' }}>{r.displayName || '-'}</Text>
                {r.fatherName ? <Text style={S.sub}>{r.fatherName}</Text> : null}
              </View>
              <Text style={[S.c, { width: W.village }]}>{r.village || '-'}</Text>
              <Text style={[S.c, { width: W.date }]}>{fmtDate(r.closingDate)}</Text>
              <Text style={[S.c, { width: W.group }]}>{r.closingGroupName || '-'}</Text>
              <Text style={[S.c, { width: W.agent }]}>{r.agentName || '-'}</Text>
              <Text style={[S.c, S.r, { width: W.payers }]}>{r.totalDues || 0}</Text>
              <Text style={[S.c, S.r, { width: W.paid, color: GREEN }]}>{r.paid || 0}</Text>
              <Text style={[S.c, S.r, { width: W.pend, color: (r.pending + r.partial) ? RED : MUTED }]}>{(r.pending || 0) + (r.partial || 0)}</Text>
              <Text style={[S.c, S.r, { width: W.coll }]}>{inr(r.collectedAmount)}</Text>
              <Text style={[S.c, S.r, { width: W.due, color: r.pendingAmount ? RED : MUTED }]}>{inr(r.pendingAmount)}</Text>
              <Text style={[S.c, S.r, { width: W.pct }]}>{pct(r.collectedAmount, total)}%</Text>
            </View>
          );
        })}
        {rows.length > 0 && (
          <View style={S.tot} wrap={false}>
            <Text style={[S.c, { width: '61%' }]}>कुल ({rows.length} सदस्य)</Text>
            <Text style={[S.c, S.r, { width: W.payers }]}>{totalPayers}</Text>
            <Text style={[S.c, S.r, { width: W.paid }]}>{summary.totalPaidCount || 0}</Text>
            <Text style={[S.c, S.r, { width: W.pend }]}>{summary.totalPendingCount || 0}</Text>
            <Text style={[S.c, S.r, { width: W.coll }]}>{inr(summary.totalCollected)}</Text>
            <Text style={[S.c, S.r, { width: W.due }]}>{inr(summary.totalPendingAmount)}</Text>
            <Text style={[S.c, S.r, { width: W.pct }]}>{pct(summary.totalCollected, (summary.totalCollected || 0) + (summary.totalPendingAmount || 0))}%</Text>
          </View>
        )}

        <View style={S.footer} fixed>
          <Text>{TrustData?.name} © {now.getFullYear()}</Text>
          <Text render={({ pageNumber, totalPages }) => `पृष्ठ ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};

export default ClosedMembersReportPDF;
