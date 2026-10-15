'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  App, Button, Select, Input, Drawer, Upload, Tooltip, Dropdown, Spin, Popconfirm, Tag,
  Segmented, Alert,
} from 'antd';
import {
  FiPlus, FiSave, FiTrash2, FiCopy, FiUpload, FiEye, FiRotateCcw, FiType, FiEdit3, FiSquare,
  FiCreditCard, FiImage, FiGrid, FiStar, FiMaximize, FiMinimize, FiSidebar, FiRefreshCw, FiDownload, FiLayout,
  FiEyeOff, FiLock, FiUnlock, FiPackage,
} from 'react-icons/fi';

const iconBtn = { border: 0, background: 'transparent', cursor: 'pointer', padding: 4, color: '#a8a29e', display: 'flex', alignItems: 'center' };
import { BsStarFill } from 'react-icons/bs';

import BuilderCanvas from './BuilderCanvas';
import ElementInspector from './ElementInspector';
import { api } from '@/lib/client/api';
import {
  DEFAULT_TEMPLATE, DEFAULT_ELEMENTS, SAMPLE_MEMBER, SAMPLE_PROGRAM,
  cloneTemplate, normalizeTemplate, makeElement, newId, fieldLabel, stripUndefined, SAMPLE_TRUST,
} from '@/lib/certificateTemplate';
import { GALLERY, BLOCKS, templateFromGallery, blockElements } from '@/lib/certificateGallery';
import MultiPanel, { ColourPanel } from './MultiPanel';

/** the trust's real name / logo / stamp in the preview when it has filled Settings → Organization */
const previewTrust = (real) => {
  const out = { ...SAMPLE_TRUST };
  if (real && real.name && real.name !== 'Trust Manager') {
    for (const [k, v] of Object.entries(real)) if (v && (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length : true)) out[k] = v;
  }
  return out;
};

/** new artwork size → every element keeps its place on the page */
const rescale = (elements, from, to) => {
  const sx = to.w / (from.w || to.w), sy = to.h / (from.h || to.h);
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return elements;
  return elements.map((e) => ({
    ...e,
    x: Math.round((e.x || 0) * sx), y: Math.round((e.y || 0) * sy),
    ...(e.w ? { w: Math.round(e.w * sx) } : {}), ...(e.h ? { h: Math.round(e.h * sy) } : {}),
    ...(e.fontSize ? { fontSize: Math.round(e.fontSize * sy * 10) / 10 } : {}),
    ...(e.radius ? { radius: Math.round(e.radius * sx) } : {}),
  }));
};

/** a stamp / signature / logo: keep PNG transparency, at most 1200px wide */
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 1200 / img.naturalWidth);
    const ratio = img.naturalHeight / img.naturalWidth;
    if (scale === 1 && /png|jpe?g/.test(file.type)) return { file, ratio };
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { file: new File([blob], 'image.png', { type: 'image/png' }), ratio };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* the old panel's tplApi.* on top of MGSF's /api client */
const tplApi = {
  list: () => api.get('/certificate-templates'),
  create: (body) => api.post('/certificate-templates', body),
  update: (id, body) => api.patch(`/certificate-templates/${id}`, body),
  remove: (id) => api.del(`/certificate-templates/${id}`),
  makeDefault: (id) => api.post(`/certificate-templates/${id}/default`),
};

/** Rendered in the browser by the same component that prints the real certificate. */
async function previewPdf(tpl, program, trust) {
  const [{ pdf }, { default: TemplateCertificatePdf }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/pdfcom/Certificates/TemplateCertificatePdf'),
  ]);
  return pdf(
    <TemplateCertificatePdf template={tpl} members={[SAMPLE_MEMBER]} program={{ ...SAMPLE_PROGRAM, ...(program || {}) }} trust={trust} />,
  ).toBlob();
}

/**
 * Certificate Builder — design the सदस्यता प्रमाण पत्र by dragging text onto
 * the trust's own frame artwork.
 *
 * Ported from gsmsy-web-panel (same tools and shortcuts) onto MGSF:
 *   • saved through /api/certificate-templates (Postgres table certificate_templates);
 *   • the frame image goes through /api/upload and the template keeps only its URL;
 *   • the preview is rendered by the same component that prints the real certificate.
 *
 * Whichever template is bound to a योजना (or marked ★ default) is what every member
 * certificate uses — the office screen and the certificate sent to the app alike.
 */

const PAGE_SIZES = [
  { value: 'a5l', label: 'A5 आड़ा', page: { wmm: 210, hmm: 148 } },
  { value: 'a4l', label: 'A4 आड़ा', page: { wmm: 297, hmm: 210 } },
  { value: 'a4p', label: 'A4 खड़ा', page: { wmm: 210, hmm: 297 } },
  { value: 'a5p', label: 'A5 खड़ा', page: { wmm: 148, hmm: 210 } },
];

const pageKey = (page) =>
  PAGE_SIZES.find((p) => p.page.wmm === page?.wmm && p.page.hmm === page?.hmm)?.value ?? 'a5l';

/* ── image helpers ───────────────────────────────────────────────────────── */

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/**
 * Re-encode the frame as a JPEG no wider than 2400px. The template keeps the
 * artwork's ORIGINAL pixel size as its coordinate space, so element positions
 * mean the same thing whatever resolution the stored image ends up at.
 */
async function prepareFrame(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2400 / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return {
      file: new File([blob], 'frame.jpg', { type: 'image/jpeg' }),
      art: { w: img.naturalWidth, h: img.naturalHeight },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Only what the server stores — no ids, timestamps or UI-only fields. */
const toPayload = (tpl) =>
  stripUndefined({
    name: tpl.name?.trim() || 'बिना नाम का टेम्पलेट',
    isDefault: Boolean(tpl.isDefault),
    programId: tpl.programId || null,
    page: tpl.page,
    art: tpl.art,
    frameImg: tpl.frameImg || '',
    bg: tpl.bg || { color: '#ffffff' },
    elements: tpl.elements,
  });

/* ── main ────────────────────────────────────────────────────────────────── */

export default function CertificateBuilderTab() {
  const { message } = App.useApp();

  const [list, setList] = useState({ data: null, isLoading: true, error: null });
  const loadList = useCallback(async () => {
    try {
      const data = await tplApi.list();
      setList({ data, isLoading: false, error: null });
    } catch (e) {
      setList((l) => ({ ...l, isLoading: false, error: e }));
    }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);
  list.refetch = loadList;
  const programs = useSelector((s) => s.data.programList) ?? [];
  const templates = useMemo(() => list.data?.templates ?? [], [list.data]);

  const [tpl, setTpl] = useState(() => cloneTemplate(DEFAULT_TEMPLATE));
  const [loadedFor, setLoadedFor] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const setSelectedId = useCallback((id) => setSelectedIds(id ? [id] : []), []);
  const selectOne = useCallback((id, { add } = {}) => {
    if (!id) { setSelectedIds([]); return; }
    setSelectedIds((cur) => (add ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  }, []);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [showOutlines, setShowOutlines] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [preview, setPreview] = useState({ open: false, url: '', loading: false, error: '' });

  const realTrust = useSelector((st) => st.data.trustData);
  const sampleTrust = useMemo(() => previewTrust(realTrust), [realTrust]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const imageInput = useRef(null);
  const frameInput = useRef(null);
  const imageTarget = useRef(null); // null = add a new picture, else the id of the picture to replace

  const stageRef = useRef(null);
  const [stageW, setStageW] = useState(900);
  const [stageH, setStageH] = useState(620);

  const past = useRef([]);
  const dragSnap = useRef(null);

  /* ── first load: pick the default (or first) saved template ─────────────── */
  useEffect(() => {
    if (!list.data || loadedFor === 'initial') return;
    const chosen = templates.find((t) => t.isDefault) ?? templates[0];
    if (chosen) setTpl(normalizeTemplate(chosen));
    else setGalleryOpen(true); // nothing designed yet → start from the gallery
    setLoadedFor('initial');
  }, [list.data, templates, loadedFor]);

  /* ── responsive stage ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!stageRef.current) return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      setStageW(Math.max(420, (box?.width || 900) - 32));
      setStageH(Math.max(320, (box?.height || 620) - 32));
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [list.isLoading]);

  /* ── history ───────────────────────────────────────────────────────────── */
  const pushPast = (snap) => {
    past.current.push(snap);
    if (past.current.length > 60) past.current.shift();
  };

  const mutate = useCallback((fn, { live = false } = {}) => {
    setTpl((prev) => {
      if (live) {
        if (!dragSnap.current) dragSnap.current = prev;
      } else {
        pushPast(prev);
      }
      return fn(prev);
    });
    setDirty(true);
  }, []);

  const commitDrag = useCallback(() => {
    if (dragSnap.current) {
      pushPast(dragSnap.current);
      dragSnap.current = null;
    }
  }, []);

  const undo = useCallback(() => {
    const snap = past.current.pop();
    if (!snap) {
      message.info('और पीछे नहीं जा सकते');
      return;
    }
    setTpl(snap);
    setDirty(true);
  }, [message]);

  /* ── element operations ────────────────────────────────────────────────── */
  const patchElement = useCallback(
    (id, patch, opts) =>
      mutate(
        (prev) => ({ ...prev, elements: prev.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }),
        opts,
      ),
    [mutate],
  );
  const livePatch = useCallback((id, patch) => patchElement(id, patch, { live: true }), [patchElement]);
  /** several elements at once ({ id: patch }); live = part of a drag (one undo step at the end) */
  const patchMany = useCallback(
    (map, opts) =>
      mutate((prev) => ({ ...prev, elements: prev.elements.map((e) => (map[e.id] ? { ...e, ...map[e.id] } : e)) }), opts),
    [mutate],
  );
  const livePatchMany = useCallback((map) => patchMany(map, { live: true }), [patchMany]);

  /** element boxes in art pixels, read from the canvas (text has no stored width) */
  const measure = () => {
    const root = stageRef.current?.querySelector('[data-el-id]')?.parentElement;
    if (!root) return {};
    const r0 = root.getBoundingClientRect();
    const sx = r0.width / (tpl.art?.w || 1104), sy = r0.height / (tpl.art?.h || 739);
    const out = {};
    root.querySelectorAll('[data-el-id]').forEach((n) => {
      const r = n.getBoundingClientRect();
      out[n.dataset.elId] = { x: (r.left - r0.left) / sx, y: (r.top - r0.top) / sy, w: r.width / sx, h: r.height / sy };
    });
    return out;
  };

  /** align / distribute / centre the selection (or one element on the page) */
  const arrange = (how) => {
    const boxes = measure();
    const ids = selectedIds.filter((id) => boxes[id]);
    if (!ids.length) return;
    const bs = ids.map((id) => ({ id, ...boxes[id] }));
    const artW = tpl.art?.w || 1104, artH = tpl.art?.h || 739;
    const minX = Math.min(...bs.map((b) => b.x)), maxR = Math.max(...bs.map((b) => b.x + b.w));
    const minY = Math.min(...bs.map((b) => b.y)), maxB = Math.max(...bs.map((b) => b.y + b.h));
    const el = (id) => tpl.elements.find((e) => e.id === id) || {};
    const map = {};
    const setX = (b, nx) => { map[b.id] = { ...(map[b.id] || {}), x: Math.round((el(b.id).x || 0) + (nx - b.x)) }; };
    const setY = (b, ny) => { map[b.id] = { ...(map[b.id] || {}), y: Math.round((el(b.id).y || 0) + (ny - b.y)) }; };
    if (how === 'left') bs.forEach((b) => setX(b, minX));
    if (how === 'right') bs.forEach((b) => setX(b, maxR - b.w));
    if (how === 'hcenter') bs.forEach((b) => setX(b, (minX + maxR) / 2 - b.w / 2));
    if (how === 'top') bs.forEach((b) => setY(b, minY));
    if (how === 'bottom') bs.forEach((b) => setY(b, maxB - b.h));
    if (how === 'vcenter') bs.forEach((b) => setY(b, (minY + maxB) / 2 - b.h / 2));
    if (how === 'pageX') { const dx = artW / 2 - (minX + maxR) / 2; bs.forEach((b) => setX(b, b.x + dx)); }
    if (how === 'pageY') { const dy = artH / 2 - (minY + maxB) / 2; bs.forEach((b) => setY(b, b.y + dy)); }
    if (how === 'distH' && bs.length > 2) {
      const sorted = [...bs].sort((a, b) => a.x - b.x);
      const gap = (maxR - minX - sorted.reduce((t, b) => t + b.w, 0)) / (sorted.length - 1);
      let x = minX; sorted.forEach((b) => { setX(b, x); x += b.w + gap; });
    }
    if (how === 'distV' && bs.length > 2) {
      const sorted = [...bs].sort((a, b) => a.y - b.y);
      const gap = (maxB - minY - sorted.reduce((t, b) => t + b.h, 0)) / (sorted.length - 1);
      let y = minY; sorted.forEach((b) => { setY(b, y); y += b.h + gap; });
    }
    if (how === 'sameW') { const w = Math.round(Math.max(...ids.map((id) => el(id).w || 0))); if (w) ids.forEach((id) => { map[id] = { ...(map[id] || {}), w }; }); }
    if (Object.keys(map).length) patchMany(map);
  };

  /** every colour used in the design → change one, it changes everywhere */
  const replaceColour = (from, to) => {
    const f = String(from).toLowerCase();
    mutate((prev) => ({
      ...prev,
      bg: String(prev.bg?.color || '').toLowerCase() === f ? { ...prev.bg, color: to } : prev.bg,
      elements: prev.elements.map((e) => {
        const n = { ...e };
        for (const k of ['color', 'bg', 'borderColor', 'lineColor']) if (String(e[k] || '').toLowerCase() === f) n[k] = to;
        return n;
      }),
    }));
  };

  const addBlock = (key) => {
    const els = rescale(blockElements(key), { w: 1104, h: 739 }, tpl.art || { w: 1104, h: 739 });
    if (!els.length) return;
    mutate((prev) => ({ ...prev, elements: key === 'border' ? [...els, ...prev.elements] : [...prev.elements, ...els] }));
    setSelectedIds(els.map((e) => e.id));
    message.success('ब्लॉक जुड़ गया — पूरा ब्लॉक साथ में चुना हुआ है, खींचकर जगह बदलें');
  };

  const addElement = (kind) => {
    if (kind === 'picture') { imageTarget.current = null; imageInput.current?.click(); return; }
    const el = makeElement(kind, { x: Math.round((tpl.art?.w || 1104) / 2 - 100), y: Math.round((tpl.art?.h || 739) / 2 - 40) });
    mutate((prev) => ({ ...prev, elements: [...prev.elements, el] }));
    setSelectedId(el.id);
  };

  const deleteElement = (id) => {
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    mutate((prev) => ({ ...prev, elements: prev.elements.filter((e) => !ids.includes(e.id)) }));
    setSelectedIds([]);
  };

  const duplicateSelection = () => {
    const src = tpl.elements.filter((e) => selectedIds.includes(e.id));
    if (!src.length) return;
    const copies = src.map((e) => ({ ...e, id: newId(e.type), x: (e.x || 0) + 14, y: (e.y || 0) + 14, locked: false }));
    mutate((prev) => ({ ...prev, elements: [...prev.elements, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
  };

  const duplicateElement = (id) => {
    const src = tpl.elements.find((e) => e.id === id);
    if (!src) return;
    const copy = { ...src, id: newId(src.type), x: (src.x || 0) + 12, y: (src.y || 0) + 12 };
    mutate((prev) => ({ ...prev, elements: [...prev.elements, copy] }));
    setSelectedId(copy.id);
  };

  const orderElement = (id, dir) => {
    mutate((prev) => {
      const els = [...prev.elements];
      const i = els.findIndex((e) => e.id === id);
      const j = dir > 0 ? i + 1 : i - 1;
      if (i < 0 || j < 0 || j >= els.length) return prev;
      [els[i], els[j]] = [els[j], els[i]];
      return { ...prev, elements: els };
    });
  };

  /* ── template operations ───────────────────────────────────────────────── */
  const refresh = loadList;

  const handleNew = () => {
    if (dirty && !window.confirm('सेव नहीं किए बदलाव चले जाएँगे। आगे बढ़ें?')) return;
    const fresh = cloneTemplate(DEFAULT_TEMPLATE);
    fresh.id = null;
    fresh.isDefault = templates.length === 0;
    fresh.name = 'नया टेम्पलेट';
    // A new design usually goes on the same artwork as the current one.
    fresh.frameImg = tpl.frameImg || '';
    fresh.art = { ...tpl.art };
    past.current = [];
    setTpl(fresh);
    setSelectedId(null);
    setDirty(true);
  };

  const handleSelect = (id) => {
    if (id === '__new__') return;
    if (dirty && !window.confirm('सेव नहीं किए बदलाव चले जाएँगे। आगे बढ़ें?')) return;
    const found = templates.find((t) => t.id === id);
    past.current = [];
    setTpl(found ? normalizeTemplate(found) : cloneTemplate(DEFAULT_TEMPLATE));
    setSelectedId(null);
    setDirty(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = toPayload(tpl);
      const { template } = tpl.id
        ? await tplApi.update(tpl.id, body)
        : await tplApi.create(body);
      setTpl(normalizeTemplate(template));
      setDirty(false);
      message.success('टेम्पलेट सेव हो गया');
      await refresh();
    } catch (e) {
      message.error(`सेव नहीं हो पाया: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    setSaving(true);
    try {
      const { template } = await tplApi.create({
        ...toPayload(tpl), isDefault: false, programId: null, name: `${tpl.name} (कॉपी)`,
      });
      setTpl(normalizeTemplate(template));
      setDirty(false);
      message.success('कॉपी बन गई');
      await refresh();
    } catch (e) {
      message.error(`कॉपी नहीं बनी: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tpl.id) {
      setTpl(cloneTemplate(DEFAULT_TEMPLATE));
      setDirty(false);
      return;
    }
    try {
      await tplApi.remove(tpl.id);
      message.success('टेम्पलेट हटा दिया');
      const rest = templates.filter((t) => t.id !== tpl.id);
      setTpl(normalizeTemplate(rest.find((t) => t.isDefault) ?? rest[0] ?? DEFAULT_TEMPLATE));
      setDirty(false);
      await refresh();
    } catch (e) {
      message.error(`हटाया नहीं जा सका: ${e.message}`);
    }
  };

  const handleMakeDefault = async () => {
    if (!tpl.id || dirty) {
      setTpl((p) => ({ ...p, isDefault: true }));
      setDirty(true);
      message.info('सेव करने पर यही डिफ़ॉल्ट बन जाएगा');
      return;
    }
    try {
      const { template } = await tplApi.makeDefault(tpl.id);
      setTpl(normalizeTemplate(template));
      message.success('अब यही डिफ़ॉल्ट टेम्पलेट है');
      await refresh();
    } catch (e) {
      message.error(`डिफ़ॉल्ट सेट नहीं हुआ: ${e.message}`);
    }
  };

  const handleImageFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { file: prepared, ratio } = await prepareImage(file);
      const { url } = await api.upload(prepared, 'certificates');
      const target = imageTarget.current;
      if (target) {
        patchElement(target, { src: url });
      } else {
        const w = 160, h = Math.round(160 * (ratio || 0.6));
        const el = makeElement('picture', {
          x: Math.round((tpl.art?.w || 1104) / 2 - w / 2), y: Math.round((tpl.art?.h || 739) / 2 - h / 2),
          src: url, w, h, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40),
        });
        mutate((prev) => ({ ...prev, elements: [...prev.elements, el] }));
        setSelectedId(el.id);
      }
      message.success('इमेज लग गई — खींचकर सही जगह रखें');
    } catch (e) {
      message.error(`इमेज अपलोड नहीं हुई: ${e.message}`);
    } finally {
      setUploading(false);
      imageTarget.current = null;
    }
  };

  const applyGallery = (key) => {
    if (dirty && !window.confirm('सेव नहीं किए बदलाव चले जाएँगे। आगे बढ़ें?')) return;
    const fresh = templateFromGallery(key);
    if (!fresh) return;
    fresh.isDefault = templates.length === 0;
    past.current = [];
    setTpl(normalizeTemplate(fresh));
    setSelectedId(null);
    setDirty(true);
    setGalleryOpen(false);
    message.success(`"${fresh.name}" डिज़ाइन खुल गया — बदलाव करके सेव करें`);
  };

  const handleFrameUpload = async (file) => {
    setUploading(true);
    try {
      const { file: prepared, art } = await prepareFrame(file);
      const { url } = await api.upload(prepared, 'certificates');
      mutate((prev) => ({ ...prev, frameImg: url, art, elements: rescale(prev.elements, prev.art || art, art) }));
      message.success(`फ्रेम सेट हो गया (${art.w}×${art.h}) — सेव करना न भूलें`);
    } catch (e) {
      message.error(`फ्रेम अपलोड नहीं हुआ: ${e.message}`);
    } finally {
      setUploading(false);
    }
    return Upload.LIST_IGNORE;
  };

  const resetLayout = () => {
    mutate((prev) => ({ ...prev, elements: DEFAULT_ELEMENTS.map((e) => ({ ...e })) }));
    setSelectedId(null);
    message.success('मूल डिज़ाइन लोड हो गया');
  };

  /* ── preview (rendered on the server) ──────────────────────────────────── */
  const runPreview = async () => {
    setPreview((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
      return { open: true, url: '', loading: true, error: '' };
    });
    try {
      const blob = await previewPdf(toPayload(tpl), programs.find((p) => p.id === tpl.programId), sampleTrust);
      setPreview({ open: true, url: URL.createObjectURL(blob), loading: false, error: '' });
    } catch (e) {
      setPreview({ open: true, url: '', loading: false, error: e.message });
    }
  };

  const closePreview = () => {
    setPreview((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
      return { open: false, url: '', loading: false, error: '' };
    });
  };

  /* ── keyboard ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const esc = (e) => {
      if (e.key === 'Escape' && fullscreen && !preview.open) setFullscreen(false);
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [fullscreen, preview.open]);

  const onKeyDown = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); handleSave(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelectedIds(tpl.elements.filter((x) => !x.locked).map((x) => x.id)); return; }
    if (e.key === 'Escape') { setSelectedIds([]); return; }
    if (!selectedId) return;
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteElement(selectedId); return; }

    const step = e.shiftKey ? 10 : 1;
    const moves = {
      ArrowLeft: { x: -step }, ArrowRight: { x: step }, ArrowUp: { y: -step }, ArrowDown: { y: step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      const map = {};
      for (const el of tpl.elements) {
        if (!selectedIds.includes(el.id) || el.locked) continue;
        map[el.id] = { x: Math.max(0, (el.x || 0) + (moves[e.key].x || 0)), y: Math.max(0, (el.y || 0) + (moves[e.key].y || 0)) };
      }
      patchMany(map);
    }
  };

  /* ── derived ───────────────────────────────────────────────────────────── */
  const selected = useMemo(
    () => (selectedIds.length === 1 ? tpl.elements.find((e) => e.id === selectedIds[0]) || null : null),
    [tpl.elements, selectedIds],
  );

  const pageRatio = (tpl.page?.hmm || 148) / (tpl.page?.wmm || 210);
  const fitW = fullscreen ? Math.min(stageW, stageH / pageRatio) : stageW;
  const displayW = Math.max(360, Math.round(fitW * zoom));

  const boundProgram = programs.find((p) => p.id === tpl.programId);

  const addMenu = {
    items: [
      { key: 'text', icon: <FiType />, label: 'टेक्स्ट (लेबल)' },
      { key: 'field', icon: <FiEdit3 />, label: 'फ़ील्ड (डेटा)' },
      { key: 'box', icon: <FiSquare />, label: 'बॉक्स' },
      { key: 'band', icon: <FiCreditCard />, label: 'बैंड (भरा हुआ)' },
      { key: 'pill', icon: <FiCreditCard />, label: 'पिल (आउटलाइन)' },
      { key: 'image', icon: <FiImage />, label: 'सदस्य फोटो स्लॉट' },
      { type: 'divider' },
      { key: 'picture', icon: <FiUpload />, label: 'इमेज अपलोड (मुहर / हस्ताक्षर / लोगो)' },
      { key: 'trustLogo', icon: <FiImage />, label: 'ट्रस्ट लोगो (Settings से)' },
      { key: 'trustStamp', icon: <FiImage />, label: 'ट्रस्ट मुहर (Settings से)' },
      { type: 'divider' },
      { key: 'line', icon: <FiSquare />, label: 'लाइन (हस्ताक्षर के लिए)' },
      { key: 'frame', icon: <FiGrid />, label: 'पेज बॉर्डर' },
    ],
    onClick: ({ key }) => addElement(key),
  };

  if (list.isLoading) {
    return <Spin style={{ display: 'block', margin: '64px auto' }} />;
  }

  const shell = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 1200, background: '#ffffff', display: 'flex', flexDirection: 'column' }
    : { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#ffffff' };

  return (
    <div style={shell} onKeyDown={onKeyDown} tabIndex={0}>
      {list.error && (
        <Alert type="error" showIcon banner message={`टेम्पलेट लोड नहीं हुए: ${list.error.message}`}
          action={<Button size="small" icon={<FiRefreshCw />} onClick={() => list.refetch()}>फिर से</Button>} />
      )}

      {/* ── toolbar ─────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid #e5e7eb', padding: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Select
          size="small"
          style={{ minWidth: 220 }}
          value={tpl.id || '__new__'}
          onChange={handleSelect}
          options={[
            ...(tpl.id ? [] : [{ value: '__new__', label: `${tpl.name} (सेव नहीं)` }]),
            ...templates.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? '  ★' : ''}` })),
          ]}
        />
        <Tooltip title="नया टेम्पलेट">
          <Button size="small" icon={<FiPlus />} onClick={handleNew} />
        </Tooltip>

        <Input
          size="small"
          style={{ width: 210 }}
          value={tpl.name}
          placeholder="टेम्पलेट का नाम"
          onChange={(e) => mutate((p) => ({ ...p, name: e.target.value }))}
        />

        <Select
          size="small"
          allowClear
          style={{ width: 190 }}
          placeholder="किसी योजना से जोड़ें"
          value={tpl.programId || undefined}
          onChange={(v) => mutate((p) => ({ ...p, programId: v || null }))}
          options={programs.map((p) => ({ value: p.id, label: p.hiname || p.name }))}
        />

        <Select
          size="small"
          style={{ width: 110 }}
          value={pageKey(tpl.page)}
          onChange={(v) => mutate((p) => ({ ...p, page: { ...PAGE_SIZES.find((s) => s.value === v).page } }))}
          options={PAGE_SIZES.map(({ value, label }) => ({ value, label }))}
        />

        <Tooltip title={tpl.isDefault ? 'यह डिफ़ॉल्ट टेम्पलेट है' : 'डिफ़ॉल्ट बनाएँ'}>
          <Button
            size="small"
            icon={tpl.isDefault ? <BsStarFill style={{ color: '#f59e0b' }} /> : <FiStar />}
            onClick={handleMakeDefault}
          />
        </Tooltip>

        <div style={{ width: 1, height: 20, background: '#e7e5e4', margin: '0 4px' }} />

        <Dropdown menu={addMenu} trigger={['click']}>
          <Button size="small" type="primary" icon={<FiPlus />}>जोड़ें</Button>
        </Dropdown>
        <Dropdown trigger={['click']} menu={{
          items: BLOCKS.map((b) => ({ key: b.key, label: <div style={{ lineHeight: 1.25, padding: '2px 0' }}><div style={{ fontWeight: 500 }}>{b.label}</div><div style={{ fontSize: 11, color: '#78716c' }}>{b.hint}</div></div> })),
          onClick: ({ key }) => addBlock(key),
        }}>
          <Button size="small" icon={<FiPackage />}>तैयार ब्लॉक</Button>
        </Dropdown>
                <Button size="small" icon={<FiLayout />} onClick={() => setGalleryOpen(true)}>डिज़ाइन गैलरी</Button>

        <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={handleFrameUpload}>
          <Button size="small" icon={<FiUpload />} loading={uploading}>फ्रेम इमेज</Button>
        </Upload>

        <Popconfirm title="मौजूदा लेआउट हट जाएगा। जारी रखें?" onConfirm={resetLayout}>
          <Tooltip title="मूल (approved) डिज़ाइन दोबारा लोड करें">
            <Button size="small" icon={<FiRotateCcw />} />
          </Tooltip>
        </Popconfirm>

        <Tooltip title="आउटलाइन दिखाएँ/छुपाएँ">
          <Button size="small" type={showOutlines ? 'default' : 'dashed'} icon={<FiGrid />}
            onClick={() => setShowOutlines((v) => !v)} />
        </Tooltip>

        <Segmented
          size="small"
          value={zoom}
          onChange={setZoom}
          options={[
            { label: '50%', value: 0.5 },
            { label: '75%', value: 0.75 },
            { label: 'फ़िट', value: 1 },
            { label: '125%', value: 1.25 },
            { label: '150%', value: 1.5 },
            { label: '200%', value: 2 },
          ]}
        />

        <Tooltip title={showPanel ? 'साइड पैनल छुपाएँ' : 'साइड पैनल दिखाएँ'}>
          <Button size="small" type={showPanel ? 'default' : 'dashed'} icon={<FiSidebar />}
            onClick={() => setShowPanel((v) => !v)} />
        </Tooltip>

        <Tooltip title={fullscreen ? 'फुल स्क्रीन बंद करें (Esc)' : 'फुल स्क्रीन'}>
          <Button size="small" type={fullscreen ? 'primary' : 'default'}
            icon={fullscreen ? <FiMinimize /> : <FiMaximize />}
            onClick={() => setFullscreen((v) => !v)} />
        </Tooltip>

        <div style={{ flex: 1 }} />

        {boundProgram && <Tag color="blue">{boundProgram.hiname || boundProgram.name}</Tag>}
        {dirty && <Tag color="orange">सेव नहीं</Tag>}

        <Button size="small" icon={<FiEye />} onClick={runPreview}>प्रीव्यू</Button>
        <Button size="small" icon={<FiCopy />} onClick={handleDuplicate} disabled={!tpl.id || saving}>कॉपी</Button>
        <Popconfirm title="यह टेम्पलेट हटाएँ?" onConfirm={handleDelete}>
          <Button size="small" danger icon={<FiTrash2 />} />
        </Popconfirm>
        <Button size="small" type="primary" loading={saving} icon={<FiSave />} onClick={handleSave}>सेव</Button>
      </div>

      {!tpl.frameImg && !tpl.elements.some((e) => e.type === 'box' && ((e.w || 0) >= (tpl.art?.w || 1104) * 0.8 || (e.h || 0) >= (tpl.art?.h || 739) * 0.8)) && (
        <Alert
          type="info"
          showIcon
          banner
          message="इस डिज़ाइन के पीछे फ्रेम इमेज (आर्टवर्क) चाहिए — ऊपर “फ्रेम इमेज” से अपलोड करें, या “डिज़ाइन गैलरी” से बना-बनाया डिज़ाइन चुनें।"
          action={<Button size="small" onClick={() => setGalleryOpen(true)}>डिज़ाइन गैलरी</Button>}
        />
      )}

      {/* ── body ────────────────────────────────────────────────────────── */}
      <div style={fullscreen ? { display: 'flex', flex: 1, minHeight: 0 } : { display: 'flex' }}>
        <div
          ref={stageRef}
          style={{
            flex: 1, minWidth: 0, background: '#f3f4f6', padding: 16, overflow: 'auto',
            ...(fullscreen ? {} : { maxHeight: '78vh' }),
          }}
        >
          <BuilderCanvas
            tpl={tpl}
            frameSrc={tpl.frameImg}
            displayW={displayW}
            sampleData={SAMPLE_MEMBER}
            sampleProgram={SAMPLE_PROGRAM}
            sampleTrust={sampleTrust}
            selectedIds={selectedIds}
            onSelect={selectOne}
            onSelectMany={setSelectedIds}
            onPatch={livePatch}
            onPatchMany={livePatchMany}
            onCommit={commitDrag}
            showOutlines={showOutlines}
          />
          <div style={{ fontSize: 11, color: '#78716c', marginTop: 12, lineHeight: '20px' }}>
            खींचकर जगह बदलें (गुलाबी लाइन = बीच / दूसरे एलिमेंट से सीध; Alt दबाकर बिना चिपके) · Shift+क्लिक या खाली जगह पर
            खींचकर कई चुनें · तीर बटन 1px (Shift = 10px) · Ctrl+A सब · Ctrl+D कॉपी · Delete हटाएँ · Ctrl+Z वापस · Ctrl+S सेव
          </div>
        </div>

        {showPanel && (
          <div
            style={{
              width: 300, flexShrink: 0, borderLeft: '1px solid #e5e7eb', background: '#ffffff', overflow: 'auto',
              ...(fullscreen ? {} : { maxHeight: '78vh' }),
            }}
          >
            {selectedIds.length > 1 ? (
              <MultiPanel
                count={selectedIds.length}
                onArrange={arrange}
                onDuplicate={duplicateSelection}
                onDelete={() => deleteElement(selectedId)}
                onClear={() => setSelectedIds([])}
                onLock={(v) => patchMany(Object.fromEntries(selectedIds.map((id) => [id, { locked: v }])))}
              />
            ) : (
            <ElementInspector
              el={selected}
              onArrange={arrange}
              onChange={patchElement}
              onDelete={deleteElement}
              onDuplicate={duplicateElement}
              onOrder={orderElement}
              tpl={tpl}
              uploading={uploading}
              onPage={(patch) => mutate((p) => ({ ...p, ...patch }))}
              onPickFrame={() => frameInput.current?.click()}
              onRemoveFrame={() => mutate((p) => ({ ...p, frameImg: '' }))}
              onPickImage={(id) => { imageTarget.current = id; imageInput.current?.click(); }}
              colourPanel={<ColourPanel tpl={tpl} onReplace={replaceColour} />}
            />
            )}

            <div style={{ borderTop: '1px solid #e5e7eb', padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#78716c', marginBottom: 8 }}>
                एलिमेंट्स ({tpl.elements.length})
              </div>
              <div style={{ maxHeight: 224, overflow: 'auto', paddingRight: 4 }}>
                {tpl.elements.map((e) => {
                  const on = selectedIds.includes(e.id);
                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2, borderRadius: 4, background: on ? '#fff1f2' : 'transparent' }}>
                      <button
                        type="button"
                        onClick={(ev) => selectOne(e.id, { add: ev.shiftKey || ev.ctrlKey || ev.metaKey })}
                        style={{
                          flex: 1, minWidth: 0, textAlign: 'left', fontSize: 11, padding: '4px 8px', border: 0, cursor: 'pointer',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'transparent',
                          color: on ? '#be123c' : e.hidden ? '#a8a29e' : '#57534e', fontWeight: on ? 500 : 400,
                          textDecoration: e.hidden ? 'line-through' : 'none',
                        }}
                      >
                        <span style={{ textTransform: 'uppercase', fontSize: 9, color: '#a8a29e', marginRight: 4 }}>{e.type}</span>
                        {e.type === 'picture' ? (e.name || 'इमेज') : e.type === 'field' || e.type === 'image' ? fieldLabel(e.fieldKey) : e.text || (e.fieldKey && fieldLabel(e.fieldKey)) || ((e.h || 0) <= 4 ? 'लाइन' : (e.bg && !e.border) ? 'रंगीन पट्टी' : 'बॉक्स / बॉर्डर')}
                      </button>
                      <Tooltip title={e.hidden ? 'दिखाएँ' : 'छुपाएँ (प्रिंट नहीं होगा)'}>
                        <button type="button" onClick={() => patchElement(e.id, { hidden: !e.hidden })} style={iconBtn}>{e.hidden ? <FiEyeOff /> : <FiEye />}</button>
                      </Tooltip>
                      <Tooltip title={e.locked ? 'अनलॉक' : 'लॉक (खिसकेगा नहीं)'}>
                        <button type="button" onClick={() => patchElement(e.id, { locked: !e.locked })} style={{ ...iconBtn, color: e.locked ? '#be123c' : '#a8a29e' }}>{e.locked ? <FiLock /> : <FiUnlock />}</button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* hidden file pickers (picture element / frame artwork) */}
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; handleImageFile(f); }} />
      <input ref={frameInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFrameUpload(f); }} />

      {/* ── design gallery ─────────────────────────────────────────────── */}
      <Drawer
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        placement="right"
        width="min(1180px, 96vw)"
        zIndex={1300}
        title={<div><div style={{ fontWeight: 600 }}>डिज़ाइन गैलरी</div><div style={{ fontSize: 12, color: '#78716c', fontWeight: 400 }}>एक डिज़ाइन चुनें — फिर उसमें नाम, रंग, मुहर, हस्ताक्षर सब बदल सकते हैं। ट्रस्ट का नाम, पता, लोगो Settings → Organization से अपने आप आते हैं।</div></div>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 18 }}>
          {GALLERY.map((g) => {
            const t = normalizeTemplate(templateFromGallery(g.key));
            return (
              <div key={g.key} style={{ border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 12, background: '#f5f5f4', pointerEvents: 'none' }}>
                  <BuilderCanvas tpl={t} frameSrc="" displayW={316} sampleData={SAMPLE_MEMBER} sampleProgram={SAMPLE_PROGRAM}
                    sampleTrust={sampleTrust} selectedId={null} onSelect={() => {}} onPatch={() => {}} showOutlines={false} />
                </div>
                <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{g.name}</span>
                    <span style={{ fontSize: 12, color: '#78716c' }}>{g.hi}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#57534e', flex: 1 }}>{g.note}</div>
                  <Button type="primary" block onClick={() => applyGallery(g.key)}>ये डिज़ाइन लें</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Drawer>

      {/* ── preview ─────────────────────────────────────────────────────── */}
      <Drawer
        open={preview.open}
        onClose={closePreview}
        placement="right"
        width="92%"
        zIndex={1300}
        title="प्रीव्यू (सैंपल डेटा)"
        destroyOnHidden
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
        extra={
          preview.url ? (
            <Button
              type="primary"
              icon={<FiDownload />}
              href={preview.url}
              download={`${tpl.name || 'certificate'}-sample.pdf`}
            >
              PDF डाउनलोड
            </Button>
          ) : null
        }
      >
        <div style={{ width: '100%', height: 'calc(100vh - 56px)' }}>
          {preview.loading && <Spin style={{ display: 'block', margin: '96px auto' }} />}
          {preview.error && (
            <Alert style={{ margin: 24 }} type="error" showIcon message="प्रीव्यू नहीं बन पाया" description={preview.error} />
          )}
          {preview.url && (
            <iframe title="certificate preview" src={preview.url} style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </div>
      </Drawer>
    </div>
  );
}
