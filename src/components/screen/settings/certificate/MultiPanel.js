'use client';
// Side panel pieces of the certificate builder:
//   MultiPanel  — several elements selected: align, distribute, centre on page, copy, lock, delete
//   ColourPanel — every colour the design uses; change one and it changes everywhere
import { Button, ColorPicker, Divider, Tooltip } from 'antd';
import {
  FiAlignLeft, FiAlignCenter, FiAlignRight, FiArrowUp, FiArrowDown, FiMinus, FiCopy, FiTrash2, FiLock, FiUnlock,
  FiMoreHorizontal, FiMoreVertical, FiMaximize2, FiX,
} from 'react-icons/fi';

const toHex = (c) => (typeof c === 'string' ? c : c?.toHexString?.() || '#000000');
const label = { fontSize: 11, fontWeight: 500, color: '#78716c', marginBottom: 6 };

function Tool({ title, icon, onClick }) {
  return (
    <Tooltip title={title}>
      <Button size="small" icon={icon} onClick={onClick} />
    </Tooltip>
  );
}

/** Align buttons — shared by the multi-select panel and the single-element inspector */
export function AlignTools({ onArrange, multi }) {
  return (
    <>
      {multi && (
        <>
          <div style={label}>एक सीध में (आपस में)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <Tool title="बाएँ सीध" icon={<FiAlignLeft />} onClick={() => onArrange('left')} />
            <Tool title="बीच (खड़ी लाइन)" icon={<FiAlignCenter />} onClick={() => onArrange('hcenter')} />
            <Tool title="दाएँ सीध" icon={<FiAlignRight />} onClick={() => onArrange('right')} />
            <Tool title="ऊपर सीध" icon={<FiArrowUp />} onClick={() => onArrange('top')} />
            <Tool title="बीच (आड़ी लाइन)" icon={<FiMinus />} onClick={() => onArrange('vcenter')} />
            <Tool title="नीचे सीध" icon={<FiArrowDown />} onClick={() => onArrange('bottom')} />
          </div>
          <div style={label}>बराबर दूरी</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <Tool title="आड़ी बराबर दूरी (3+ चुनें)" icon={<FiMoreHorizontal />} onClick={() => onArrange('distH')} />
            <Tool title="खड़ी बराबर दूरी (3+ चुनें)" icon={<FiMoreVertical />} onClick={() => onArrange('distV')} />
            <Tool title="सबकी चौड़ाई बराबर (सबसे चौड़े जितनी)" icon={<FiMaximize2 />} onClick={() => onArrange('sameW')} />
          </div>
        </>
      )}
      <div style={label}>पेज के बीच में</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="small" onClick={() => onArrange('pageX')}>↔ आड़ा बीच</Button>
        <Button size="small" onClick={() => onArrange('pageY')}>↕ खड़ा बीच</Button>
      </div>
    </>
  );
}

export default function MultiPanel({ count, onArrange, onDuplicate, onDelete, onClear, onLock }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{count} एलिमेंट चुने हैं</div>
          <div style={{ fontSize: 11, color: '#a8a29e' }}>खींचें तो सब साथ चलेंगे · तीर बटन से भी</div>
        </div>
        <Tool title="चुनाव हटाएँ (Esc)" icon={<FiX />} onClick={onClear} />
      </div>
      <Divider style={{ margin: '10px 0 12px' }} />
      <AlignTools onArrange={onArrange} multi />
      <Divider style={{ margin: '12px 0' }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="small" icon={<FiCopy />} onClick={onDuplicate}>कॉपी</Button>
        <Button size="small" icon={<FiLock />} onClick={() => onLock(true)}>लॉक</Button>
        <Button size="small" icon={<FiUnlock />} onClick={() => onLock(false)}>अनलॉक</Button>
        <Button size="small" danger icon={<FiTrash2 />} onClick={onDelete}>हटाएँ</Button>
      </div>
    </div>
  );
}

/** every colour the design uses (page, text, fills, borders) */
export function ColourPanel({ tpl, onReplace }) {
  const counts = new Map();
  const addC = (c) => {
    const v = String(c || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) counts.set(v, (counts.get(v) || 0) + 1);
  };
  addC(tpl?.bg?.color);
  for (const e of tpl?.elements || []) { addC(e.color); addC(e.bg); if (e.border) addC(e.borderColor); addC(e.lineColor); }
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  if (!list.length) return null;
  return (
    <div>
      <div style={label}>डिज़ाइन के रंग — एक बदलें, हर जगह बदलेगा</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {list.map(([c, n]) => (
          <ColorPicker key={c} value={c} disabledAlpha size="small" onChangeComplete={(v) => onReplace(c, toHex(v))}>
            <Tooltip title={`${c} · ${n} जगह`}>
              <button type="button" style={{ width: 26, height: 26, borderRadius: 7, background: c, border: '1px solid #d6d3d1', cursor: 'pointer', boxShadow: 'inset 0 0 0 2px #fff' }} />
            </Tooltip>
          </ColorPicker>
        ))}
      </div>
    </div>
  );
}
