'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiImage } from 'react-icons/fi';

import { buildContext, resolveField, readPath, clean } from '@/lib/certificateTemplate';

/**
 * (ported from gsmsy-web-panel) The builder's drawing surface: the frame artwork with every template element
 * laid over it, using the SAME maths as the PDF renderer (separate X and Y
 * scales), so what is dragged here is exactly what prints.
 *
 *   screenX = artX * scaleX      scaleX = displayW / art.w
 *   screenY = artY * scaleY      scaleY = displayH / art.h
 *   fontPx  = artFont * scaleY   (the PDF derives point size from SY too)
 *
 * Editing: click = select · Shift/Ctrl+click = add to the selection · drag on empty page = box
 * select · dragging moves the whole selection and snaps to the page centre and to other
 * elements' edges / centres (pink guide lines; hold Alt to place freely). Locked elements
 * cannot be dragged; hidden ones show faded here and do not print.
 */

const SNAP_PX = 6; // screen pixels

const FONT_STACK =
  "'Noto Sans Devanagari','Nirmala UI','Mangal','Segoe UI',system-ui,sans-serif";

export default function BuilderCanvas({
  tpl,
  frameSrc,
  displayW,
  sampleData,
  sampleProgram,
  sampleTrust,
  selectedId,
  selectedIds,
  onSelect, // (id | null, { add }) → selection
  onSelectMany, // (ids) → box selection
  onPatch, // (id, patch) → live update while dragging (one element)
  onPatchMany, // ({ id: patch }) → live update while dragging (several)
  onCommit, // () → one history entry when a drag ends
  showOutlines = true,
}) {
  const artW = tpl?.art?.w || 1104;
  const artH = tpl?.art?.h || 739;
  const pageRatio = (tpl?.page?.hmm || 148) / (tpl?.page?.wmm || 210);

  const displayH = displayW * pageRatio;
  const scaleX = displayW / artW;
  const scaleY = displayH / artH;

  const ctx = useMemo(() => buildContext(sampleData, sampleProgram, Date.now(), sampleTrust), [sampleData, sampleProgram, sampleTrust]);
  const drag = useRef(null);
  const rootRef = useRef(null);
  const [guides, setGuides] = useState([]); // [{ x } | { y }] in art pixels
  const [marquee, setMarquee] = useState(null); // { x0, y0, x1, y1 } in screen pixels

  const selSet = useMemo(() => new Set(selectedIds || (selectedId ? [selectedId] : [])), [selectedIds, selectedId]);
  const patchMany = useCallback((map) => {
    if (onPatchMany) onPatchMany(map);
    else for (const [id, p] of Object.entries(map)) onPatch?.(id, p);
  }, [onPatchMany, onPatch]);

  /** every element's box in art pixels, measured from the DOM (text has no stored width) */
  const measureAll = useCallback(() => {
    const root = rootRef.current;
    if (!root) return {};
    const r0 = root.getBoundingClientRect();
    const out = {};
    root.querySelectorAll('[data-el-id]').forEach((n) => {
      const r = n.getBoundingClientRect();
      out[n.dataset.elId] = {
        x: (r.left - r0.left) / scaleX, y: (r.top - r0.top) / scaleY,
        w: r.width / scaleX, h: r.height / scaleY,
      };
    });
    return out;
  }, [scaleX, scaleY]);

  const startDrag = useCallback(
    (e, el, mode) => {
      e.preventDefault();
      e.stopPropagation();
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (add && mode === 'move') { onSelect(el.id, { add: true }); return; }
      const group = selSet.has(el.id) && mode === 'move' ? [...selSet] : [el.id];
      if (!selSet.has(el.id) || mode !== 'move') onSelect(el.id, { add: false });
      if (el.locked && mode === 'move') return; // locked: select only
      const els = Object.fromEntries((tpl?.elements || []).map((x) => [x.id, x]));
      const ids = group.filter((id) => els[id] && !els[id].locked);
      const boxes = measureAll();
      drag.current = {
        mode, // 'move' | 'size' | 'width'
        id: el.id,
        ids,
        startX: e.clientX,
        startY: e.clientY,
        origins: Object.fromEntries(ids.map((id) => [id, { x: els[id].x || 0, y: els[id].y || 0, w: els[id].w || 0, h: els[id].h || 0 }])),
        origin: { x: el.x || 0, y: el.y || 0, w: el.w || 0, h: el.h || 0 },
        boxes,
        others: Object.entries(boxes).filter(([id]) => !ids.includes(id) && !els[id]?.hidden).map(([, b]) => b),
        axis: null,
      };
    },
    [onSelect, selSet, tpl, measureAll],
  );

  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      let dx = (e.clientX - d.startX) / scaleX;
      let dy = (e.clientY - d.startY) / scaleY;

      // Shift locks a move to whichever axis it started along.
      if (e.shiftKey && d.mode === 'move') {
        if (!d.axis) d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (d.axis === 'x') dy = 0;
        else dx = 0;
      } else if (d.mode === 'move') {
        d.axis = null;
      }

      if (d.mode === 'move') {
        // the moving group's box, then snap its left / centre / right (top / middle / bottom)
        const bs = d.ids.map((id) => d.boxes[id]).filter(Boolean);
        const g = bs.length
          ? { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), r: Math.max(...bs.map((b) => b.x + b.w)), b: Math.max(...bs.map((b) => b.y + b.h)) }
          : null;
        const lines = [];
        if (g && !e.altKey) {
          const tx = [artW / 2, ...d.others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
          const ty = [artH / 2, ...d.others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
          const best = (edges, targets, lim) => {
            let hit = null;
            for (const ed of edges) for (const t of targets) {
              const diff = t - ed;
              if (Math.abs(diff) <= lim && (!hit || Math.abs(diff) < Math.abs(hit.diff))) hit = { diff, at: t };
            }
            return hit;
          };
          const w = g.r - g.x, h = g.b - g.y;
          const sx = d.axis === 'y' ? null : best([g.x + dx, g.x + dx + w / 2, g.x + dx + w], tx, SNAP_PX / scaleX);
          const sy = d.axis === 'x' ? null : best([g.y + dy, g.y + dy + h / 2, g.y + dy + h], ty, SNAP_PX / scaleY);
          if (sx) { dx += sx.diff; lines.push({ x: sx.at }); }
          if (sy) { dy += sy.diff; lines.push({ y: sy.at }); }
        }
        setGuides(lines);
        const map = {};
        for (const id of d.ids) {
          const o = d.origins[id];
          map[id] = { x: Math.max(0, Math.round(o.x + dx)), y: Math.max(0, Math.round(o.y + dy)) };
        }
        patchMany(map);
      } else if (d.mode === 'width') {
        patchMany({ [d.id]: { w: Math.max(12, Math.round(d.origin.w + dx)) } });
      } else {
        patchMany({ [d.id]: {
          w: Math.max(12, Math.round(d.origin.w + dx)),
          h: Math.max(1, Math.round(d.origin.h + dy)),
        } });
      }
    };

    const up = () => {
      if (drag.current) {
        drag.current = null;
        setGuides([]);
        onCommit?.();
      }
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [scaleX, scaleY, artW, artH, patchMany, onCommit]);

  // box select: drag on the empty page
  const startMarquee = (e) => {
    if (e.button !== 0) return;
    const r0 = rootRef.current.getBoundingClientRect();
    const p = { x0: e.clientX - r0.left, y0: e.clientY - r0.top };
    setMarquee({ ...p, x1: p.x0, y1: p.y0 });
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const moveM = (ev) => setMarquee((m) => m && { ...m, x1: ev.clientX - r0.left, y1: ev.clientY - r0.top });
    const upM = (ev) => {
      window.removeEventListener('mousemove', moveM);
      window.removeEventListener('mouseup', upM);
      const m = { ...p, x1: ev.clientX - r0.left, y1: ev.clientY - r0.top };
      setMarquee(null);
      const [ax, bx] = [Math.min(m.x0, m.x1) / scaleX, Math.max(m.x0, m.x1) / scaleX];
      const [ay, by] = [Math.min(m.y0, m.y1) / scaleY, Math.max(m.y0, m.y1) / scaleY];
      if (bx - ax < 3 / scaleX && by - ay < 3 / scaleY) { if (!add) onSelect(null, { add: false }); return; }
      const boxes = measureAll();
      // an element is picked when it lies fully inside the box (so big frames are not grabbed by accident)
      const hit = Object.entries(boxes).filter(([, b]) => b.x >= ax && b.y >= ay && b.x + b.w <= bx && b.y + b.h <= by).map(([id]) => id);
      onSelectMany?.(add ? [...new Set([...selSet, ...hit])] : hit);
    };
    window.addEventListener('mousemove', moveM);
    window.addEventListener('mouseup', upM);
  };

  const handle = (el, mode, style) => (
    <div
      onMouseDown={(e) => startDrag(e, el, mode)}
      style={{
        position: 'absolute', width: 10, height: 10, background: '#fff',
        border: '2px solid #e11d48', borderRadius: 2, zIndex: 5, ...style,
      }}
    />
  );

  const renderElement = (el) => {
    const selected = selSet.has(el.id);
    const single = selected && selSet.size === 1 && !el.locked; // resize handles only then
    const left = (el.x || 0) * scaleX;
    const top = (el.y || 0) * scaleY;
    const fontPx = (el.fontSize || 16.3) * scaleY;
    const fontWeight = el.bold === false ? 400 : 700;

    const ring = selected
      ? { outline: el.locked ? '1.5px dashed #e11d48' : '1.5px solid #e11d48', outlineOffset: 1 }
      : showOutlines
        ? { outline: '1px dashed rgba(120,120,120,.45)', outlineOffset: 1 }
        : {};

    const opacity = (el.opacity === undefined || el.opacity === '' ? 1 : Number(el.opacity)) * (el.hidden ? 0.25 : 1);
    const wrap = { position: 'absolute', left, top, cursor: el.locked ? 'default' : 'move', fontFamily: FONT_STACK, opacity, ...ring };
    const bStyle = ['solid', 'dashed', 'dotted'].includes(el.borderStyle) ? el.borderStyle : 'solid';
    const fit = (d) => (['contain', 'cover', 'fill'].includes(el.fit) ? el.fit : d);

    if (el.type === 'picture') {
      return (
        <div
          key={el.id} data-el-id={el.id}
          onMouseDown={(e) => startDrag(e, el, 'move')}
          style={{
            ...wrap,
            width: (el.w || 120) * scaleX,
            height: (el.h || 90) * scaleY,
            border: el.border ? `${el.border}px ${bStyle} ${el.borderColor || '#4a4a4a'}` : 'none',
            borderRadius: (el.radius || 0) * scaleX,
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#bbb', background: el.src ? 'transparent' : 'rgba(0,0,0,0.04)',
          }}
        >
          {el.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={el.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: fit('contain') }} />
          ) : <FiImage size={18} />}
          {single && handle(el, 'size', { right: -6, bottom: -6, cursor: 'nwse-resize' })}
        </div>
      );
    }

    if (el.type === 'field' && Number(el.charBoxes) > 0) {
      const n = Math.min(20, Math.round(Number(el.charBoxes)));
      const raw = clean(readPath(ctx, el.fieldKey)) || clean(el.fallback);
      const chars = Array.from(raw).slice(-n);
      const pad = /^\d+$/.test(raw) ? '0' : ' ';
      while (chars.length < n) chars.unshift(pad);
      const bw = ((el.w || 140) * scaleX) / n;
      return (
        <div key={el.id} data-el-id={el.id} onMouseDown={(e) => startDrag(e, el, 'move')} style={{ ...wrap, display: 'flex', width: (el.w || 140) * scaleX }}>
          {chars.map((c, i) => (
            <span key={i} style={{
              width: bw - 2, marginRight: 2, height: (el.h || 28) * scaleY, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `${el.border || 1}px ${bStyle} ${el.borderColor || '#333'}`, background: el.bg || 'transparent', borderRadius: (el.radius || 0) * scaleX,
              fontSize: fontPx, fontWeight, color: el.color || '#000', boxSizing: 'border-box',
            }}>{c}</span>
          ))}
          {single && handle(el, 'width', { right: -6, top: '35%', cursor: 'ew-resize' })}
        </div>
      );
    }

    if (el.type === 'image') {
      const src = clean(readPath(ctx, el.fieldKey));
      return (
        <div
          key={el.id} data-el-id={el.id}
          onMouseDown={(e) => startDrag(e, el, 'move')}
          style={{
            ...wrap,
            width: (el.w || 90) * scaleX,
            height: (el.h || 120) * scaleY,
            border: el.border ? `${el.border}px ${bStyle} ${el.borderColor || '#4a4a4a'}` : 'none',
            borderRadius: (el.radius || 0) * scaleX,
            background: el.bg || '#ffffff',
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#bbb',
          }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: fit('cover') }} />
          ) : (
            <FiImage size={Math.min(22, (el.w || 90) * scaleX * 0.3)} />
          )}
          {single && handle(el, 'size', { right: -6, bottom: -6, cursor: 'nwse-resize' })}
        </div>
      );
    }

    if (el.type === 'box') {
      const inner = el.fieldKey ? resolveField(ctx, el) : el.text || '';
      return (
        <div
          key={el.id} data-el-id={el.id}
          onMouseDown={(e) => startDrag(e, el, 'move')}
          style={{
            ...wrap,
            width: (el.w || 120) * scaleX,
            height: (el.h || 30) * scaleY,
            background: el.bg || 'transparent',
            border: el.border ? `${el.border}px ${bStyle} ${el.borderColor || '#1a1a1a'}` : 'none',
            borderRadius: (el.radius || 0) * scaleX,
            display: 'flex',
            alignItems: el.vcenter === false ? 'flex-start' : 'center',
            justifyContent:
              el.align === 'right' ? 'flex-end' : el.align === 'left' ? 'flex-start' : 'center',
            padding: `0 ${3 * scaleX}px`,
            boxSizing: 'border-box',
          }}
        >
          <span style={{ fontSize: fontPx, fontWeight, color: el.color || '#111', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            {inner}
          </span>
          {single && handle(el, 'size', { right: -6, bottom: -6, cursor: 'nwse-resize' })}
        </div>
      );
    }

    if (el.type === 'field') {
      const value = resolveField(ctx, el);
      const hasLine = el.underline && el.underline !== 'none';
      return (
        <div
          key={el.id} data-el-id={el.id}
          onMouseDown={(e) => startDrag(e, el, 'move')}
          style={{ ...wrap, width: (el.w || 140) * scaleX }}
        >
          <div
            style={{
              fontSize: fontPx, fontWeight, color: el.color || '#000',
              textAlign: el.align || 'left', lineHeight: 1.2,
              padding: `0 ${3 * scaleX}px ${2 * scaleY}px`,
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            {value || ' '}
          </div>
          {hasLine && <div style={{ borderBottom: `1px ${el.underline} ${el.lineColor || '#555'}` }} />}
          {single && handle(el, 'width', { right: -6, top: '35%', cursor: 'ew-resize' })}
        </div>
      );
    }

    return (
      <div
        key={el.id} data-el-id={el.id}
        onMouseDown={(e) => startDrag(e, el, 'move')}
        style={{
          ...wrap,
          ...(el.w ? { width: el.w * scaleX } : {}),
          fontSize: fontPx, fontWeight, color: el.color || '#111',
          textAlign: el.align || 'left', lineHeight: 1.2, whiteSpace: 'nowrap',
        }}
      >
        {el.text || ''}
        {single && el.w ? handle(el, 'width', { right: -6, top: '30%', cursor: 'ew-resize' }) : null}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative', width: displayW, height: displayH, background: tpl?.bg?.color || '#fff',
        boxShadow: '0 1px 12px rgba(0,0,0,.12)', userSelect: 'none',
        flex: '0 0 auto', margin: '0 auto',
      }}
      onMouseDown={startMarquee}
    >
      {frameSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frameSrc}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      ) : (tpl?.elements?.length ? null :
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#9ca3af', fontSize: 13, border: '1px dashed #d4d4d4',
          }}
        >
          कोई फ्रेम इमेज नहीं — ऊपर “फ्रेम इमेज” से अपलोड करें
        </div>
      )}

      {(tpl?.elements || []).map(renderElement)}

      {guides.map((g, i) => (
        <div key={i} style={g.x !== undefined
          ? { position: 'absolute', left: g.x * scaleX, top: 0, bottom: 0, width: 0, borderLeft: '1px solid #ec4899', pointerEvents: 'none', zIndex: 20 }
          : { position: 'absolute', top: g.y * scaleY, left: 0, right: 0, height: 0, borderTop: '1px solid #ec4899', pointerEvents: 'none', zIndex: 20 }} />
      ))}
      {marquee && (
        <div style={{
          position: 'absolute', left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
          width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
          border: '1px dashed #e11d48', background: 'rgba(225,29,72,0.06)', pointerEvents: 'none', zIndex: 21,
        }} />
      )}
    </div>
  );
}
