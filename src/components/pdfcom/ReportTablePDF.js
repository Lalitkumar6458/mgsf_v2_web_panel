// Generic report PDF: trust letterhead, title band, summary boxes, a table that repeats its header on every
// page, page numbers. Used by the Reports page (late payments, agent performance, member history).
import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';
import { PdfTrustHeader } from '@/components/screen/agents/agentDetails/component/pdfcom/HeaderCom';

Font.register({
  family: 'NotoSansDevanagari',
  fonts: [{ src: NotoSansDevanagari, fontWeight: 'normal' }, { src: NotoSansDevanagariBold, fontWeight: 'bold' }],
});

const NAVY = '#1a0f5e', LINE = '#d9d6e8', MUTED = '#6b6b6b';
const S = StyleSheet.create({
  page: { fontFamily: 'NotoSansDevanagari', fontSize: 7.4, padding: 18, paddingBottom: 30, color: '#111' },
  band: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: NAVY, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 3, marginBottom: 4 },
  bandTitle: { fontSize: 10, fontWeight: 'bold', color: '#fff' },
  bandRight: { fontSize: 7.5, color: '#fff' },
  sub: { fontSize: 7, color: MUTED, marginBottom: 5 },
  sumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  sumBox: { flexGrow: 1, flexBasis: 70, borderWidth: 1, borderColor: LINE, borderRadius: 3, padding: 4 },
  sumLabel: { fontSize: 6.4, color: MUTED },
  sumValue: { fontSize: 9.5, fontWeight: 'bold' },
  th: { flexDirection: 'row', backgroundColor: '#efedf7', borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, fontWeight: 'bold', color: NAVY },
  tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderColor: LINE, minHeight: 13, alignItems: 'center' },
  alt: { backgroundColor: '#fafafe' },
  c: { paddingHorizontal: 2.5, paddingVertical: 2 },
  footer: { position: 'absolute', bottom: 12, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: MUTED },
});

/**
 * columns: [{ title, w (relative width), align?: 'right' }]
 * rows:    [[cell, …]] — strings; a cell can be { text, color, bold }
 */
export function ReportTablePDF({ title, subtitle, summary = [], columns = [], rows = [], orientation = 'landscape', TrustData, note }) {
  const total = columns.reduce((s, c) => s + (c.w || 1), 0);
  const pct = (w) => `${(((w || 1) / total) * 100).toFixed(2)}%`;
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  return (
    <Document title={title} author={TrustData?.name}>
      <Page size="A4" orientation={orientation} style={S.page}>
        <View fixed><PdfTrustHeader height={orientation === 'landscape' ? 68 : 78} TrustData={TrustData} /></View>
        <View style={S.band}>
          <Text style={S.bandTitle}>{title}</Text>
          <Text style={S.bandRight}>दिनांक: {stamp}</Text>
        </View>
        {subtitle ? <Text style={S.sub}>{subtitle}</Text> : null}
        {summary.length > 0 && (
          <View style={S.sumRow}>
            {summary.map((s, i) => (
              <View key={i} style={S.sumBox}>
                <Text style={S.sumLabel}>{s.label}</Text>
                <Text style={[S.sumValue, s.color ? { color: s.color } : null]}>{String(s.value)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={S.th} fixed>
          {columns.map((c, i) => <Text key={i} style={[S.c, { width: pct(c.w), textAlign: c.align || 'left' }]}>{c.title}</Text>)}
        </View>
        {rows.length === 0 && <View style={[S.tr, { justifyContent: 'center', minHeight: 36 }]}><Text style={{ color: MUTED }}>कोई रिकॉर्ड नहीं</Text></View>}
        {rows.map((r, i) => (
          <View key={i} style={[S.tr, i % 2 ? S.alt : null]} wrap={false}>
            {r.map((cell, j) => {
              const o = cell && typeof cell === 'object' ? cell : { text: cell };
              return (
                <Text key={j} style={[S.c, { width: pct(columns[j]?.w), textAlign: columns[j]?.align || 'left', color: o.color || '#111', fontWeight: o.bold ? 'bold' : 'normal' }]}>
                  {o.text === null || o.text === undefined ? '' : String(o.text)}
                </Text>
              );
            })}
          </View>
        ))}
        {note ? <Text style={[S.sub, { marginTop: 6 }]}>{note}</Text> : null}
        <View style={S.footer} fixed>
          <Text>{TrustData?.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `पृष्ठ ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Build and download in the browser */
export async function downloadReportPdf(props, fileName) {
  const blob = await pdf(<ReportTablePDF {...props} />).toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export default ReportTablePDF;
