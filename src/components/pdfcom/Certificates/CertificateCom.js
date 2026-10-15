import React from 'react';
import { 
  Document, 
  Page, 
  Text, 
  View, 
  StyleSheet, 
  PDFViewer, 
  Font,
  Image
} from '@react-pdf/renderer';
import '@/lib/pdfDevanagariFix';
import NotoSansDevanagari from '@/app/api/helperfile/static/font/NotoSansDevanagari';
import NotoSansDevanagariBold from '@/app/api/helperfile/static/font/NotoSansDevanagariBold';

import logo from '@/app/api/helperfile/Images/logo';
import { getDistrictStateLabel } from '@/lib/staticData';
// Register Devanagari Font
Font.register({
  family: 'NotoSansDevanagari',
  fonts: [
    {
      src:NotoSansDevanagari ,
      fontWeight: 'normal',
    },
    {
      src: NotoSansDevanagariBold,
      fontWeight: 'bold',
    }
  ]
});

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#faf7ea',
    fontFamily: 'NotoSansDevanagari',
    padding: 10,
    width: '210mm',
    height: '148mm',
  },
  outerBorder: {
    border: '2px solid #d4af37',
    padding: 10,
    height: '100%',
    position: 'relative',
  },
  innerBorder: {
    height: '100%',
    position: 'relative',
  },
  topText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    marginTop: 10,
    paddingHorizontal: 30,

  },
  smallText: {
    fontSize: 10,
    color: '#000',
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 10,
  
  },
  logoImage: {
    width: 68,
    height: 68,
    borderRadius: 4,
  },
  logoImage1: {
    width: 78,
    height: 68,
    borderRadius: 4,
    position: 'absolute',
    left: 10,
     top: 10,
  },
    logoImage2: {
    width: 78,
    height: 68,
    borderRadius: 4,
    position: 'absolute',
    right: 10,
     top: 10,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    marginLeft: 30,
  },
  mainTitle: {
    fontSize: 30,
    color: '#8B0000',
    fontWeight: 'bold',
    marginBottom: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subTitle: {
    fontSize: 13,
    color: '#000',
    fontWeight: 'bold',
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  address: {
    fontSize: 10,
    color: '#884a17',
    textAlign: 'center',
    fontWeight: 'bold',
    marginBottom: 3,
    lineHeight: 1.3,
    paddingHorizontal: 10,
  },
  phoneNumbers: {
    fontSize:10,
    color: '#884a17',
    fontWeight: 'bold',
    marginBottom: 3,
    letterSpacing: 0.2,
  },
  regNotext:{
    fontSize: 9,
    color: '#000',
    fontWeight: 'bold',
    marginBottom: 3,
    letterSpacing: 0.2,
  },
  schemeBox: {
    backgroundColor: '#1a0f5e',
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: 14,
    alignSelf: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  schemeText: {
    fontSize: 16,
    color: '#8B0000',
    fontWeight: 'bold',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  formSection: {
    marginTop: 0,
    paddingHorizontal: 4,
  },

  label: {
    fontSize: 9.5,
    color: '#000',
    marginRight: 4,
    fontWeight: 'normal',
  },
  value: {
    fontSize: 10,
    color: '#000',
    fontWeight: 'bold',
    borderBottom: '1px dotted #000',
    paddingBottom: 2,
    paddingHorizontal: 5,
    minHeight: 16,
    textTransform:'capitalize'
  },
  memberIdBox: {
    position: 'absolute',
    right: 0,
    top: 150,
    border: '1px solid #884a17',
    width: 90,
    height: 100,
    backgroundColor: '#fff',
    borderRadius: 3,
    overflow: 'hidden',
  },
  memberIdText: {
    fontSize: 8,
    textAlign: 'center',
    color: '#666',
    marginTop: 2,
  },
  memberIdLabel: {
    fontSize: 8,
    textAlign: 'center',
    color: '#666',
    paddingTop: 10,
  },
  detailsSection: {
    marginTop: 6,
    fontFamily: 'NotoSansDevanagari',
    fontSize: 8.5,
    color: '#000',
    textAlign: 'justify',
    lineHeight: 1.4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#fafafa',
    borderRadius: 2,
    border: '0.5px solid #ddd',
  },
  footerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // alignItems: 'flex-end',
    // marginTop: 'auto',
    paddingHorizontal: 10,
    paddingTop: 8,
        position:'relative'
  },
  leftFooter: {
    flexDirection: 'column',
    alignItems: 'center',
    width: '45%',
  },
  rightFooter: {
    flexDirection: 'column',
    alignItems: 'center',
    width: '45%',
  },
  footerLabel: {
    fontSize: 9,
    color: '#000',
    marginTop:5,
    fontWeight: 'bold',
  },
  footerValue: {
    fontSize: 9.5,
    color: '#000',
    fontWeight: 'bold',
    borderBottom: '1px dotted #000',
    paddingBottom: 8,
    paddingTop: 1,
    minWidth: 140,
    textAlign: 'center',
    marginTop: 2,
  },
  signatureText: {
    fontSize: 10,
    color: '#000',
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'right',
    borderTop: '1px solid #000',
    paddingTop: 3,
    minWidth: 140,
  },
  serialNumber: {
    position: 'absolute',
    top: -10,
    right: 24,
    fontSize: 10,
    color: '#000',
    fontWeight: 'bold',
    backgroundColor: '#fff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  fieldGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 2,
  },
  watermark: {
    position: 'absolute',
    top: '28mm',
    left: '42mm',
    width: '115mm',
    height: '90mm',
    opacity: 0.08,
    zIndex: 0,
  },
  photoImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  donationHighlight: {
    backgroundColor: '#fff3cd',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 3,
    marginLeft: 2,
  },
  corner: {
  position: 'absolute',
  width: 60,
  height: 60,
},

topLeft: {
  top: -2,
  left: -2,
  borderTop: '3px solid #d4af37',
  borderLeft: '3px solid #d4af37',
},

topRight: {
  top: -2,
  right: -2,
  borderTop: '3px solid #d4af37',
  borderRight: '3px solid #d4af37',
},

bottomLeft: {
  bottom: -2,
  left: -2,
  borderBottom: '3px solid #d4af37',
  borderLeft: '3px solid #d4af37',
},

bottomRight: {
  bottom: -2,
  right: -2,
  borderBottom: '3px solid #d4af37',
  borderRight: '3px solid #d4af37',
},
borderHeader:{
  width: '100%',
  borderBottom: '2px solid #d4af37',
  top:130,
  position: 'absolute',
  left: 0,
},
borderFooter:{
  width: '100%',
  borderBottom: '2px solid #d4af37',
   position: 'absolute',
  left: 0,  bottom: -30,
},
//new form
schemeDateBox:{
  flexDirection:'row',
  justifyContent:'space-between',
},
formFields:{
  alignItems:'center',
  flexDirection:'row',
  gap:5
},
LabelText:{
  fontSize:12,
  color:"#8B0000",
  textAlign:'left'
},
ValueText:{
  fontSize:12,
  color:"#000",
    textAlign:'left'
},
emtypBox:{
  width:100
},
ContentSec:{
  marginTop:10,
  width:'70%'
},

  // Data rows
  dataArea: {
   width:'85%',
    marginTop:5, // leave room for photo
    paddingHorizontal:10,

  },
  row: {
    flexDirection: 'row',
    marginBottom: 5,
    alignItems: 'center',
        gap:5
  },
  fieldGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  labelText: {
    fontSize: 10.5,
    color: '#8B0000',
    fontWeight: 'bold',
    minWidth: 80,
  },
  valueText: {
    fontSize: 10.5,
    color: '#000',
    fontWeight: 'normal',
    paddingBottom: 1,
    flex: 1,
    minWidth: 60,
  },
  // Special: kisht row spans full width
  kishtRow: {
    flexDirection: 'row',
    marginBottom: 5,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap:10
  },
  kishtValue: {
    fontSize: 10.5,
    color: '#000',
    fontWeight: 'bold',
  },
  footerLabelBox1:{
    width:'100%',
    position:'absolute',
    bottom:-25
,
left:0,
textAlign:'center'
  },
  footerLabelBox2:{
        width:'100%',
    position:'absolute',
    bottom:-55
,
left:0,
textAlign:'center'
  },
  signText:{
    position:'absolute',
    right:90,
    bottom:-21,
    fontSize:13,
    color:'#000'
  }
});
const calculateAge = (birthDate) => {
  if (!birthDate) return 'N/A';

  const [day, month, year] = birthDate.split('-').map(Number);
  const dob = new Date(year, month - 1, day);
  const today = new Date();

  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();

  // Adjust if current date is before birth date in the month
  if (today.getDate() < dob.getDate()) {
    months--;
  }

  // If months negative, adjust year and months
  if (months < 0) {
    years--;
    months += 12;
  }

  return `${years} Years ${months} Months`;
};
const Certificate = ({data,selectedProgram,TrustData}) => (
  <Document>
    <Page size={{ width: '210mm', height: '148mm' }} style={styles.page}>
      <View style={styles.outerBorder}>
    {/* Corner Borders */}
          <View style={[styles.borderHeader]} />
        <View style={styles.innerBorder}>
          <View style={[styles.corner, styles.topLeft]} />
<View style={[styles.corner, styles.topRight]} />
<View style={[styles.corner, styles.bottomLeft]} />
<View style={[styles.corner, styles.bottomRight]} />
          {/* Top Text */}
             <View style={styles.topText}>
             {
                    TrustData.topTitle.map((text, index) => (
                      <Text key={index} style={styles.smallText}>{text}</Text>
                    ))
                  }
         
          </View> 

          {/* Watermark */}
          <Image 
            src={TrustData.logo || logo} 
            style={styles.watermark}
          />

          {/* Header Section */}
          <View style={styles.headerSection}>
  <Image 
              src={TrustData.logo || logo}  
              style={styles.logoImage1}
            />
                 <View style={styles.centerContent}>
              <Text style={styles.mainTitle}>{TrustData?.name}</Text>
              <Text style={styles.address}>
           {TrustData?.address}
              </Text>
              <Text style={styles.phoneNumbers}>
         {TrustData?.contact}
              </Text>
               <Text style={styles.regNotext}>
          Regd No. {TrustData?.regNo}
              </Text>
              {/* <View style={styles.schemeBox}>
                <Text style={styles.schemeText}>{selectedProgram?.hiname}</Text>
              </View> */}
            </View>
              <Image 
              src={TrustData.logo || logo}  
              style={styles.logoImage2}
            />

          
          </View>

          {/* Member ID Box */}
          <View style={styles.memberIdBox}>
            {data?.photoURL ? (
              <Image src={data.photoURL} style={styles.photoImage} />
            ) : (
              <View>
                <Text style={styles.memberIdLabel}>सदस्य फोटो</Text>
              </View>
            )}
          </View>

          {/* Form Section */}
          <View style={styles.formSection}>
            {/* Row 1 */}
          
           <View style={styles.schemeDateBox}>
           <View style={styles.emtypBox}></View>
            <Text style={styles.schemeText}>{selectedProgram?.hiname} प्रमाण पत्र</Text>
            <View style={styles.formFields}>
             <Text style={styles.LabelText} >दिनांक :</Text>
             <Text style={styles.ValueText} >{data?.dateJoin}</Text>
            </View>
           </View>
    {/* ── Data rows (left 70%, photo takes right 22%) ── */}
          <View style={styles.dataArea}>

            {/* Row 1 - सदस्यता क्रमांक | जन्मतिथि */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>सदस्यता क्रमांक :</Text>
                <Text style={styles.valueText}>{data?.registrationNumber}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>जन्मतिथि :</Text>
                <Text style={styles.valueText}>{data?.bobDate}</Text>
              </View>
            </View>

            {/* Row 2 - नाम | आधार न */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>नाम :</Text>
                <Text style={styles.valueText}>{data?.displayName}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>आधार न . :</Text>
                <Text style={styles.valueText}>{data?.aadhaarNo}</Text>
              </View>
            </View>

            {/* Row 3 - पिता/पति का नाम | उम्र */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>पिता/पति का नाम :</Text>
                <Text style={styles.valueText}>{data?.fatherName}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>उम्र :</Text>
                <Text style={styles.valueText}>{calculateAge(data.bobDate)}</Text>
              </View>
            </View>

            {/* Row 4 - मोबाइल | वारिस आधार */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>मोबाइल नं . :</Text>
                <Text style={styles.valueText}>{data?.phone}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>वारिस आधार :</Text>
                <Text style={styles.valueText}>{data?.guardianAadharNo || 'xxxxxxxxxxx'}</Text>
              </View>
            </View>

            {/* Row 5 - वारिसदार | सम्बन्ध */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>वारिसदार :</Text>
                <Text style={styles.valueText}>{data?.guardian}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>सम्बन्ध :</Text>
                <Text style={styles.valueText}>{data?.guardianRelation}</Text>
              </View>
            </View>

            {/* Row 6 - गोत्र | निवास स्थान */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>गोत्र :</Text>
                <Text style={styles.valueText}>{data?.gotra}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>निवास स्थान :</Text>
                <Text style={styles.valueText}>{data?.currentAddress}</Text>
              </View>
            </View>

            {/* Row 7 - गांव | जिला & राज्य */}
            <View style={styles.row}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>गांव :</Text>
                <Text style={styles.valueText}>{data?.village}</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>जिला & राज्य :</Text>
                <Text style={styles.valueText}>
                  {getDistrictStateLabel(data?.district, data?.state)}
                </Text>
              </View>
            </View>

            {/* Row 8 - क़िस्त + Org Stamp area */}
            <View style={styles.kishtRow}>
              <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>क़िस्त :</Text>
                <Text style={[styles.valueText,{
                  fontSize:9.5,
                }]}>{data?.payAmount}/- रुपये प्रत्येक {selectedProgram?.isSuraksha?'देहांत':selectedProgram?.isMamera?"मायरा":'विवाह'} पर लागू !</Text>
              </View>
                <View style={styles.fieldGroup}>
                <Text style={styles.labelText}>Agent :</Text>
                <Text style={styles.valueText}>{data?.agentName || data?.addedByName}</Text>
              </View>
        
            </View>

      

          </View>
          {/* ══ end dataArea ══ */}
      

          </View>

          {/* Details Section */}
          {/* {
            selectedProgram?.noteLine && <View style={styles.detailsSection}>
            <Text style={{
            }}>
             {selectedProgram?.noteLine}
            </Text>
          </View>
          } */}
       

          {/* Footer Section */}
          <View style={styles.footerSection}>


          <View style={[styles.borderFooter]} />
            
            {/* Left Side - Karyakarta */}
            {/* <View style={styles.leftFooter}>
              <Text style={styles.footerValue}>{data?.addedByName || '---'} ({data.agentPhone})</Text>
              <Text style={styles.footerLabel}>कार्यकर्ता </Text>
            </View> */}

            {/* Right Side - Signature */}
            {/* <View style={styles.rightFooter}>
              <Text style={styles.footerValue}>राजेंद्र कुमार बाबूलाल घांची</Text>
              <Text style={styles.footerLabel}>संस्थापक</Text>
              <Text style={styles.signatureText}>हस्ताक्षर</Text>
            </View> */}
            <View style={styles.footerLabelBox1}>
              <Text style={{
                fontSize: 13,
                color: '#000'
                }}>
                संस्था में योगदान के लिए आपको सह धन्यवाद
              </Text>
            </View>
{/* 
            <Text style={styles.signText}>
              हस्ताक्षर
            </Text> */}
            <View style={styles.footerLabelBox2}>

            <Text style={{
              fontSize: 12,
              color: '#884a17'
            }}>
              नोट: प्रमाण-पत्र संभाल कर रखें। यह आपकी सदस्यता का आधिकारिक दस्तावेज़ है।
            </Text>
            </View>
          </View>
        </View>
      </View>
    </Page>
  </Document>
);

export default Certificate;