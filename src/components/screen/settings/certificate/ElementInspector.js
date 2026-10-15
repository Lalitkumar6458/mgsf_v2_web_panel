'use client';

import {
  Input, InputNumber, Select, Switch, ColorPicker, Segmented, Divider, Button, Tooltip, Empty,
  Typography, Slider,
} from 'antd';
import { FiTrash2, FiCopy, FiArrowUp, FiArrowDown, FiUpload, FiImage, FiX } from 'react-icons/fi';

import { FIELD_GROUPS, IMAGE_FIELDS, BG_SWATCHES, fieldLabel } from '@/lib/certificateTemplate';
import { AlignTools } from './MultiPanel';

const { Text } = Typography;

/** The right-hand panel: every property of the selected element. */

const fieldOptions = FIELD_GROUPS.map((g) => ({
  label: g.group,
  options: g.fields.map((f) => ({ label: f.label, value: f.key })),
}));

const imageFieldOptions = IMAGE_FIELDS.map((f) => ({ label: f.label, value: f.key }));

const toHex = (c) => (typeof c === 'string' ? c : c?.toHexString?.() || '#000000');

function Row({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: '#78716c', marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10, color: '#a8a29e', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };

function SwitchRow({ label, checked, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: '#78716c' }}>{label}</span>
      <Switch size="small" checked={checked} onChange={onChange} />
    </div>
  );
}

/** Nothing selected → the page itself: background colour, frame artwork. */
function PagePanel({ tpl, onPage, onPickFrame, onRemoveFrame, uploading, colourPanel }) {
  const bg = tpl?.bg?.color || '#ffffff';
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>पेज / Page</div>
      <div style={{ fontSize: 11, color: '#a8a29e', marginBottom: 12 }}>किसी एलिमेंट पर क्लिक करें तो उसकी सेटिंग यहाँ दिखेगी</div>
      <Row label="बैकग्राउंड रंग / Background colour">
        <ColorPicker size="small" showText value={bg} disabledAlpha
          onChangeComplete={(c) => onPage({ bg: { color: toHex(c) } })} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {BG_SWATCHES.map((c) => (
            <button key={c} type="button" title={c} onClick={() => onPage({ bg: { color: c } })}
              style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer',
                border: c === bg ? '2px solid #e11d48' : '1px solid #d6d3d1' }} />
          ))}
        </div>
      </Row>
      <Divider style={{ margin: '8px 0 12px' }} />
      <Row label="फ्रेम इमेज (छपी हुई डिज़ाइन, पूरे पेज पर)" hint="Canva / Photoshop में बनी पूरी डिज़ाइन JPG/PNG — उस पर नाम-पता बैठेंगे">
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="small" icon={<FiUpload />} loading={uploading} onClick={onPickFrame}>{tpl?.frameImg ? 'बदलें' : 'अपलोड'}</Button>
          {tpl?.frameImg ? <Button size="small" danger icon={<FiX />} onClick={onRemoveFrame}>हटाएँ</Button> : null}
        </div>
      </Row>
      {colourPanel ? <><Divider style={{ margin: '8px 0 12px' }} />{colourPanel}</> : null}
      <Divider style={{ margin: '12px 0' }} />
      <div style={{ fontSize: 11, color: '#78716c', lineHeight: 1.6 }}>
        <b>नया डिज़ाइन आसानी से:</b> “डिज़ाइन गैलरी” से खाली पेज या कोई डिज़ाइन लें → “तैयार ब्लॉक” से हेडर, विवरण,
        हस्ताक्षर जोड़ें → खींचकर जगह दें (गुलाबी लाइन सीध बताती है) → ऊपर के रंग बदलें → सेव।
      </div>
    </div>
  );
}

export default function ElementInspector({ el, onChange, onDelete, onDuplicate, onOrder, tpl, onPage, onPickFrame, onRemoveFrame, onPickImage, uploading, onArrange, colourPanel }) {
  if (!el) {
    return <PagePanel tpl={tpl} onPage={onPage} onPickFrame={onPickFrame} onRemoveFrame={onRemoveFrame} uploading={uploading} colourPanel={colourPanel} />;
  }

  const set = (patch) => onChange(el.id, patch);
  const isBox = el.type === 'box';
  const isImage = el.type === 'image';
  const isField = el.type === 'field';
  const isText = el.type === 'text';
  const isPicture = el.type === 'picture';

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{el.type}</div>
          <div style={{ fontSize: 10, color: '#a8a29e', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isPicture ? (el.name || 'इमेज') : isField || isImage ? fieldLabel(el.fieldKey) : el.text || el.id}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip title="ऊपर लाएँ">
            <Button size="small" icon={<FiArrowUp />} onClick={() => onOrder(el.id, 1)} />
          </Tooltip>
          <Tooltip title="नीचे भेजें">
            <Button size="small" icon={<FiArrowDown />} onClick={() => onOrder(el.id, -1)} />
          </Tooltip>
          <Tooltip title="कॉपी (Ctrl+D)">
            <Button size="small" icon={<FiCopy />} onClick={() => onDuplicate(el.id)} />
          </Tooltip>
          <Tooltip title="हटाएँ (Delete)">
            <Button size="small" danger icon={<FiTrash2 />} onClick={() => onDelete(el.id)} />
          </Tooltip>
        </div>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      <div style={grid2}>
        <Row label="X">
          <InputNumber size="small" style={{ width: '100%' }} value={el.x}
            onChange={(v) => set({ x: Math.round(v || 0) })} />
        </Row>
        <Row label="Y">
          <InputNumber size="small" style={{ width: '100%' }} value={el.y}
            onChange={(v) => set({ y: Math.round(v || 0) })} />
        </Row>
        <Row label={isText ? 'चौड़ाई (खाली = auto)' : 'चौड़ाई'}>
          <InputNumber size="small" style={{ width: '100%' }} value={el.w}
            onChange={(v) => set({ w: v === null ? undefined : Math.round(v) })} />
        </Row>
        {(isBox || isImage || isPicture || (isField && el.charBoxes > 0)) && (
          <Row label="ऊँचाई">
            <InputNumber size="small" style={{ width: '100%' }} value={el.h}
              onChange={(v) => set({ h: Math.round(v || 0) })} />
          </Row>
        )}
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {(isText || isBox) && (
        <Row label="टेक्स्ट">
          <Input size="small" value={el.text} placeholder="छपने वाला टेक्स्ट"
            onChange={(e) => set({ text: e.target.value })} />
        </Row>
      )}

      {isPicture && (
        <Row label="इमेज / Image" hint="मुहर, हस्ताक्षर, लोगो — PNG (पारदर्शी बैकग्राउंड) सबसे अच्छी लगती है">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 54, height: 40, border: '1px solid #e7e5e4', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
              {el.src
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={el.src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : <FiImage color="#a8a29e" />}
            </div>
            <Button size="small" icon={<FiUpload />} loading={uploading} onClick={() => onPickImage(el.id)}>बदलें</Button>
          </div>
          <Input size="small" style={{ marginTop: 8 }} value={el.name} placeholder="नाम (जैसे: मुहर, हस्ताक्षर)"
            onChange={(e) => set({ name: e.target.value })} />
        </Row>
      )}

      {isImage && (
        <Row label="कौन सी फोटो">
          <Select size="small" style={{ width: '100%' }} value={el.fieldKey || 'photoURL'}
            onChange={(v) => set({ fieldKey: v })} options={imageFieldOptions} />
        </Row>
      )}

      {(isImage || isPicture) && (
        <Row label="फिट / Fit">
          <Segmented size="small" block value={el.fit || (isPicture ? 'contain' : 'cover')} onChange={(v) => set({ fit: v })}
            options={[{ label: 'पूरी दिखे', value: 'contain' }, { label: 'भरी हुई', value: 'cover' }, { label: 'खींची', value: 'fill' }]} />
        </Row>
      )}

      {(isField || isBox) && (
        <Row
          label={isBox ? 'फ़ील्ड (वैकल्पिक — टेक्स्ट के बजाय)' : 'फ़ील्ड'}
          hint={isBox ? 'फ़ील्ड चुनने पर ऊपर का टेक्स्ट नज़रअंदाज़ होगा' : undefined}
        >
          <Select
            size="small"
            style={{ width: '100%' }}
            showSearch
            allowClear={isBox}
            optionFilterProp="label"
            placeholder="कोई फ़ील्ड चुनें"
            value={el.fieldKey || undefined}
            onChange={(v) => set({ fieldKey: v || '' })}
            options={fieldOptions}
          />
        </Row>
      )}

      {isField && (
        <Row label="एक-एक अक्षर अलग खाने में (बॉक्स)" hint="0 = बंद। जैसे 6 → 0 0 4 7 3 (क्रमांक / दिनांक के लिए)">
          <InputNumber size="small" min={0} max={20} style={{ width: '100%' }} value={el.charBoxes || 0}
            onChange={(v) => set({ charBoxes: v || 0, ...(v && !el.h ? { h: 30 } : {}) })} />
        </Row>
      )}

      {(isField || (isBox && el.fieldKey)) && (
        <div style={grid2}>
          <Row label="पहले (prefix)">
            <Input size="small" value={el.prefix} onChange={(e) => set({ prefix: e.target.value })} />
          </Row>
          <Row label="बाद में (suffix)">
            <Input size="small" value={el.suffix} onChange={(e) => set({ suffix: e.target.value })} />
          </Row>
          <div style={{ gridColumn: 'span 2' }}>
            <Row label="खाली होने पर दिखाएँ">
              <Input size="small" value={el.fallback} placeholder="—"
                onChange={(e) => set({ fallback: e.target.value })} />
            </Row>
          </div>
        </div>
      )}

      {!isImage && !isPicture && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <div style={grid2}>
            <Row label="फ़ॉन्ट साइज़">
              <InputNumber size="small" style={{ width: '100%' }} step={0.5} min={4} max={80}
                value={el.fontSize} onChange={(v) => set({ fontSize: v || 16 })} />
            </Row>
            <Row label="रंग">
              <ColorPicker size="small" value={el.color} showText
                onChangeComplete={(c) => set({ color: toHex(c) })} />
            </Row>
          </div>

          <Row label="अलाइनमेंट">
            <Segmented
              size="small"
              block
              value={el.align || 'left'}
              onChange={(v) => set({ align: v })}
              options={[
                { label: 'बाएँ', value: 'left' },
                { label: 'मध्य', value: 'center' },
                { label: 'दाएँ', value: 'right' },
              ]}
            />
          </Row>

          <SwitchRow label="बोल्ड" checked={el.bold !== false} onChange={(v) => set({ bold: v })} />
        </>
      )}

      {isField && (
        <Row label="भरने की लाइन">
          <Segmented
            size="small"
            block
            value={el.underline || 'none'}
            onChange={(v) => set({ underline: v })}
            options={[
              { label: 'कोई नहीं', value: 'none' },
              { label: 'डॉटेड', value: 'dotted' },
              { label: 'सॉलिड', value: 'solid' },
            ]}
          />
        </Row>
      )}

      {(isBox || isImage || isPicture || (isField && el.charBoxes > 0)) && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <div style={grid2}>
{!isPicture && (
                        <Row label="बैकग्राउंड">
              <ColorPicker size="small" allowClear showText value={el.bg || null}
                onChangeComplete={(c) => set({ bg: toHex(c) })}
                onClear={() => set({ bg: '' })} />
            </Row>
            )}
            <Row label="बॉर्डर रंग">
              <ColorPicker size="small" showText value={el.borderColor}
                onChangeComplete={(c) => set({ borderColor: toHex(c) })} />
            </Row>
            <Row label="बॉर्डर मोटाई">
              <InputNumber size="small" style={{ width: '100%' }} min={0} max={6} step={0.5}
                value={el.border} onChange={(v) => set({ border: v || 0 })} />
            </Row>
            <Row label="कोना (radius)">
              <InputNumber size="small" style={{ width: '100%' }} min={0} max={60}
                value={el.radius} onChange={(v) => set({ radius: v || 0 })} />
            </Row>
          </div>
          <Row label="बॉर्डर स्टाइल">
            <Segmented size="small" block value={el.borderStyle || 'solid'} onChange={(v) => set({ borderStyle: v })}
              options={[{ label: 'सीधी', value: 'solid' }, { label: 'डैश', value: 'dashed' }, { label: 'डॉट', value: 'dotted' }]} />
          </Row>
          {isBox && (
            <SwitchRow label="टेक्स्ट बीच में (vertical)" checked={el.vcenter !== false}
              onChange={(v) => set({ vcenter: v })} />
          )}
        </>
      )}

      {onArrange && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <div style={{ marginBottom: 12 }}><AlignTools onArrange={onArrange} /></div>
          <SwitchRow label="लॉक (खिसकेगा नहीं)" checked={!!el.locked} onChange={(v) => set({ locked: v })} />
          <SwitchRow label="छुपाएँ (प्रिंट नहीं होगा)" checked={!!el.hidden} onChange={(v) => set({ hidden: v })} />
        </>
      )}

      <Divider style={{ margin: '8px 0' }} />
      <Row label={`पारदर्शिता / Opacity — ${Math.round((el.opacity ?? 1) * 100)}%`} hint="वॉटरमार्क लोगो के लिए 10–20% रखें">
        <Slider min={5} max={100} value={Math.round((el.opacity ?? 1) * 100)} onChange={(v) => set({ opacity: v / 100 })} />
      </Row>
    </div>
  );
}
