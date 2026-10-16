// Certificate builder — the data model (ported from gsmsy-web-panel).
//
// A template says WHERE every piece of text sits on the trust's printed frame artwork.
// Every coordinate is in ARTWORK PIXELS (the natural pixel size of the frame image), so a
// template is resolution-independent: the PDF scales art-pixels → PDF points, the builder
// scales art-pixels → screen pixels, with the same maths — what is dragged on screen prints.
//
// Pure data + pure functions: imported by the builder (browser), the certificate PDF
// (browser and server) and the API. No db, no window.
import { getStateLabel, getDistrictLabel } from "./staticData.js";

/* ── Element types ───────────────────────────────────────────────────────────
   text   printed label            → text
   field  value from member data   → fieldKey (+ prefix/suffix/fallback)
   box    rectangle / band / pill  → optional text or fieldKey, centred
   image  photo from data          → fieldKey (member photo, trust logo, trust stamp)
   picture uploaded image          → src (stamp, signature, logo, watermark …), opacity, fit
   Fields may print one character per box (charBoxes = number of boxes) — "0 0 4 7 3".
─────────────────────────────────────────────────────────────────────────── */

export const ELEMENT_TYPES = [
  { value: 'text', label: 'टेक्स्ट (लेबल)' },
  { value: 'field', label: 'फ़ील्ड (सदस्य डेटा)' },
  { value: 'box', label: 'बॉक्स / बैंड / पिल' },
  { value: 'image', label: 'फोटो स्लॉट' },
  { value: 'picture', label: 'इमेज (मुहर / हस्ताक्षर / लोगो)' },
];

/** image fields (for `image` elements) */
export const IMAGE_FIELDS = [
  { key: 'photoURL', label: 'सदस्य फोटो / Member photo' },
  { key: 'trust.logo', label: 'ट्रस्ट लोगो / Trust logo' },
  { key: 'trust.RightLogo', label: 'दायाँ लोगो / Right logo' },
  { key: 'trust.stampImg', label: 'ट्रस्ट मुहर / Trust stamp' },
  { key: 'verifyQr', label: 'जाँच QR / Verify QR (scan → asli hai ya nahi)' },
];

/* ── Fields the builder offers ───────────────────────────────────────────── */

export const FIELD_GROUPS = [
  {
    group: 'सदस्य (Member)',
    fields: [
      { key: 'displayName', label: 'नाम / Name' },
      { key: 'fatherName', label: 'पिता का नाम / Father' },
      { key: 'bobDate', label: 'जन्मतिथि / DOB' },
      { key: 'age', label: 'उम्र / Age (auto)' },
      { key: 'gotra', label: 'गोत्र / Gotra' },
      { key: 'jati', label: 'जाति / Jati' },
      { key: 'gender', label: 'लिंग / Gender' },
      { key: 'phone', label: 'मोबाइल नं. / Mobile' },
      { key: 'phoneAlt', label: 'दूसरा मोबाइल / Alt mobile' },
      { key: 'aadhaarNo', label: 'आधार न. / Aadhaar' },
      { key: 'photoURL', label: 'फोटो / Photo (image only)' },
    ],
  },
  {
    group: 'पता (Address)',
    fields: [
      { key: 'village', label: 'गाँव / Village' },
      { key: 'district', label: 'जिला / District' },
      { key: 'state', label: 'राज्य / State' },
      { key: 'pinCode', label: 'पिन कोड / Pincode' },
      { key: 'currentAddress', label: 'निवास स्थान / Address' },
      { key: 'districtState', label: 'जिला & राज्य (auto)' },
    ],
  },
  {
    group: 'वारिसदार (Guardian)',
    fields: [
      { key: 'guardian', label: 'वारिसदार / Guardian' },
      { key: 'guardianRelation', label: 'सम्बन्ध / Relation' },
    ],
  },
  {
    group: 'किस्त देने वाला (Payer)',
    fields: [
      { key: 'payer.name', label: 'नाम / Payer name' },
      { key: 'payer.father', label: 'पिता का नाम / Payer father' },
      { key: 'payer.gotra', label: 'गोत्र / Payer gotra' },
      { key: 'payer.village', label: 'गाँव / Payer village' },
      { key: 'payer.district', label: 'जिला / Payer district' },
      { key: 'payer.state', label: 'राज्य / Payer state' },
      { key: 'payer.mobile', label: 'मोबाइल नं. / Payer mobile' },
    ],
  },
  {
    group: 'सदस्यता (Membership)',
    fields: [
      { key: 'memberNo', label: 'सदस्यता क्रमांक (auto)' },
      { key: 'registrationNumber', label: 'पंजीकरण नं. / Registration no.' },
      { key: 'applicationNumber', label: 'आवेदन नं. / Application no.' },
      { key: 'dateJoin', label: 'दिनांक / Join date' },
      { key: 'groupLabel', label: 'ग्रुप लेबल (auto)' },
      { key: 'memberGroup', label: 'ग्रुप / Group' },
      { key: 'locationGroup', label: 'लोकेशन ग्रुप / Location group' },
      { key: 'ageGroupRange', label: 'आयु वर्ग / Age group' },
      { key: 'closingGroupName', label: 'क्लोजिंग ग्रुप / Closing group' },
      { key: 'feeAmount', label: 'शुल्क / Fee (auto)' },
      { key: 'joinFees', label: 'जॉइन फीस / Join fees' },
      { key: 'closingWord', label: 'क्लोजिंग शब्द (मायरा / विवाह / देहांत)' },
    ],
  },
  {
    group: 'कार्यकर्ता / योजना',
    fields: [
      { key: 'agentName', label: 'कार्यकर्ता / Agent name' },
      { key: 'agentCode', label: 'कार्यकर्ता कोड / Agent code' },
      { key: 'agentPhone', label: 'कार्यकर्ता मोबाइल / Agent phone' },
      { key: 'program.hiname', label: 'योजना (हिंदी) / Program hi-name' },
      { key: 'program.name', label: 'योजना / Program name' },
      { key: 'programName', label: 'योजना (सदस्य पर) / Program on member' },
      { key: 'today', label: 'आज की दिनांक / Today' },
    ],
  },
  {
    group: 'ट्रस्ट (Trust — Settings → Organization से)',
    fields: [
      { key: 'trust.name', label: 'ट्रस्ट का नाम / Trust name' },
      { key: 'trust.title1', label: 'ऊपर की पंक्ति 1 (॥ श्री … ॥)' },
      { key: 'trust.title2', label: 'ऊपर की पंक्ति 2' },
      { key: 'trust.title3', label: 'ऊपर की पंक्ति 3' },
      { key: 'trust.cityState', label: 'शहर-राज्य / City, state' },
      { key: 'trust.address', label: 'पता / Address' },
      { key: 'trust.contact', label: 'संपर्क / Contact numbers' },
      { key: 'trust.regNo', label: 'रजि. नं. / Reg. no.' },
      { key: 'trust.govtRegNo', label: 'सरकारी रजि. / Govt. reg. no.' },
      { key: 'trust.email', label: 'ईमेल / Email' },
      { key: 'trust.website', label: 'वेबसाइट / Website' },
      { key: 'trust.trustPresident', label: 'अध्यक्ष / President' },
      { key: 'trust.contactPerson', label: 'संपर्क व्यक्ति / Contact person' },
      { key: 'trust.founder', label: 'संस्थापक / Founder' },
      { key: 'trust.signatoryName', label: 'हस्ताक्षरकर्ता / Signatory' },
    ],
  },
  {
    group: 'अन्य',
    fields: [
      { key: 'bhanjaName', label: 'भांजे / भांजी का नाम' },
      { key: 'groupDate', label: 'ग्रुप दिनांक / Group date' },
    ],
  },
];

export const ALL_FIELDS = [...FIELD_GROUPS.flatMap((g) => g.fields), ...IMAGE_FIELDS.filter((f) => f.key !== 'photoURL')];

export const fieldLabel = (key) => ALL_FIELDS.find((f) => f.key === key)?.label || key;

/* ── Value helpers ───────────────────────────────────────────────────────── */

const PLACEHOLDERS = ['', '-', '--', '—', 'n/a', 'na', 'null', 'undefined', 'nan'];

export const clean = (v) => {
  const s = String(v ?? '').trim();
  return PLACEHOLDERS.includes(s.toLowerCase()) ? '' : s;
};

export const pick = (...vals) => {
  for (const v of vals) {
    const c = clean(v);
    if (c) return c;
  }
  return '';
};

/** Age in whole years between two DD-MM-YYYY strings. */
export const calcAge = (birth, reference) => {
  const [bd, bm, by] = String(birth || '').split('-').map(Number);
  const [rd, rm, ry] = String(reference || '').split('-').map(Number);
  if (!by || !ry) return '';
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age >= 0 ? String(age) : '';
};

/** Epoch ms → DD-MM-YYYY in India time; '' for nothing. */
export const dmyFromMs = (ms) => {
  if (!ms) return '';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata',
    })
    .replace(/\//g, '-');
};

/** What this योजना collects on, in its own words. */
export const closingWordFor = (program) => {
  const words = { isSuraksha: 'देहांत', isMamera: 'मायरा', isVivah: 'विवाह' };
  if (words[program?.category]) return words[program.category];
  const flag = Object.keys(words).find((k) => program?.[k] === true);
  return flag ? words[flag] : 'क्लोजिंग';
};

/** "jodhpur" → "जोधपुर"; values that are already labels come back unchanged. */
const stateText = (v) => clean(getStateLabel(clean(v)));
const districtText = (d, s) => clean(getDistrictLabel(clean(d), clean(s)));

/** The yojna's location group name for a member (MGSF stores only the id on the member). */
const locationGroupName = (d, p) => {
  const id = d.locactionGroupId || d.locationGroupId;
  if (!id) return '';
  const g = (p.locationGroups || []).find((x) => x.id === id);
  return clean(g?.name || g?.label || g?.groupName);
};

/**
 * Flatten member + program into one lookup object, adding the computed fields
 * a template can reference (age, memberNo, payer.*, …).
 *
 * `now` is a parameter so the server can pass one clock for a whole batch.
 */
export const buildContext = (data = {}, program = {}, now = Date.now(), trust = {}) => {
  const d = data || {};
  const p = program || {};
  const tr = trust || {};
  const titles = Array.isArray(tr.topTitle) ? tr.topTitle : [];

  const today = dmyFromMs(now);
  const dateJoin = pick(d.dateJoin, d.joinDate, dmyFromMs(d.joinDateMs));
  const bobDate = pick(d.bobDate, dmyFromMs(d.bobDateMs));

  const memberNo = pick(d.registrationNumber, d.applicationNumber, d.memberNumber);
  const locationGroup = pick(d.locationGroup, locationGroupName(d, p));
  const groupName = pick(d.memberGroup, locationGroup);
  const state = stateText(d.state);
  const district = districtText(d.district, d.state);
  const groupDate = pick(p.groupDate, p.startDate, d.groupDate);

  const groupLabel =
    pick(d.groupLabel) ||
    [groupName ? `ग्रुप - ${groupName}` : '', groupDate ? `(${groupDate})` : '']
      .filter(Boolean)
      .join(' ') ||
    pick(p.hiname, p.name);

  return {
    ...d,
    program: p,
    trust: {
      ...tr,
      name: pick(tr.name),
      title1: pick(titles[0]),
      title2: pick(titles[1]),
      title3: pick(titles[2]),
      RightLogo: tr.RightLogo || tr.logo || '',
    },
    state,
    district,
    locationGroup,
    closingGroupName: pick(d.closingGroupName),
    dateJoin,
    bobDate,
    memberNo,
    groupLabel,
    groupDate,
    today,
    closingWord: closingWordFor(p),
    age: pick(calcAge(bobDate, dateJoin || today), d.age),
    districtState: [district, state].filter(Boolean).join(' - '),
    agentName: pick(d.agentName, d.addedByName),
    agentCode: pick(d.agentCode, d.addedByCode),
    agentPhone: pick(d.agentPhone, d.agentMobile),
    programName: pick(d.programName, p.hiname, p.name),
    feeAmount: pick(d.payAmount, d.mayraAmount, p.payAmount),
    payer: {
      name: pick(d.payerName, d.guardian),
      father: pick(d.payerFatherName, d.guardianFatherName),
      gotra: pick(d.payerGotra, d.gotra),
      village: pick(d.payerVillage, d.village),
      district: pick(d.payerDistrict, district),
      state: pick(d.payerState, state),
      mobile: pick(d.payerMobile, d.phoneAlt, d.phone),
    },
  };
};

/** Read a dot-path ("payer.name") out of the context. */
export const readPath = (ctx, path) => {
  if (!path) return '';
  return String(path)
    .split('.')
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), ctx);
};

/** Final printable string for a `field` (or field-backed `box`) element. */
export const resolveField = (ctx, el) => {
  const raw = clean(readPath(ctx, el?.fieldKey));
  const val = raw || clean(el?.fallback);
  if (!val) return '';
  return `${el?.prefix || ''}${val}${el?.suffix || ''}`;
};

/* ── Element defaults ────────────────────────────────────────────────────── */

export const ELEMENT_DEFAULTS = {
  fontSize: 16.3,
  bold: true,
  color: '#111111',
  align: 'left',
  underline: 'none',
  bg: '',
  border: 0,
  borderColor: '#4a4a4a',
  radius: 0,
  vcenter: false,
  borderStyle: 'solid',
  opacity: 1,
};

/** page background colours the builder suggests */
export const BG_SWATCHES = ['#ffffff', '#fffdf5', '#faf7ea', '#fdf6e3', '#fef3c7', '#fff7ed', '#fdf2f8', '#f0fdf4', '#ecfeff', '#eff6ff', '#f5f3ff', '#f8fafc'];

let uidCounter = 0;
export const newId = (prefix = 'el') =>
  `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

/** Ready-made elements the builder's "जोड़ें" menu drops onto the canvas. */
export const makeElement = (type, at = { x: 200, y: 300 }) => {
  const base = { id: newId(type), type, x: Math.round(at.x), y: Math.round(at.y) };
  switch (type) {
    case 'field':
      return {
        ...base, ...ELEMENT_DEFAULTS,
        fieldKey: 'displayName', w: 160, fontSize: 16.8, color: '#000000', underline: 'dotted',
      };
    case 'box':
      return {
        ...base, ...ELEMENT_DEFAULTS,
        w: 200, h: 34, text: '', align: 'center', vcenter: true, border: 1, radius: 6,
      };
    case 'band':
      return {
        ...base, ...ELEMENT_DEFAULTS, type: 'box', id: newId('box'),
        w: 266, h: 32, text: 'नया बैंड', align: 'center', vcenter: true,
        bg: '#5A0000', color: '#ffffff', radius: 6, fontSize: 16.6,
      };
    case 'pill':
      return {
        ...base, ...ELEMENT_DEFAULTS, type: 'box', id: newId('box'),
        w: 206, h: 34, text: 'ग्रुप - 1', align: 'center', vcenter: true,
        bg: '#ffffff', border: 1, borderColor: '#1a1a1a', radius: 16, fontSize: 16.6,
      };
    case 'image':
      return {
        ...base, ...ELEMENT_DEFAULTS,
        fieldKey: 'photoURL', w: 99, h: 141, border: 1, borderColor: '#4a4a4a',
      };
    case 'trustLogo':
      return { ...base, ...ELEMENT_DEFAULTS, type: 'image', id: newId('image'), fieldKey: 'trust.logo', w: 96, h: 96, fit: 'contain', bg: 'transparent' };
    case 'trustStamp':
      return { ...base, ...ELEMENT_DEFAULTS, type: 'image', id: newId('image'), fieldKey: 'trust.stampImg', w: 110, h: 110, fit: 'contain', bg: 'transparent' };
    case 'verifyQr':
      return { ...base, ...ELEMENT_DEFAULTS, type: 'image', id: newId('image'), fieldKey: 'verifyQr', w: 90, h: 90, fit: 'contain', bg: '#ffffff' };
    case 'picture':
      return { ...base, ...ELEMENT_DEFAULTS, src: at.src || '', w: at.w || 140, h: at.h || 90, fit: 'contain', name: at.name || 'इमेज' };
    case 'line':
      return { ...base, ...ELEMENT_DEFAULTS, type: 'box', id: newId('line'), w: 220, h: 2, bg: '#1f2937', text: '' };
    case 'frame':
      return { ...base, ...ELEMENT_DEFAULTS, type: 'box', id: newId('frame'), x: 18, y: 18, w: 1068, h: 703, border: 3, borderColor: '#8B0000', radius: 10, text: '', bg: '' };
    case 'text':
    default:
      return { ...base, ...ELEMENT_DEFAULTS, type: 'text', text: 'नया टेक्स्ट' };
  }
};

/* ── The approved layout (from the old panel) ────────────────────────────── */

const t = (id, x, y, text, extra = {}) => ({
  id, type: 'text', x, y, text, ...ELEMENT_DEFAULTS, ...extra,
});

const f = (id, x, y, fieldKey, w, extra = {}) => ({
  id, type: 'field', x, y, fieldKey, w,
  ...ELEMENT_DEFAULTS, fontSize: 16.8, color: '#000000', underline: 'dotted',
  ...extra,
});

const ACCENT = '#8B0000';
const TOP = 206;
const ROW_A = 274;
const ROW_B = 311;
const ROW_C = 349;
const ROW_D = 391;
const ROW_E = 464;
const ROW_F = 497;

export const DEFAULT_ELEMENTS = [
  /* सदस्यता क्रमांक · दिनांक */
  t('lbl_memno', 61, TOP, 'सदस्यता क्रमांक', { color: ACCENT, fontSize: 15.9 }),
  f('val_memno', 168, TOP, 'memberNo', 140, { align: 'center', fontSize: 15.9 }),
  t('lbl_date', 877, TOP, 'दिनांक', { color: ACCENT, fontSize: 15.9 }),
  f('val_date', 924, TOP, 'dateJoin', 126, { align: 'center', fontSize: 15.9 }),

  /* ग्रुप pill */
  {
    id: 'pill_group', type: 'box', x: 455, y: 238, w: 206, h: 34, ...ELEMENT_DEFAULTS,
    fieldKey: 'groupLabel', align: 'center', vcenter: true,
    bg: '#ffffff', border: 1, borderColor: '#1a1a1a', radius: 16, fontSize: 16.6,
  },

  /* photo slots */
  {
    id: 'img_member', type: 'image', x: 49, y: 250, w: 99, h: 141, ...ELEMENT_DEFAULTS,
    fieldKey: 'photoURL', border: 1, borderColor: '#4a4a4a',
  },
  {
    id: 'box_right', type: 'box', x: 957, y: 250, w: 99, h: 141, ...ELEMENT_DEFAULTS,
    text: '', border: 1, borderColor: '#4a4a4a',
  },

  /* Row A */
  t('lbl_name', 168, ROW_A, 'नाम'),
  f('val_name', 199, ROW_A, 'displayName', 211),
  t('lbl_father', 423, ROW_A, 'पिता का नाम'),
  f('val_father', 513, ROW_A, 'fatherName', 159),
  t('lbl_dob', 679, ROW_A, 'जन्म'),
  f('val_dob', 713, ROW_A, 'bobDate', 89, { fontSize: 15.2 }),
  t('lbl_gotra', 806, ROW_A, 'गोत्र'),
  f('val_gotra', 837, ROW_A, 'gotra', 99),

  /* Row B */
  t('lbl_bhanja', 168, ROW_B, 'भांजे / भांजी का नाम'),
  f('val_bhanja', 306, ROW_B, 'bhanjaName', 152),
  t('lbl_village', 465, ROW_B, 'गाँव / शहर'),
  f('val_village', 544, ROW_B, 'village', 96),
  t('lbl_district', 647, ROW_B, 'जिला'),
  f('val_district', 685, ROW_B, 'district', 115),
  t('lbl_state', 807, ROW_B, 'राज्य'),
  f('val_state', 849, ROW_B, 'state', 87),

  /* Row C */
  t('lbl_phone', 168, ROW_C, 'मोबाइल नं.'),
  f('val_phone', 246, ROW_C, 'phone', 164),
  t('lbl_guardian', 417, ROW_C, 'वरिसदार (मामा-नाना)'),
  f('val_guardian', 574, ROW_C, 'guardian', 362, { align: 'center' }),

  /* Row D */
  t('lbl_fee', 168, ROW_D, 'शुल्क'),
  f('val_fee', 208, ROW_D, 'feeAmount', 157),
  {
    id: 'lbl_feenote', type: 'field', x: 374, y: ROW_D, w: 205, ...ELEMENT_DEFAULTS,
    fieldKey: 'closingWord', prefix: 'रू. प्रत्येक ', suffix: ' पर लागू।',
  },
  t('lbl_agent', 583, ROW_D, 'कार्यकर्ता'),
  f('val_agent', 655, ROW_D, 'agentName', 175, {
    align: 'center', color: '#1a0f5e', underline: 'none',
  }),

  /* किस्त band */
  {
    id: 'band_kist', type: 'box', x: 424, y: 431, w: 266, h: 32, ...ELEMENT_DEFAULTS,
    text: 'किस्त देने वाले का विवरण', align: 'center', vcenter: true,
    bg: '#5A0000', color: '#ffffff', radius: 6, fontSize: 16.6,
  },

  /* Row E */
  t('lbl_p_name', 167, ROW_E, 'नाम'),
  f('val_p_name', 199, ROW_E, 'payer.name', 224),
  t('lbl_p_father', 432, ROW_E, 'पिता का नाम'),
  f('val_p_father', 523, ROW_E, 'payer.father', 210),
  t('lbl_p_gotra', 746, ROW_E, 'गोत्र'),
  f('val_p_gotra', 777, ROW_E, 'payer.gotra', 159),

  /* Row F */
  t('lbl_p_village', 167, ROW_F, 'गाँव'),
  f('val_p_village', 199, ROW_F, 'payer.village', 173),
  t('lbl_p_district', 379, ROW_F, 'जिला'),
  f('val_p_district', 418, ROW_F, 'payer.district', 131),
  t('lbl_p_state', 557, ROW_F, 'राज्य'),
  f('val_p_state', 594, ROW_F, 'payer.state', 136),
  t('lbl_p_mobile', 740, ROW_F, 'मोबाइल नं.'),
  f('val_p_mobile', 818, ROW_F, 'payer.mobile', 118),
];

export const DEFAULT_TEMPLATE = {
  id: null,
  name: 'सदस्यता प्रमाण पत्र',
  isDefault: true,
  programId: null,
  page: { wmm: 210, hmm: 148 },
  art: { w: 1104, h: 739 },
  frameImg: '',
  bg: { color: '#ffffff' },
  elements: DEFAULT_ELEMENTS,
};

/** Deep-ish clone so the builder never mutates the constant above. */
export const cloneTemplate = (tpl = DEFAULT_TEMPLATE) => ({
  ...tpl,
  page: { ...tpl.page },
  art: { ...tpl.art },
  bg: { ...(tpl.bg || {}) },
  elements: (tpl.elements || []).map((e) => ({ ...e })),
});

/** Fill in anything a hand-edited or older template is missing. */
export const normalizeTemplate = (tpl) => {
  const base = cloneTemplate(DEFAULT_TEMPLATE);
  if (!tpl) return base;
  return {
    ...base,
    ...tpl,
    page: { ...base.page, ...(tpl.page || {}) },
    art: { ...base.art, ...(tpl.art || {}) },
    bg: { ...base.bg, ...(tpl.bg || {}) },
    elements: (tpl.elements || base.elements).map((e) => ({ ...ELEMENT_DEFAULTS, ...e })),
  };
};

/** The builder can produce `undefined` (clearing a text element's width, say) — drop it before saving. */
export const stripUndefined = (value) => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const k of Object.keys(value)) {
      if (value[k] === undefined) continue;
      out[k] = stripUndefined(value[k]);
    }
    return out;
  }
  return value;
};

/* ── Sample data for the builder preview (invented, not a real member) ──── */

export const SAMPLE_MEMBER = {
  registrationNumber: '473',
  joinDate: '13-05-2026',
  memberGroup: '2',
  displayName: 'रमेश कुमार',
  fatherName: 'सुरेश जी',
  bobDate: '17-07-2000',
  gotra: 'राठौड़',
  jati: 'घांची',
  village: 'जसोल',
  district: 'बालोतरा',
  state: 'राजस्थान',
  phone: '9876543210',
  aadhaarNo: '1234 5678 9012',
  guardian: 'शांति देवी',
  guardianRelation: 'माता',
  payAmount: 300,
  agentName: 'मोहन भाटी',
  agentCode: '1002',
  payerFatherName: 'विजय जी',
  payerGotra: 'परमार',
  payerMobile: '9876543210',
};

export const SAMPLE_TRUST = {
  name: 'श्री सर्व समाज सेवा ट्रस्ट',
  topTitle: ['॥ श्री गणेशाय नमः ॥', '॥ श्री कुलदेवी माताजी नमः ॥', '॥ श्री रामदेवजी नमः ॥'],
  cityState: 'जसोल, राजस्थान',
  address: 'मुख्य बाजार, जसोल, जिला बालोतरा (राज.) 344024',
  contact: '98765 43210 / 91234 56780',
  regNo: 'Regd. No. 123/2024',
  govtRegNo: '',
  email: 'trust@example.com',
  trustPresident: 'भंवरलाल जी',
  contactPerson: 'मनोहर जी',
  signatoryName: 'अध्यक्ष',
  logo: '',
  RightLogo: '',
  stampImg: '',
};

export const SAMPLE_PROGRAM = {
  hiname: 'मायरा सहयोग योजना',
  name: 'Mayra Sahyog Yojna',
  category: 'isMamera',
  groupDate: '01.11.2025',
};
