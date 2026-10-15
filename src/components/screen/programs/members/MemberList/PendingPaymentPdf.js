'use client'
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
  pdf
} from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';
import { pdfColors } from '@/lib/constentData';
import PdfHeaderCom from '@/components/screen/agents/agentDetails/component/pdfcom/HeaderCom';
import { getDistrictStateLabel, getStateLabel } from '@/lib/staticData';
import { sortByDate, formatShortDate } from '@/lib/dateUtils';

Font.register({
  family: 'NotoSansDevanagari',
  fonts: [
    { src: NotoSansDevanagari, fontWeight: 'normal' },
    { src: NotoSansDevanagariBold, fontWeight: 'bold' },
  ]
});

const ROWS_PER_PAGE = 15; // Reduced to accommodate header and footer properly

const styles = StyleSheet.create({
  page: {
    backgroundColor: pdfColors.bgColor,
    fontFamily: 'NotoSansDevanagari',
    padding: 14,
    fontSize: 10,
  },
  outerBorder: {
    border: `2px solid ${pdfColors.borderColor}`,
    padding: 5,
    minHeight: '100%',
  },
  innerBorder: {
    border: `1px solid ${pdfColors.borderColor}`,
    padding: 8,
    minHeight: '100%',
  },

  // Header
  topText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  smallText: {
    fontSize: 9,
    color: pdfColors.headingColor,
    fontWeight: 'bold',
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  logoImage: { width: 65, height: 65 },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  mainTitle: {
    fontSize: 24,
    color: pdfColors.headingColor,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  subTitle: {
    fontSize: 11,
    color: '#000',
    fontWeight: 'bold',
    marginBottom: 2,
  },
  address: {
    fontSize: 8,
    color: '#444',
    textAlign: 'center',
    marginBottom: 2,
  },
  phoneNumbers: {
    fontSize: 9,
    color: '#000',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  schemeBox: {
    backgroundColor: pdfColors.schemeColor,
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 12,
  },
  schemeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: 'bold',
  },

  // Member Info Card
  memberCard: {
    flexDirection: 'row',
    backgroundColor: '#fff8f8',
    marginBottom: 10,
    borderRadius: 4,
    border: `1.5px solid ${pdfColors.borderColor}`,
    overflow: 'hidden',
  },
  memberPhotoBox: {
    width: 80,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    borderRight: `1px solid ${pdfColors.borderColor}`,
    padding: 5,
  },
  memberPhotoImg: {
    width: 70,
    height: 75,
    borderRadius: 3,
  },
  memberPhotoPlaceholder: {
    width: 70,
    height: 75,
    backgroundColor: '#e8e8e8',
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    border: '1px dashed #bbb',
  },
  memberPhotoText: {
    fontSize: 8,
    color: '#999',
    textAlign: 'center',
  },
  memberDetails: {
    flex: 1,
    padding: 8,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingBottom: 4,
    borderBottom: '1px solid #f0d9a0',
  },
  memberName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: pdfColors.headingColor,
  },
  memberRegBadge: {
    backgroundColor: pdfColors.regBadgeColor || '#1a0f5e',
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  memberRegText: {
    fontSize: 8,
    color: '#fff',
    fontWeight: 'bold',
  },
  memberInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  memberInfoGridItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  memberInfoLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#555',
    marginRight: 3,
    minWidth: 52,
  },
  memberInfoValue: {
    fontSize: 8,
    color: pdfColors.infoValueColor || '#000',
    fontWeight: 'bold',
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    backgroundColor: pdfColors.statsColor || '#8B0000',
    borderRadius: 3,
    padding: 5,
    justifyContent: 'space-around',
    marginTop: 4,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 7,
    color: '#ffccc7',
    marginBottom: 1,
  },
  statValue: {
    fontSize: 10,
    color: '#fff',
    fontWeight: 'bold',
  },

  // Table
  tableSectionTitle: {
    fontSize: 10,
    color: pdfColors.headingColor,
    fontWeight: 'bold',
    marginBottom: 4,
    paddingBottom: 2,
    borderBottom: `1.5px solid ${pdfColors.borderColor}`,
    textAlign: 'center',
  },

  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#d9d9d9',
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: pdfColors.schemeColor || '#8B0000',
  },
  tableRow: {
    flexDirection: 'row',
    minHeight: 22,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e8e8e8',
  },
  tableRowAlt: { backgroundColor: '#fafafa' },
  tableRowEmpty: { backgroundColor: '#fdfdfd' },
  tableCell: {
    paddingVertical: 4,
    paddingHorizontal: 3,
    fontSize: 8,
    borderRightWidth: 0.5,
    borderRightColor: '#d9d9d9',
    justifyContent: 'center',
  },
  tableHeaderCell: {
    paddingVertical: 5,
    paddingHorizontal: 3,
    fontSize: 8,
    fontWeight: 'bold',
    color: '#fff',
    borderRightWidth: 0.5,
    borderRightColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
  },

  // Column widths
  colSerial:      { width: '6%' },
  colBeneficiary: { width: '28%' },
  colFatherName:  { width: '18%' },
  colRegNo:       { width: '11%' },
  colPhone:       { width: '14%' },
  colDate:        { width: '12%' },
  colAmount:      { width: '11%' },

  textLeft:   { textAlign: 'left' },
  textCenter: { textAlign: 'center' },
  textRight:  { textAlign: 'right' },

  // Summary Box
  summaryBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f0f4ff',
    borderRadius: 5,
    border: `1px solid ${pdfColors.borderColor}`,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#555',
  },
  summaryValue: {
    fontSize: 9,
    fontWeight: 'bold',
    color: pdfColors.infoValueColor || '#000',
  },

  // Notice
  noticeSection: {
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#fff8e1',
    border: `1px solid ${pdfColors.borderColor}`,
    borderRadius: 3,
  },
  noticeText: {
    fontSize: 7,
    color: '#5d4037',
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 1.2,
  },

  // Footer
  footer: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 7,
    color: '#8c8c8c',
    borderTop: `0.5px solid ${pdfColors.borderColor}`,
    paddingTop: 3,
  },
});

const SingleMemberPendingPaymentPdf = ({
  memberData,
  paymentReport,
  programInfo = {},
  TrustData,
  paymentStatus = 'pending',   // 'pending' | 'paid'
  closingGroupName = null,     // set when a closing-group filter is active
}) => {
  if (!memberData || !paymentReport) return null;

  const { report } = paymentReport;
  const member = memberData;

  // ── Which bucket are we printing? ──
  const isPaid = paymentStatus === 'paid';
  const wantedStatus = isPaid ? 'paid' : 'pending';

  const L = isPaid
    ? {
        reportTitle: 'भुगतान रसीद',
        tableTitle: 'भुगतान विवरण',
        countLabel: 'भुगतान',
        amountLabel: 'भुगतान राशि',
        summaryCount: 'कुल भुगतान समापन:',
        summaryAmount: 'कुल भुगतान राशि:',
        emptyTitle: 'कोई भुगतान नहीं हुआ है',
        emptyBody: 'इस सदस्य का कोई भी भुगतान दर्ज नहीं है',
        amountColor: '#237804',
      }
    : {
        reportTitle: 'बकाया भुगतान रिपोर्ट',
        tableTitle: 'बकाया भुगतान विवरण',
        countLabel: 'बकाया',
        amountLabel: 'बकाया राशि',
        summaryCount: 'कुल बकाया समापन:',
        summaryAmount: 'कुल बकाया राशि:',
        emptyTitle: 'कोई बकाया भुगतान नहीं है',
        emptyBody: 'इस सदस्य का कोई भी भुगतान बकाया नहीं है',
        amountColor: '#cf1322',
      };

  // Only the marriages matching the requested status are printed — a member
  // with nothing in that bucket gets the "nothing here" page instead.
  const allMarriages = report.marriages || [];
  // Printed in date order (oldest first); undated rows go last.
  const pendingMarriages = sortByDate(
    allMarriages.filter(m => m.status === wantedStatus),
    m => m.marriageDate,
    'asc'
  );

  // Summary for the selected bucket
  const pendingSummary = {
    totalPending: pendingMarriages.length,
    totalPendingAmount: pendingMarriages.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0),
    totalMarriages: report.summary?.totalMarriages || 0,
    paidMarriages: report.summary?.paidMarriages || 0,
    paidAmount: report.summary?.paidAmount || 0
  };

  const currentDate = formatShortDate(new Date());   // 25-04-2025
  const currentTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit'
  });

  const formatCurrency = (amount) => {
    const num = parseFloat(amount || 0);
    return `₹${num.toLocaleString('hi-IN')}`;
  };

  // ── Member identity ──
  // Prefer the application number; fall back to the registration number.
  const hasAppNo = Boolean(member.applicationNumber);
  const memberCode = member.applicationNumber || member.registrationNumber || 'N/A';
  const memberCodeLabel = hasAppNo ? 'आवेदन नं.' : 'रजि.';

  // Full name — "नाम / पिता का नाम"
  const memberFullName =
    [member.displayName, member.fatherName].filter(Boolean).join(' / ') || 'N/A';

  // हकदार (Mamera) vs वारिसदार (all other programs)
  const holderLabel = programInfo?.isMamera ? 'हकदार:' : 'वारिसदार:';
  const holderValue =
    [member.guardian, member.guardianRelation].filter(Boolean).join(' ') || 'N/A';

  // Stored as slugs ("jodhpur"/"rajasthan") — print the Hindi labels
  const districtState = getDistrictStateLabel(member.district, member.state) || 'N/A';

  // Beneficiary name for a payment row — "नाम / पिता गाँव"
  const buildBeneficiaryName = (m = {}) => {
    const name = m.closingMemberName || m.paymentFor || '-';
    const place = [m.closingVillage, getStateLabel(m.closingState)].filter(Boolean).join(' ');
    return [name, place].filter(Boolean).join(' , ');
  };

  // Get status in Hindi
  const getStatusHindi = (status) => {
    return status === 'paid' ? 'भुगतान किया' : 'बकाया';
  };

  // Split pending marriages into chunks for multiple pages
  const chunks = [];
  for (let i = 0; i < pendingMarriages.length; i += ROWS_PER_PAGE) {
    chunks.push(pendingMarriages.slice(i, i + ROWS_PER_PAGE));
  }
  
  // If no pending marriages, create one empty chunk
  if (chunks.length === 0) {
    chunks.push([]);
  }

  // Render page header
  const renderPageHeader = () => (
    <>
      <View style={styles.topText}>
      {
        TrustData.topTitle.map((text, index) => (
          <Text key={index} style={styles.smallText}>{text}</Text>
        ))
      }
      </View>
      <View style={styles.headerSection}>
        {TrustData.RightLogo ? <Image src={TrustData.RightLogo} style={styles.logoImage} /> : <View style={styles.logoImage} />}
        <View style={styles.centerContent}>
          <Text style={styles.mainTitle}>{TrustData.name}</Text>
          {
           TrustData.cityState && <Text style={styles.subTitle}>{TrustData.cityState}</Text> 
          }
          <Text style={styles.address}>{TrustData.address}</Text>
          <Text style={styles.phoneNumbers}>{TrustData.contact}</Text>
          <View style={styles.schemeBox}>
            <Text style={styles.schemeText}>
              {L.reportTitle}{closingGroupName ? ` · ${closingGroupName}` : ''}
            </Text>
          </View>
        </View>
        {TrustData.logo ? <Image src={TrustData.logo} style={[styles.logoImage, { width: 80 }]} /> : <View style={[styles.logoImage, { width: 80 }]} />}
      </View>
    </>
  );

  // Render member card
  const renderMemberCard = () => (
    <View style={styles.memberCard}>
      <View style={styles.memberPhotoBox}>
        {member.photoURL ? (
          <Image src={member.photoURL} style={styles.memberPhotoImg} />
        ) : (
          <View style={styles.memberPhotoPlaceholder}>
            <Text style={styles.memberPhotoText}>{'फोटो\nनहीं'}</Text>
          </View>
        )}
      </View>

      <View style={styles.memberDetails}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName}>
            {memberFullName}
          </Text>
          <View style={styles.memberRegBadge}>
            <Text style={styles.memberRegText}>{memberCodeLabel} {memberCode}</Text>
          </View>
        </View>

        <View style={styles.memberInfoGrid}>
          <View style={styles.memberInfoGridItem}>
            <Text style={styles.memberInfoLabel}>पिता/पति:</Text>
            <Text style={styles.memberInfoValue}>{member.fatherName || 'N/A'}</Text>
          </View>
          <View style={styles.memberInfoGridItem}>
            <Text style={styles.memberInfoLabel}>फोन:</Text>
            <Text style={styles.memberInfoValue}>{member.phone || 'N/A'}</Text>
          </View>
          <View style={styles.memberInfoGridItem}>
            <Text style={styles.memberInfoLabel}>{holderLabel}</Text>
            <Text style={styles.memberInfoValue}>{holderValue}</Text>
          </View>
          <View style={styles.memberInfoGridItem}>
            <Text style={styles.memberInfoLabel}>गाँव:</Text>
            <Text style={styles.memberInfoValue}>{member.village || 'N/A'}</Text>
          </View>
          <View style={styles.memberInfoGridItem}>
            <Text style={styles.memberInfoLabel}>जिला & राज्य:</Text>
            <Text style={styles.memberInfoValue}>{districtState}</Text>
          </View>
          <View style={styles.memberInfoGridItem}>
            <Text style={styles.memberInfoLabel}>योजना:</Text>
            <Text style={styles.memberInfoValue}>{member.programName || programInfo?.name || 'N/A'}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>कुल समापन</Text>
            <Text style={styles.statValue}>{pendingSummary.totalPending || 0}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{L.countLabel}</Text>
            <Text style={styles.statValue}>{pendingSummary.totalPending}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{L.amountLabel}</Text>
            <Text style={styles.statValue}>{formatCurrency(pendingSummary.totalPendingAmount)}</Text>
          </View>
        </View>
      </View>
    </View>
  );

  // Render payment table (only pending payments)
  const renderPaymentTable = (data, startIndex, pageChunkIndex, totalChunks) => {
    const isLastPage = pageChunkIndex === totalChunks - 1;
    
    return (
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <View style={[styles.tableHeaderCell, styles.colSerial]}>
            <Text style={styles.textCenter}>क्र.</Text>
          </View>
         
          <View style={[styles.tableHeaderCell, styles.colBeneficiary]}>
            <Text style={styles.textLeft}>नाम</Text>
          </View>
          <View style={[styles.tableHeaderCell, styles.colFatherName]}>
            <Text style={styles.textLeft}>पिता/पति</Text>
          </View>
          <View style={[styles.tableHeaderCell, styles.colRegNo]}>
            <Text style={styles.textCenter}>रजि. नं.</Text>
          </View>
          <View style={[styles.tableHeaderCell, styles.colPhone]}>
            <Text style={styles.textCenter}>मोबाइल न.</Text>
          </View>
           <View style={[styles.tableHeaderCell, styles.colDate]}>
            <Text style={styles.textCenter}>तिथि</Text>
          </View>
          <View style={[styles.tableHeaderCell, styles.colAmount, { borderRightWidth: 0 }]}>
            <Text style={styles.textRight}>राशि</Text>
          </View>
        </View>

        {data.map((marriage, index) => (
          <View
            key={marriage.paymentId || index}
            style={[styles.tableRow, (startIndex + index) % 2 === 1 && styles.tableRowAlt]}
          >
            <View style={[styles.tableCell, styles.colSerial]}>
              <Text style={styles.textCenter}>{startIndex + index + 1}</Text>
            </View>
           
            <View style={[styles.tableCell, styles.colBeneficiary]}>
              <Text style={styles.textLeft}>{buildBeneficiaryName(marriage)}</Text>
            </View>
            <View style={[styles.tableCell, styles.colFatherName]}>
              <Text style={styles.textLeft}>{marriage.closingFatherName || '-'}</Text>
            </View>
            <View style={[styles.tableCell, styles.colRegNo]}>
              <Text style={styles.textCenter}>{marriage.closingRegNo || '-'}</Text>
            </View>
            <View style={[styles.tableCell, styles.colPhone]}>
              <Text style={styles.textCenter}>{marriage.closingPhone || '-'}</Text>
            </View>
             <View style={[styles.tableCell, styles.colDate]}>
              <Text style={styles.textCenter}>{formatShortDate(marriage.marriageDate, '-')}</Text>
            </View>
            <View style={[styles.tableCell, styles.colAmount, { borderRightWidth: 0 }]}>
              <Text style={[styles.textRight, { color: L.amountColor }]}>
                {formatCurrency(marriage.amount)}
              </Text>
            </View>
          </View>
        ))}

        {/* Empty filler rows to maintain layout */}
        {data.length < ROWS_PER_PAGE && Array.from({ length: ROWS_PER_PAGE - data.length }).map((_, i) => (
          <View key={`empty-${i}`} style={[styles.tableRow, styles.tableRowEmpty]}>
            <View style={[styles.tableCell, styles.colSerial]}><Text> </Text></View>
            <View style={[styles.tableCell, styles.colBeneficiary]}><Text> </Text></View>
            <View style={[styles.tableCell, styles.colFatherName]}><Text> </Text></View>
            <View style={[styles.tableCell, styles.colRegNo]}><Text> </Text></View>
            <View style={[styles.tableCell, styles.colPhone]}><Text> </Text></View>
            <View style={[styles.tableCell, styles.colDate]}><Text> </Text></View>
            <View style={[styles.tableCell, styles.colAmount, { borderRightWidth: 0 }]}><Text> </Text></View>
          </View>
        ))}
      </View>
    );
  };

  // Build all pages
  const allPages = [];

  // If no pending marriages, show message
  if (pendingMarriages.length === 0) {
    allPages.push(
      <Page key="no-pending" size="A4" style={styles.page}>
        <View style={styles.outerBorder}>
          <View style={styles.innerBorder}>
            {/* {renderPageHeader()} */}
           <PdfHeaderCom TrustData={TrustData}/>
            {renderMemberCard()}
            
            <View style={{ padding: 30, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: '#8B0000', marginBottom: 10 }}>{L.emptyTitle}</Text>
              <Text style={{ fontSize: 10, color: '#666' }}>{L.emptyBody}</Text>
            </View>

            <View style={styles.noticeSection}>
              <Text style={styles.noticeText}>
                यह दान स्वेच्छिक रूप से दिया गया है और किसी भी कारणवश इसकी वापसी नहीं की जाएगी।
              </Text>
            </View>

            <View style={styles.footer}>
              <Text style={{ flex: 1 }}>{member.displayName} ({memberCode})</Text>
              <Text style={{ flex: 1, textAlign: 'center' }}>पृष्ठ 1</Text>
              <Text style={{ flex: 1, textAlign: 'right' }}>{currentDate}</Text>
            </View>
          </View>
        </View>
      </Page>
    );
  } else {
    // Main payment pages for pending marriages
    chunks.forEach((chunk, chunkIndex) => {
      const startIndex = chunkIndex * ROWS_PER_PAGE;
      const isLastPage = chunkIndex === chunks.length - 1;

      allPages.push(
        <Page key={`page-${chunkIndex + 1}`} size="A4" style={styles.page} wrap>
          <View style={styles.outerBorder}>
            <View style={styles.innerBorder}>
              {/* {renderPageHeader()} */}
            <PdfHeaderCom TrustData={TrustData}/>
              
              {/* Member card only on first page */}
              {chunkIndex === 0 && renderMemberCard()}

              <Text style={styles.tableSectionTitle}>
                {L.tableTitle}
                {closingGroupName ? ` — समापन ग्रुप: ${closingGroupName}` : ''}
                {chunks.length > 1 ? ` (पृष्ठ ${chunkIndex + 1}/${chunks.length})` : ''}
              </Text>

              {renderPaymentTable(chunk, startIndex, chunkIndex, chunks.length)}

              {/* Summary for last page */}
              {isLastPage && (
                <View style={styles.summaryBox}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{L.summaryCount}</Text>
                    <Text style={[styles.summaryValue, { color: L.amountColor }]}>
                      {pendingSummary.totalPending}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{L.summaryAmount}</Text>
                    <Text style={[styles.summaryValue, { color: L.amountColor, fontSize: 10 }]}>
                      {formatCurrency(pendingSummary.totalPendingAmount)}
                    </Text>
                  </View>
                
                </View>
              )}

              <View style={styles.noticeSection}>
                <Text style={styles.noticeText}>
                  यह दान स्वेच्छिक रूप से दिया गया है और किसी भी कारणवश इसकी वापसी नहीं की जाएगी।
                </Text>
              </View>

              <View style={styles.footer}>
                <Text style={{ flex: 1 }}>{member.displayName} ({memberCode})</Text>
                <Text style={{ flex: 1, textAlign: 'center' }}>पृष्ठ {chunkIndex + 1}</Text>
                <Text style={{ flex: 1, textAlign: 'right' }}>{currentDate}</Text>
              </View>
            </View>
          </View>
        </Page>
      );
    });
  }

  return <Document>{allPages}</Document>;
};

export default SingleMemberPendingPaymentPdf;