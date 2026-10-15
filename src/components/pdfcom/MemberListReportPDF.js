// Member list report — a real PDF file (react-pdf), built from whatever the Members page
// is showing: trust letterhead, filters used, summary counts, chosen columns, optional
// grouping by agent (with a sub-total line per agent).
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

/** every column the report can print: key, header, relative width, value(member) */
export const MEMBER_PDF_COLUMNS = [
  { key: 'reg', title: 'रजि. नं.', w: 7, get: (m) => m.registrationNumber || '-' },
  { key: 'app', title: 'आवेदन नं.', w: 6, get: (m) => m.applicationNumber || '-' },
  { key: 'name', title: 'नाम', w: 13, get: (m) => m.displayName || '-', bold: true },
  { key: 'father', title: 'पिता / पति', w: 11, get: (m) => m.fatherName || '-' },
  { key: 'gotra', title: 'गोत्र', w: 7, get: (m) => m.gotra || '-' },
  { key: 'phone', title: 'मोबाइल', w: 8, get: (m) => m.phone || '-' },
  { key: 'gender', title: 'लिंग', w: 5, get: (m) => (m.gender === 'male' ? 'पुरुष' : m.gender === 'female' ? 'महिला' : '-') },
  { key: 'village', title: 'गाँव', w: 9, get: (m) => m.village || '-' },
  { key: 'district', title: 'जिला', w: 8, get: (m) => m._district || '-' },
  { key: 'state', title: 'राज्य', w: 7, get: (m) => m._state || '-' },
  { key: 'guardian', title: 'वारिस', w: 10, get: (m) => [m.guardian, m.guardianRelation].filter(Boolean).join(' ') || '-' },
  { key: 'agent', title: 'एजेंट', w: 9, get: (m) => m.agentName || 'Admin' },
  { key: 'join', title: 'जुड़ने की तिथि', w: 7, get: (m) => m.dateJoin || '-' },
  { key: 'age', title: 'आयु वर्ग', w: 6, get: (m) => m.ageGroupRange || '-' },
  { key: 'kist', title: 'किस्त', w: 5, get: (m) => (m.payAmount ? `₹${m.payAmount}` : '-'), right: true },
  { key: 'fees', title: 'जॉइन फीस', w: 6, get: (m) => (m.joinFeesDone ? 'जमा' : 'बाकी'), color: (m) => (m.joinFeesDone ? GREEN : RED) },
  { key: 'dues', title: 'बकाया', w: 7, get: (m) => (m.openAmount ? `₹${Number(m.openAmount).toLocaleString('en-IN')}` : '-'), right: true, color: (m) => (m.openAmount ? RED : MUTED) },
  { key: 'status', title: 'स्थिति', w: 6, get: (m) => m._statusLabel || '-' },
];

const S = StyleSheet.create({
  page: { fontFamily: 'NotoSansDevanagari', fontSize: 7.4, padding: 18, paddingBottom: 30, color: '#111' },
  band: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: NAVY, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 3, marginBottom: 4 },
  bandTitle: { fontSize: 10, fontWeight: 'bold', color: '#fff' },
  bandRight: { fontSize: 7.5, color: '#fff' },
  filters: { fontSize: 7, color: MUTED, marginBottom: 5 },
  sumRow: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  sumBox: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 4 },
  sumLabel: { fontSize: 6.4, color: MUTED },
  sumValue: { fontSize: 9.5, fontWeight: 'bold' },
  th: { flexDirection: 'row', backgroundColor: '#efedf7', borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, fontWeight: 'bold', color: NAVY },
  tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderColor: LINE, minHeight: 14, alignItems: 'center' },
  alt: { backgroundColor: '#fafafe' },
  group: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f4f2fb', borderBottomWidth: 1, borderColor: LINE, paddingVertical: 3, paddingHorizontal: 4, marginTop: 4 },
  groupTitle: { fontWeight: 'bold', color: NAVY, fontSize: 8 },
  groupSub: { fontSize: 7, color: MUTED },
  c: { paddingHorizontal: 2.5, paddingVertical: 2 },
  footer: { position: 'absolute', bottom: 12, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: MUTED },
});

const pct = (w, total) => `${((w / total) * 100).toFixed(2)}%`;

const MemberListReportPDF = ({
  members = [], columns = [], orientation = 'landscape', groupByAgent = false,
  title = 'सदस्य सूची', filtersText = '', programName = '', TrustData,
}) => {
  const cols = [{ key: 'n', title: '#', w: 3, get: (_, i) => String(i + 1) }, ...MEMBER_PDF_COLUMNS.filter((c) => columns.includes(c.key))];
  const total = cols.reduce((s, c) => s + c.w, 0);
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;

  const male = members.filter((m) => m.gender === 'male').length;
  const female = members.filter((m) => m.gender === 'female').length;
  const feesPending = members.filter((m) => !m.joinFeesDone).length;
  const withDues = members.filter((m) => m.openAmount > 0);
  const duesAmount = withDues.reduce((s, m) => s + Number(m.openAmount || 0), 0);

  const groups = groupByAgent
    ? Object.values(members.reduce((acc, m) => {
        const k = m.agentId || '__none';
        (acc[k] ||= { name: m.agentName || 'Admin (बिना एजेंट)', rows: [] }).rows.push(m);
        return acc;
      }, {})).sort((a, b) => a.name.localeCompare(b.name))
    : [{ name: null, rows: members }];

  const Head = () => (
    <View style={S.th} fixed>
      {cols.map((c) => <Text key={c.key} style={[S.c, { width: pct(c.w, total), textAlign: c.right ? 'right' : 'left' }]}>{c.title}</Text>)}
    </View>
  );

  let serial = 0;
  return (
    <Document title={title} author={TrustData?.name}>
      <Page size="A4" orientation={orientation} style={S.page}>
        <View fixed><PdfTrustHeader height={orientation === 'landscape' ? 70 : 78} TrustData={TrustData} /></View>
        <View style={S.band}>
          <Text style={S.bandTitle}>{title}{programName ? `  •  ${programName}` : ''}</Text>
          <Text style={S.bandRight}>दिनांक: {stamp}</Text>
        </View>
        {filtersText ? <Text style={S.filters}>फ़िल्टर: {filtersText}</Text> : null}

        <View style={S.sumRow}>
          <View style={S.sumBox}><Text style={S.sumLabel}>कुल सदस्य</Text><Text style={S.sumValue}>{members.length}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>पुरुष / महिला</Text><Text style={S.sumValue}>{male} / {female}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>जॉइन फीस बाकी</Text><Text style={[S.sumValue, { color: feesPending ? RED : '#111' }]}>{feesPending}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>बकाया वाले सदस्य</Text><Text style={S.sumValue}>{withDues.length}</Text></View>
          <View style={S.sumBox}><Text style={S.sumLabel}>कुल बकाया</Text><Text style={[S.sumValue, { color: duesAmount ? RED : '#111' }]}>₹{duesAmount.toLocaleString('en-IN')}</Text></View>
          {groupByAgent && <View style={S.sumBox}><Text style={S.sumLabel}>एजेंट</Text><Text style={S.sumValue}>{groups.length}</Text></View>}
        </View>

        <Head />
        {members.length === 0 && (
          <View style={[S.tr, { justifyContent: 'center', minHeight: 40 }]}><Text style={{ color: MUTED }}>कोई सदस्य नहीं मिला</Text></View>
        )}
        {groups.map((g) => (
          <View key={g.name || 'all'}>
            {g.name && (
              <View style={S.group} wrap={false}>
                <Text style={S.groupTitle}>{g.name}</Text>
                <Text style={S.groupSub}>
                  {g.rows.length} सदस्य  •  जॉइन फीस बाकी {g.rows.filter((m) => !m.joinFeesDone).length}  •  बकाया ₹{g.rows.reduce((s, m) => s + Number(m.openAmount || 0), 0).toLocaleString('en-IN')}
                </Text>
              </View>
            )}
            {g.rows.map((m) => {
              const i = serial++;
              return (
                <View key={m.id} style={[S.tr, i % 2 ? S.alt : null]} wrap={false}>
                  {cols.map((c) => (
                    <Text key={c.key} style={[S.c, {
                      width: pct(c.w, total), textAlign: c.right ? 'right' : 'left',
                      fontWeight: c.bold ? 'bold' : 'normal', color: c.color ? c.color(m) : '#111',
                    }]}>{c.get(m, i)}</Text>
                  ))}
                </View>
              );
            })}
          </View>
        ))}

        <View style={S.footer} fixed>
          <Text>{TrustData?.name} © {now.getFullYear()}</Text>
          <Text render={({ pageNumber, totalPages }) => `पृष्ठ ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};

export default MemberListReportPDF;
