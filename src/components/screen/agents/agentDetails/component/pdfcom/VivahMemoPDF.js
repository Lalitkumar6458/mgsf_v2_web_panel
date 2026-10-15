// VivahMemoPDF.jsx
// Vivah Memo (Marriage Receipt) PDF — @react-pdf/renderer
// Page size: A5 — colors/borders sampled directly from the reference
// BANSHILAL receipt image (pixel-picked), so this is a tight visual match.
//
// NOTE ON THE EMBLEM / STAMP ARTWORK:
// The two round emblems at the top (saint portrait on orange bg, navy+gold
// ring) and the red dotted ink-stamp near the signature are custom artwork.
// They cannot be recreated pixel-for-pixel with plain shapes/text — pass
// real PNGs via `logoSrc` / `stampSrc` for an exact match. Until then, close
// placeholders (correct ring colors) are rendered so layout/spacing is right.
//
// Usage:
//   import VivahMemoPDF from './VivahMemoPDF';
//   <PDFDownloadLink document={<VivahMemoPDF receiptData={receiptData} />} fileName="receipt.pdf">Download</PDFDownloadLink>

import React from 'react';
import {
  Document, Page, Text, View, StyleSheet, Font, Image
} from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';

// ─── Register Hindi Font ───────────────────────────────────────────────────
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';
import { PdfTrustHeader } from './HeaderCom';
import { normalizeTrust } from '@/lib/trust/profile';
import { getDistrictLabel, getStateLabel } from '@/lib/staticData';
import { sortByDate, formatShortDate } from '@/lib/dateUtils';

Font.register({
  family: 'NotoSansDevanagari',
  fonts: [
    { src: NotoSansDevanagari, fontWeight: 'normal' },
    { src: NotoSansDevanagariBold, fontWeight: 'bold' },
  ]
});

// ─── Colors (sampled directly from the reference image) ───────────────────
const RED      = '#d6262a';  // org name, registration no, amounts, agent text, founder text
const NAVY     = '#1e2938';  // title pill, table header, all borders/grid lines
const GOLDLINE = '#cda44a';  // thin gold ring on emblem (decorative only)
const CREAM    = '#fffdf4';  // page background
const ROWCREAM = '#fdf9e7';  // filled table-row background (pale cream, as in reference)
const FOOTERBG = '#eceef1';  // light grey founder-info bar background
const TEXTGREY = '#333333';

// Rows printed on every receipt page (blank rows pad out the remainder)
const ROWS_PER_PAGE = 10;

// ─── Styles (scaled down for A5) ───────────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    backgroundColor: CREAM,
    fontFamily: 'NotoSansDevanagari',  // swap with 'Helvetica' for testing without Hindi font
    padding: 0,
    fontSize: 8,
  },

  // Double-border wrapper — navy/black double frame (NOT red) as in reference
  outerBorder: {
    border: `2px solid ${NAVY}`,
    padding: 5,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  innerBorder: {
    border: `1px solid ${NAVY}`,
    padding: 7,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },

  // ── Header ──────────────────────────────────────────────────────────────
  headerRow: {
    height: 70,
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 3,
  },
  logoOuter: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: NAVY,
    border: `1.5px solid ${GOLDLINE}`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e9a23b',
    border: `1px solid ${RED}`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImg: { width: 44, height: 44, borderRadius: 22 },
  logoLine: { fontSize: 4.6, color: '#fff', textAlign: 'center', fontWeight: 'bold', lineHeight: 1.1 },
  centerCol: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  orgName:   { fontSize: 15, fontWeight: 'bold', color: RED, marginBottom: 2, textAlign: 'center' },
  orgAddr:   { fontSize: 6.8, color: '#000', textAlign: 'center', marginBottom: 1 },
  regText:   { fontSize: 7, color: RED, fontWeight: 'bold' },

  // ── Title pill ──────────────────────────────────────────────────────────
  titleBox: {
    backgroundColor: NAVY,
    borderRadius: 11,
    paddingVertical: 4,
    paddingHorizontal: 22,
    alignSelf: 'center',
    marginTop: 7,
    marginBottom: 7,
  },
  titleText: { fontSize: 11, color: '#fff', fontWeight: 'bold' },

  // ── Meta info ───────────────────────────────────────────────────────────
  metaSection: { flexDirection: 'row', marginBottom: 6 },
  metaLeft:    { flex: 1.32 },
  metaRight:   { flex: 1 },
  metaRow:     { flexDirection: 'row', marginBottom: 4.5, alignItems: 'flex-start' },
  metaLabel:   { fontSize: 7.5, fontWeight: 'bold', color: TEXTGREY, width: 68 },
  metaValue:   { fontSize: 7.5, color: '#000', fontWeight: 'bold', flex: 1 },
  metaLabelR:  { fontSize: 7.5, fontWeight: 'bold', color: TEXTGREY, width: 62 },
  metaValueR:  { fontSize: 7.5, color: '#000', fontWeight: 'bold', flex: 1 },
  metaSpacer:  { height: 15.5 },

  // ── Table ───────────────────────────────────────────────────────────────
  tableWrap: {
    border: `1px solid ${NAVY}`,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: NAVY,
    paddingVertical: 4.5,
  },
  tableHCell: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 7,
    paddingHorizontal: 3,
    borderRightWidth: 0.75,
    borderRightColor: '#5a6678',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.75,
    borderBottomColor: NAVY,
    minHeight: 20,
    backgroundColor: '#ffffff',
  },
  tableRowFilled: { backgroundColor: ROWCREAM },
  tableRowLast: { borderBottomWidth: 0 },
  tableCell: {
    fontSize: 6.8,
    paddingHorizontal: 3,
    paddingVertical: 3,
    justifyContent: 'center',
    borderRightWidth: 0.75,
    borderRightColor: NAVY,
  },
  tableCellLast: { borderRightWidth: 0 },

  // Column widths
  cSerial: { width: '8%',  alignItems: 'center' },
  cCode:   { width: '10%', alignItems: 'center' },
  cName:   { width: '56%' },
  cPhone:  { width: '14%', alignItems: 'center' },
  cDate:   { width: '12%', alignItems: 'center' },

  // ── Amount & agent ──────────────────────────────────────────────────────
  totalSection: {
    flexDirection: 'row',
    marginTop: 6,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'stretch',
    border: `1.3px solid ${RED}`,
    borderRadius: 3,
    overflow: 'hidden',
  },
  rupeeChip: {
    backgroundColor: RED,
    paddingVertical: 4,
    paddingHorizontal: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rupeeSign:  { fontSize: 11, fontWeight: 'bold', color: '#fff' },
  amountChip: {
    backgroundColor: '#fff',
    paddingVertical: 4,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  amountText: { fontSize: 11, fontWeight: 'bold', color: RED },
  amountCol:  { flexDirection: 'column', alignItems: 'flex-start' },
  amountCaption: { fontSize: 6.5, color: TEXTGREY, fontWeight: 'bold', marginBottom: 1.5 },
  grandTotalText: { fontSize: 7.5, color: RED, fontWeight: 'bold', marginTop: 2 },
  agentBox:   { alignItems: 'flex-end' },
  agentLabelRow: { flexDirection: 'row' },
  agentLabel: { fontSize: 7, color: '#000' },
  agentName:  { fontSize: 8, color: RED, fontWeight: 'bold' },
  agentPhone: { fontSize: 7.5, color: RED, fontWeight: 'bold' },

  // ── Footer ──────────────────────────────────────────────────────────────
  // Light grey bar with thin navy rules top & bottom — matches reference
  founderBar: {
    backgroundColor: FOOTERBG,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 5,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: NAVY,
    borderBottomColor: NAVY,
  },
  founderText: { fontSize: 7.5, color: RED, fontWeight: 'bold', textAlign: 'center' },
  noteText:    { fontSize: 6.8, color: '#444', marginTop: 4, textAlign: 'center' },

  signRow:     { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', marginTop: 4 },
  stampWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    border: `1.3px solid ${RED}`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  stampImg: { width: 34, height: 34, borderRadius: 17 },
  stampText: { fontSize: 4.3, color: RED, textAlign: 'center', fontWeight: 'bold', lineHeight: 1.1 },
  signatureImg: { width: 70, height: 32 },
  signName:    { fontSize: 11, color: '#1a1a1a', textAlign: 'right', },
  signLabel:   { fontSize: 6.8, color: '#444', textAlign: 'right', marginTop: 1 },

  // Used when only ONE combined stamp+signature image is supplied
  // (e.g. signatureSrc holds a scan that already has both the round
  // stamp and the handwritten signature in it) — shown alone, no circle.
  signRowSingle: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    marginTop: -22,   // lets the round stamp overlap the founder bar, as in the reference
  },
  combinedStampSignImg: {
    width: 110,
    height: 62,
    objectFit: 'contain',
  },

  topGroup: { flexDirection: 'column' },
  bottomGroup: { flexDirection: 'column' },
headerImg:{
  height:'100%',
  width:'100%',
  objectFit:'fill'
},
  pageNumRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  pageNumText: { fontSize: 6.8, color: '#000', fontWeight: 'bold' },
});

// ─── Reusable round emblem (used for both header logos) ───────────────────
const Emblem = ({ logoSrc }) => (
  logoSrc
    ? <Image src={logoSrc} style={styles.logoImg} />
    : (
      <View style={styles.logoOuter}>
        <View style={styles.logoInner}>
          <Text style={styles.logoLine}>{''}</Text>
        </View>
      </View>
    )
);

// ─── रसीद न. formatter ─────────────────────────────────────────────────────
// Serial is zero-padded to 4 digits so receipts sort and read consistently
// (0001, 0002 … 0142). An optional prefix can namespace a batch, e.g. "MG/0001".
const formatReceiptNo = (seq, prefix = '') => {
  const padded = String(seq).padStart(4, '0');
  return prefix ? `${prefix}${padded}` : padded;
};

// ─── Name cell builder ─────────────────────────────────────────────────────
// Format: "सुरेश जी /मोहन लाल जी कोरना राजस्थान (वारिसदार: सीता देवी पत्नी)"
//          name    /father        village state  (heir name + relation)
// holderLabel is 'हकदार' for the Mamera program, 'वारिसदार' otherwise.
const buildRowName = (row = {}, holderLabel = 'वारिसदार') => {
  if (!row.name && !row.fatherName) return '';
  const head = row.fatherName ? `${row.name || ''} /${row.fatherName}` : (row.name || '');
  const place = [row.address, row.state].filter(Boolean).join(' ');
  const heir = [row.guardianRelation].filter(Boolean).join(' ');
  const holder = row.guardian ? `(${holderLabel}: ${heir})` : '';
  return [head, place, holder].filter(Boolean).join(' ');
};

// ─── Single Receipt Page ───────────────────────────────────────────────────
const ReceiptPage = ({ receiptData, pageData, programInfo, paymentStatus = 'pending' }) => {
  const isPaid = paymentStatus === 'paid';
  const {
    receiptNo, date, memberNo, mobile, memberName,
    address, kist, district,state,
    guardian, guardianRelation, applicationNumber, registrationNumber,
    agentName, agentPhone, founder, logoSrc, signatureSrc, stampSrc,
  } = receiptData;
  const trust = receiptData.trust || normalizeTrust({});

  // सदस्य क्रमांक — prefer the application number, fall back to the registration number
  const memberCode =
    applicationNumber || memberNo || registrationNumber || '-';

  // हकदार / वारिसदार — guardian name followed by the relation (e.g. "शोभा देवी बहिन")
  const holderLabel = programInfo?.isMamera ? 'हकदार:' : 'वारिसदार:';
  const holder = [guardian, guardianRelation].filter(Boolean).join(' ') || '-';

  return (
    <Page size="A5" style={styles.page}>
      <View style={styles.outerBorder}>
        <View style={styles.innerBorder}>
          <View style={styles.topGroup}>

          {/* ── Header ── */}
          <View style={styles.headerRow}>
            <PdfTrustHeader height={66} TrustData={receiptData.trust} noMargin />
          </View>

          {/* ── Title ── (pending keeps the plain reference wording; paid is tagged) */}
          <View style={styles.titleBox}>
            <Text style={styles.titleText}>
              {(programInfo && programInfo.hiname) || 'विवाह'} मेमो{isPaid ? ' (भुगतान)' : ''}
            </Text>
          </View>

          {/* ── Meta Info ── */}
          <View style={styles.metaSection}>
            <View style={styles.metaLeft}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>रसीद न.:</Text>
                <Text style={styles.metaValue}>{receiptNo}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>सदस्य क्रमांक:</Text>
                <Text style={styles.metaValue}>{memberCode}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>नाम:</Text>
                <Text style={styles.metaValue}>{memberName}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>निवास स्थान:</Text>
                <Text style={styles.metaValue}>{address}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>किस्त:</Text>
                <Text style={styles.metaValue}>{kist}</Text>
              </View>
            </View>

            <View style={styles.metaRight}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabelR}>दिनांक:</Text>
                <Text style={styles.metaValueR}>{date}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabelR}>मोबाइल नं:</Text>
                <Text style={styles.metaValueR}>{mobile}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabelR}>{holderLabel}</Text>
                <Text style={styles.metaValueR}>{holder}</Text>
              </View>
              <View style={styles.metaSpacer} />
              <View style={styles.metaRow}>
                <Text style={styles.metaLabelR}>जिला & राज्य:</Text>
                <Text style={styles.metaValueR}>
                  {[district, state && `(${state})`].filter(Boolean).join(' ') || '-'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Table ── */}
          <View style={styles.tableWrap}>
            {/* Header Row */}
            <View style={styles.tableHeader}>
              <View style={[styles.cSerial, styles.tableHCell]}>
                <Text style={{ textAlign: 'center' }}>क्र.स.</Text>
              </View>
              <View style={[styles.cCode, styles.tableHCell]}>
                <Text style={{ textAlign: 'center' }}>कोड न</Text>
              </View>
              <View style={[styles.cName, styles.tableHCell]}>
                <Text style={{ textAlign: 'center' }}>नाम</Text>
              </View>
              <View style={[styles.cPhone, styles.tableHCell]}>
                <Text style={{ textAlign: 'center' }}>मोबाइल न.</Text>
              </View>
              <View style={[styles.cDate, styles.tableHCell, styles.tableCellLast]}>
                <Text style={{ textAlign: 'center' }}>दिनांक</Text>
              </View>
            </View>

            {/* Data Rows — always ROWS_PER_PAGE rows, blanks pad out the remainder */}
            {pageData.rows.map((row, i) => {
              const isFilled = Boolean(row.name || row.regNo || row.phone);
              return (
                <View
                  key={i}
                  style={[
                    styles.tableRow,
                    isFilled ? styles.tableRowFilled : {},
                    i === pageData.rows.length - 1 ? styles.tableRowLast : {},
                  ]}
                >
                  <View style={[styles.tableCell, styles.cSerial]}>
                    <Text style={{ textAlign: 'center' }}>{row.sr ? String(row.sr) : ''}</Text>
                  </View>
                  <View style={[styles.tableCell, styles.cCode]}>
                    <Text style={{ textAlign: 'center' }}>{row.regNo ? String(row.regNo) : ''}</Text>
                  </View>
                  <View style={[styles.tableCell, styles.cName]}>
                    <Text>{buildRowName(row, programInfo?.isMamera ? 'हकदार' : 'वारिसदार')}</Text>
                  </View>
                  <View style={[styles.tableCell, styles.cPhone]}>
                    <Text style={{ textAlign: 'center' }}>{row.phone || ''}</Text>
                  </View>
                  <View style={[styles.tableCell, styles.cDate, styles.tableCellLast]}>
                    <Text style={{ textAlign: 'center' }}>{row.date || ''}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          </View>

          <View style={styles.bottomGroup}>
          {/* ── Amount & Agent ── */}
          <View style={styles.totalSection}>
            {/* Amount = total of the closed members listed on THIS page.
                When the list runs over several pages, each page shows its own
                योग and the last page also shows the कुल योग of all pages. */}
            <View style={styles.amountCol}>
              {pageData.isMultiPage && (
                <Text style={styles.amountCaption}>
                  इस पृष्ठ का योग ({pageData.pageRowCount} सदस्य)
                </Text>
              )}
              <View style={styles.amountBox}>
                <View style={styles.rupeeChip}>
                  <Text style={styles.rupeeSign}>₹</Text>
                </View>
                <View style={styles.amountChip}>
                  <Text style={styles.amountText}>{pageData.amount}</Text>
                </View>
              </View>
              {pageData.isMultiPage && pageData.isLastPage && (
                <Text style={styles.grandTotalText}>
                  कुल योग ({pageData.totalRowCount} सदस्य): {pageData.grandTotal}
                </Text>
              )}
            </View>
            <View style={styles.agentBox}>
              <View style={styles.agentLabelRow}>
                <Text style={styles.agentLabel}>प्रतिनियुक्त : </Text>
                <Text style={styles.agentName}>{agentName}</Text>
              </View>
              <Text style={styles.agentPhone}>{agentPhone}</Text>
            </View>
          </View>

          {/* ── Founder Bar ── */}
          {founder ? (
            <View style={styles.founderBar}>
              <Text style={styles.founderText}>संथापक : {founder}</Text>
            </View>
          ) : null}
          <Text style={styles.noteText}>
            Note : यह दान स्वेच्छिक है और गैर-वापसी योग्य (Non-Refundable) है।
          </Text>

          {/* ── Stamp + Signature ──
              - If BOTH stampSrc and signatureSrc are given separately,
                show the round stamp + signature image side by side.
              - If only ONE of them is given (your case: a single scan
                with stamp+signature combined, passed as signatureSrc),
                show that single image alone — no extra circle around it.
              - If neither is given, fall back to text placeholders. */}
          {stampSrc && signatureSrc ? (
            <View style={styles.signRow}>
              <View style={styles.stampWrap}>
                <Image src={stampSrc} style={styles.stampImg} />
              </View>
              <View>
                <Image src={signatureSrc} style={styles.signatureImg} />
                <Text style={styles.signLabel}>हस्ताक्षर</Text>
              </View>
            </View>
          ) : (stampSrc || signatureSrc) ? (
            <View style={styles.signRowSingle}>
              <View>
                <Image src={stampSrc || signatureSrc} style={styles.combinedStampSignImg} />
                <Text style={styles.signLabel}>हस्ताक्षर</Text>
              </View>
            </View>
          ) : (
            <View style={styles.signRow}>
              {trust.stampText ? (
                <View style={styles.stampWrap}>
                  <Text style={styles.stampText}>{trust.stampText}</Text>
                </View>
              ) : null}
              <View>
                <Text style={styles.signName}>{trust.signatoryName}</Text>
                <Text style={styles.signLabel}>हस्ताक्षर</Text>
              </View>
            </View>
          )}

          {/* ── Page Number ── */}
          <View style={styles.pageNumRow}>
            <Text style={styles.pageNumText}>रसीद न. {receiptNo}</Text>
            <Text style={styles.pageNumText}>पृष्ठ {pageData.pageNum}</Text>
          </View>
          </View>

        </View>
      </View>
    </Page>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────
/**
 * VivahMemoPDF
 *
 * @param {Object} props
 * @param {Object} props.receiptData  - Header/meta information (see shape below)
 * @param {Array}  props.pages        - Array of page objects (see shape below)
 *
 * receiptData shape:
 * {
 *   receiptNo: '6734',
 *   date: '10-Apr, 2026',
 *   memberNo: '252',                 // fallback for सदस्य क्रमांक
 *   applicationNumber: '343',        // preferred for सदस्य क्रमांक (falls back to memberNo/regNo)
 *   registrationNumber: '252',
 *   guardian: 'शोभा देवी',           // rendered as हकदार: "शोभा देवी बहिन"
 *   guardianRelation: 'बहिन',
 *   mobile: '7401001891',
 *   memberName: 'बंशी लाल / धन्ना राम जी',
 *   address: 'सतलाना, सतलाना',
 *   kist: '300',
 *   district: 'जोधपुर',
 *   state: 'राजस्थान',
 *   agentName: 'सवाई राम धवा',
 *   agentPhone: '6367069841',
 *   founder: 'भागीरथ K. गहलोत 9462860053, 9462304527',
 *   logoSrc: null,        // optional: base64/URL of the round emblem artwork
 *   stampSrc: null,       // optional: base64/URL of the red circular stamp
 *   signatureSrc: null,   // optional: base64/URL of the handwritten signature
 * }
 *
 * pages shape (array):
 * [
 *   {
 *     pageNum: '1/3',
 *     amount: '3000/-',
 *     rows: [
 *       { sr: 1, regNo: 172, name: 'मुकेश भाई', fatherName: 'रामजी',
 *         address: 'कोरना', state: 'राजस्थान', guardian: 'सीता देवी',
 *         phone: '9909753119', date: '08-Mar, 2026' },
 *       // always provide 10 rows; fill missing ones with empty objects {}
 *     ]
 *   },
 *   ...
 * ]
 */
const VivahMemoPDF = ({
  receiptData = {},
  pages = [],
  members,
  agentInfo,
  programInfo,
  TrustData,
  paymentStatus = 'pending',   // 'pending' | 'paid'
  receiptStartNo = 1,          // रसीद न. counter start (continue a receipt book)
  receiptPrefix = '',          // optional prefix, e.g. "MG/" → "MG/0001"
}) => {
  const wantedStatus = paymentStatus === 'paid' ? 'paid' : 'pending';
  const trust = TrustData && TrustData.name !== undefined ? TrustData : normalizeTrust(TrustData);

  // ── Empty state ──
  const emptyDoc = (
    <Document>
      <Page size="A5" style={styles.page}>
        <View style={styles.outerBorder}>
          <View style={styles.innerBorder}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#888' }}>
                {wantedStatus === 'paid'
                  ? 'कोई भुगतान की गई रसीद उपलब्ध नहीं है'
                  : 'कोई बकाया रसीद उपलब्ध नहीं है'}
              </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );

  // ── Mode 2: Payment Report (members array) ──
  if (members && members.length > 0) {
    const currentDate = formatShortDate(new Date());   // 25-04-2025
    const formatCurrency = (amount) => {
      const num = parseFloat(amount || 0);
      return `₹${num.toLocaleString('hi-IN')}`;
    };
    const allPages = [];

    // ── रसीद न. — running serial across this document ──
    // One number per member (not per page): a member whose rows spill onto a
    // second page keeps the same रसीद न. and just shows पृष्ठ 2/2.
    // `receiptStartNo` lets a run continue from a physical receipt book.
    let receiptSeq = Number(receiptStartNo) > 0 ? Math.floor(Number(receiptStartNo)) : 1;

    members.forEach((member, mIdx) => {
      // Only the entries matching the requested status appear on this receipt.
      // A member with nothing in that bucket is skipped entirely — so a fully
      // paid member never shows up on a pending receipt, and vice-versa.
      // Closing list is printed in date order (oldest first). Entries with no
      // usable date fall to the bottom instead of scattering through the list.
      const marriages = sortByDate(
        (member.marriages || []).filter(m => m.status === wantedStatus),
        m => m.marriageDate,
        'asc'
      );
      if (marriages.length === 0) return;

      // Serial is assigned only to members that actually get a receipt, so the
      // numbering has no gaps.
      const receiptNo = formatReceiptNo(receiptSeq++, receiptPrefix);

      const totalAmount = marriages
        .reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
      const memberReceiptData = {
        receiptNo,
        date: currentDate,
        memberNo: member.registrationNumber || 'N/A',
        registrationNumber: member.registrationNumber || 'N/A',
        applicationNumber: member.applicationNumber || '',
        guardian: member.guardian || '',
        guardianRelation: member.guardianRelation || '',
        mobile: member.phone || 'N/A',
        memberName: [member.displayName, member.fatherName].filter(Boolean).join(' / ') || 'N/A',
        fatherName: member.fatherName || '-',
        address:
          [member.currentAddress, member.village].filter(Boolean).join(' , ') ||
          member.address ||
          'N/A',
        kist: member.payAmount,
        // Stored as slugs ("jodhpur"/"rajasthan") — print the Hindi labels
        district: getDistrictLabel(member.district, member.state) || 'राजस्थान',
        state: getStateLabel(member.state),
        // all-agents receipts carry the agent on each member
        agentName: member.agentName || agentInfo?.displayName || agentInfo?.agentName || 'N/A',
        agentPhone: member.agentPhone || agentInfo?.phone || '',
        founder: trust.founder,
        logoSrc: trust.logo || null,
        signatureSrc: trust.stampImg || null,
        trust,
        stampSrc: null,
      };

      const chunks = [];
      for (let i = 0; i < marriages.length; i += ROWS_PER_PAGE) {
        chunks.push(marriages.slice(i, i + ROWS_PER_PAGE));
      }
      if (chunks.length === 0) chunks.push([]);

      chunks.forEach((chunk, chunkIdx) => {
        const totalPages = chunks.length;
        const rows = chunk.map((m, ri) => ({
          sr: chunkIdx * ROWS_PER_PAGE + ri + 1,
          regNo: m.closingRegNo || '-',
          name: m.closingMemberName || m.paymentFor || '-',
          fatherName: m.closingFatherName || '',
          address: m.closingVillage || '',
          state: getStateLabel(m.closingState),
          guardian: m.closingGuardian || '',
          guardianRelation: m.closingGuardianRelation || '',
          phone: m.closingPhone || '-',
          date: formatShortDate(m.marriageDate, '-'),
        }));
        for (let i = rows.length; i < ROWS_PER_PAGE; i++) {
          rows.push({ sr: '', regNo: '', name: '', fatherName: '', address: '', state: '', guardian: '', phone: '', date: '' });
        }

        allPages.push(
          <ReceiptPage
            key={`m${mIdx}-p${chunkIdx}`}
            receiptData={memberReceiptData}
            pageData={{
              pageNum: `${chunkIdx + 1}/${totalPages}`,
              // Page-wise total: only the closings printed on this page
              amount: formatCurrency(
                chunk.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0)
              ),
              pageRowCount: chunk.length,
              grandTotal: formatCurrency(totalAmount),
              totalRowCount: marriages.length,
              isMultiPage: totalPages > 1,
              isLastPage: chunkIdx === totalPages - 1,
              rows,
            }}
            programInfo={programInfo}
            paymentStatus={wantedStatus}
          />
        );
      });
    });

    if (allPages.length === 0) return emptyDoc;
    return <Document>{allPages}</Document>;
  }

  // ── Mode 1: Receipt (original) ──
  if (pages.length === 0) return emptyDoc;
  const normalizedPages = pages.map((page) => {
    const rows = [...(page.rows || [])].slice(0, ROWS_PER_PAGE);
    for (let i = rows.length; i < ROWS_PER_PAGE; i++) {
      rows.push({ sr: i + 1, regNo: '', name: '', fatherName: '', address: '', state: '', guardian: '', phone: '', date: '' });
    }
    return { ...page, rows };
  });

  return (
    <Document>
      {normalizedPages.map((pageData, i) => (
        <ReceiptPage
          key={i}
          receiptData={{ ...receiptData, trust: receiptData.trust || trust }}
          pageData={pageData}
          programInfo={programInfo}
          paymentStatus={wantedStatus}
        />
      ))}
    </Document>
  );
};

export default VivahMemoPDF;


