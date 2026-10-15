import { useSelector } from 'react-redux';
import logo from '@/app/api/helperfile/Images/logo';
import { Drawer } from 'antd'
import React from 'react'
 import { PDFViewer } from '@react-pdf/renderer';
import VivahMemoPDF from './pdfcom/VivahMemoPDF';
import stampImg from '@/app/api/helperfile/Images/stampImg';

export const DUMMY_RECEIPT = {
  receiptNo:  '6734',
  date:       '10-Apr, 2026',
  memberNo:   '252',
  mobile:     '7401001891',
  memberName: 'बंशी लाल',
  fatherName: 'धन्ना राम जी',
  address:    'सतलाना, सतलाना',
  kist:       '300',
  district:   'जोधपुर (राजस्थान)',
  agentName:  'सवाई राम धवा',
  agentPhone: '6367069841',
  founder:    'भागीरथ K. गहलोत 9462860053, 9462304527',
  logoSrc:    logo,       // Pass base64 or URL string of logo image
  signatureSrc: stampImg,     // Pass base64 or URL string of signature image
};
 
export const DUMMY_PAGES = [
  // ── Page 1 of 3 ──
  {
    pageNum: '1/3',
    amount:  '₹3,000/-',
    rows: [
      { sr:1, regNo:'R001', name:'मुकेश भाई', fatherName:'सवाजी', address:'वातम वाव थराद गुजरात',              phone:'9909753119', date:'08-Mar-2026' },
      { sr:2, regNo:'R002', name:'अल्पेश कुमार', fatherName:'मानाजी', address:'कूड़ा वाव थराद गुजरात',         phone:'9723862267', date:'08-Mar-2026' },
      { sr:3, regNo:'R003', name:'भारती बेन', fatherName:'कस्तूर भाई', address:'कूड़ा वाव थराद गुजरात',        phone:'9979747203', date:'08-Mar-2026' },
      { sr:4, regNo:'R004', name:'पियूष कुमार', fatherName:'महादेव भाई', address:'रामसन वाव थराद गुजरात',      phone:'9904459859', date:'09-Mar-2026' },
      { sr:5, regNo:'R005', name:'प्रेरणा कुमारी', fatherName:'पुखराज जी', address:'मांडावास पाली राजस्थान',   phone:'7229923023', date:'11-Mar-2026' },
      { sr:6, regNo:'R006', name:'दीपा बेन', fatherName:'मशराजी', address:'पालडी वाव थराद गुजरात',             phone:'9429720103', date:'11-Mar-2026' },
      { sr:7, regNo:'R007', name:'जेठा राम', fatherName:'भलाराम जी', address:'मांडावास पाली राजस्थान',         phone:'9929644035', date:'11-Mar-2026' },
      { sr:8, regNo:'R008', name:'रीना बेन', fatherName:'चेलाजी', address:'धाणा वाव थराद गुजरात',              phone:'9574889209', date:'12-Mar-2026' },
      { sr:9, regNo:'R009', name:'संजय भाई', fatherName:'नरसिंह भाई', address:'अनापुर वाव थराद गुजरात',       phone:'9726870805', date:'12-Mar-2026' },
      { sr:10, regNo:'R010', name:'प्रकाश कुमार', fatherName:'कालूराम जी', address:'लुणोल सिरोही राजस्थान',    phone:'9076075965', date:'01-Apr-2026' },
    ],
  },
 
  // ── Page 2 of 3 ──
  {
    pageNum: '2/3',
    amount:  '₹3,000/-',
    rows: [
      { sr:1, regNo:'R011', name:'अंजली बोराणा', fatherName:'नरेश जी', address:'लुणोल सिरोही राजस्थान',                      phone:'9067075965', date:'01-Apr-2026' },
      { sr:2, regNo:'R012', name:'खुशबू', fatherName:'भगवानराम जी', address:'झंवर जोधपुर राजस्थान',                       phone:'7401001891', date:'02-Apr-2026' },
      { sr:3, regNo:'R013', name:'परेश भाई', fatherName:'हिरा भाई', address:'शेराउ वाव थराद गुजरात',                        phone:'9879138435', date:'05-Apr-2026' },
      { sr:4, regNo:'R014', name:'भावना', fatherName:'जगदीश जी', address:'अहमदाबाद सिटी अहमदाबाद गुजरात',                phone:'9879138435', date:'05-Apr-2026' },
      { sr:5, regNo:'R015', name:'मुकेश', fatherName:'कपुराराम जी', address:'सिरोही सिरोही राजस्थान',                     phone:'9879138435', date:'05-Apr-2026' },
      { sr:6, regNo:'R016', name:'संगीता बेन', fatherName:'भरत भाई', address:'रूनी वाव थराद गुजरात',                        phone:'9879138435', date:'06-Apr-2026' },
      { sr:7, regNo:'R017', name:'शिल्पा बेन', fatherName:'भरत भाई', address:'रूनी वाव थराद गुजरात',                        phone:'9879138435', date:'06-Apr-2026' },
      { sr:8, regNo:'R018', name:'महेंद्र कुमार', fatherName:'प्रताप जी', address:'मंडार सिरोही राजस्थान',                   phone:'9983045886', date:'10-Apr-2026' },
      { sr:9, regNo:'R019', name:'हीना बेन', fatherName:'गगाजी', address:'सवरखा वाव थराद गुजरात',                            phone:'9510734405', date:'10-Apr-2026' },
      { sr:10, regNo:'R020', name:'रविंद्र कुमार', fatherName:'हीराराम जी', address:'डूगरो का गोलिया जालौर राजस्थान',   phone:'9833401011', date:'17-Apr-2026' },
    ],
  },
 
  // ── Page 3 of 3 (only 6 entries, rows 7-10 are blank) ──
  {
    pageNum: '3/3',
    amount:  '₹1,800/-',
    rows: [
      { sr:1, regNo:'R021', name:'दीपा भाई', fatherName:'नागजी भाई', address:'भलासरा वाव थराद गुजरात',        phone:'9978011358', date:'19-Apr-2026' },
      { sr:2, regNo:'R022', name:'सोभा कुमारी', fatherName:'मांगीलाल जी', address:'मांडावास पाली राजस्थान',   phone:'9828553588', date:'20-Apr-2026' },
      { sr:3, regNo:'R023', name:'गनपत लाल जी', fatherName:'चुन्नीलाल जी', address:'रामा जालौर राजस्थान',   phone:'9158027829', date:'20-Apr-2026' },
      { sr:4, regNo:'R024', name:'रिंकू कुमारी', fatherName:'कल्लाराम जी', address:'नून सिरोही राजस्थान',    phone:'9672904891', date:'20-Apr-2026' },
      { sr:5, regNo:'R025', name:'नगा राम', fatherName:'तलसाराम जी', address:'डबाल जालौर राजस्थान',           phone:'7040402661', date:'20-Apr-2026' },
      { sr:6, regNo:'R026', name:'शिल्पा कुमारी', fatherName:'चम्पालाल जी', address:'जालौर जालौर राजस्थान', phone:'9791345441', date:'20-Apr-2026' },
      // rows 7-10 intentionally empty (auto-padded by component)
    ],
  },
];
 
const VivahMemoDraverView = ({open,setOpen}) => {
  const trust = useSelector((state) => state.data.trustData);

  return (
  <Drawer
  open={open}
  onClose={()=>{
    setOpen(false)
  }}
  width={800}
  >
    <PDFViewer style={{ width: '100%', height: '90vh' }}>
 <VivahMemoPDF receiptData={{ ...DUMMY_RECEIPT, founder: trust?.founder, logoSrc: trust?.logo, signatureSrc: trust?.stampImg, trust }} pages={DUMMY_PAGES} TrustData={trust} />
</PDFViewer>
  </Drawer>
  )
}

export default VivahMemoDraverView