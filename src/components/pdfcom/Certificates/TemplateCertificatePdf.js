// A member certificate drawn from a Certificate Builder template (ported from gsmsy-web-panel).
//
// Element coordinates are artwork pixels; this file is the single place that converts them to
// PDF points, using the same separate X and Y scales as the builder canvas, so what is dragged
// on screen is what prints.
//
// @react-pdf throws on a style value it cannot parse ("Invalid border radius", "Invalid color")
// and the whole PDF fails. Templates are user-authored data, so every value goes through
// num() / color() / style() first and a half-filled element cannot break the page.
//
// Works in the browser (PDFViewer / pdf().toBlob()) and on the server (renderToBuffer). On the
// server, pass images already resolved to { data, format } — see resolveCertificateImages().
import React from "react";
import { Document, Page, Text, View, Image, Font } from "@react-pdf/renderer";
import "@/lib/pdfDevanagariFix";
import NotoSansDevanagari from "@/app/api/helperfile/static/font/NotoSansDevanagari";
import NotoSansDevanagariBold from "@/app/api/helperfile/static/font/NotoSansDevanagariBold";
import { normalizeTemplate, buildContext, resolveField, readPath, clean } from "@/lib/certificateTemplate";

Font.register({
  family: "NotoSansDevanagari",
  fonts: [
    { src: NotoSansDevanagari, fontWeight: "normal" },
    { src: NotoSansDevanagariBold, fontWeight: "bold" },
  ],
});

const MM_TO_PT = 72 / 25.4;

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const color = (v, fallback) => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^#[0-9a-f]{3,8}$/i.test(s) || /^[a-z]+$/i.test(s) ? s : fallback;
};

/** react-pdf rejects a falsy borderRadius / borderWidth outright. */
const ZERO_IS_ILLEGAL = ["borderRadius", "borderWidth"];

const style = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    if (!v && ZERO_IS_ILLEGAL.includes(k)) continue;
    out[k] = v;
  }
  return out;
};

/**
 * http(s) URL, our own "/api/files/…" (made absolute in the browser), or an already-loaded
 * { data, format } image. Never a stray data URL or a local path.
 */
export const imageSrc = (v) => {
  if (v && typeof v === "object" && v.data) return v;
  const s = clean(v);
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpe?g);base64,/i.test(s)) return s; // trust images inlined by the server
  if (s.startsWith("/api/files/") && typeof window !== "undefined") return `${window.location.origin}${s}`;
  return "";
};

const BORDER_STYLES = ["solid", "dashed", "dotted"];
const fitOf = (v, d) => (["contain", "cover", "fill"].includes(v) ? v : d);

function Element({ el, ctx, S }) {
  const { X, Y, F } = S;
  const opacity = el.opacity === undefined || el.opacity === "" ? undefined : Math.max(0.05, Math.min(1, num(el.opacity, 1)));
  const bStyle = BORDER_STYLES.includes(el.borderStyle) ? el.borderStyle : "solid";

  const left = X(num(el.x));
  const top = Y(num(el.y));
  const fontSize = F(num(el.fontSize, 16.3));
  const fontWeight = el.bold === false ? "normal" : "bold";
  const align = ["left", "center", "right"].includes(el.align) ? el.align : "left";
  const radius = X(num(el.radius)) || undefined;
  const borderW = num(el.border) || undefined;

  if (el.type === "image") {
    const src = imageSrc(readPath(ctx, el.fieldKey));
    return (
      <View
        style={style({
          position: "absolute", left, top,
          width: X(num(el.w, 90)), height: Y(num(el.h, 120)),
          borderWidth: borderW,
          borderColor: borderW ? color(el.borderColor, "#4a4a4a") : undefined,
          borderStyle: borderW ? bStyle : undefined,
          borderRadius: radius,
          backgroundColor: color(el.bg, "#ffffff"),
          overflow: "hidden",
          opacity,
        })}
      >
        {src ? <Image src={src} style={{ width: "100%", height: "100%", objectFit: fitOf(el.fit, "cover") }} /> : null}
      </View>
    );
  }

  if (el.type === "picture") {
    const src = imageSrc(el.src);
    if (!src) return null;
    return (
      <View
        style={style({
          position: "absolute", left, top,
          width: X(num(el.w, 120)), height: Y(num(el.h, 90)),
          borderWidth: borderW,
          borderColor: borderW ? color(el.borderColor, "#4a4a4a") : undefined,
          borderStyle: borderW ? bStyle : undefined,
          borderRadius: radius,
          overflow: "hidden",
          opacity,
        })}
      >
        <Image src={src} style={{ width: "100%", height: "100%", objectFit: fitOf(el.fit, "contain") }} />
      </View>
    );
  }

  if (el.type === "box") {
    const inner = el.fieldKey ? resolveField(ctx, el) : el.text || "";
    return (
      <View
        style={style({
          position: "absolute", left, top,
          width: X(num(el.w, 120)), height: Y(num(el.h, 30)),
          backgroundColor: color(el.bg, undefined),
          borderWidth: borderW,
          borderColor: borderW ? color(el.borderColor, "#1a1a1a") : undefined,
          borderStyle: borderW ? bStyle : undefined,
          borderRadius: radius,
          opacity,
          justifyContent: el.vcenter === false ? "flex-start" : "center",
          alignItems: align === "right" ? "flex-end" : align === "left" ? "flex-start" : "center",
          paddingHorizontal: X(3),
        })}
      >
        {inner ? (
          <Text style={style({ fontSize, fontWeight, color: color(el.color, "#111111"), textAlign: align })}>{inner}</Text>
        ) : null}
      </View>
    );
  }

  if (el.type === "field" && num(el.charBoxes) > 0) {
    // one character per box: "0 0 4 7 3"; shorter values are padded on the left (with 0 for numbers)
    const n = Math.min(20, Math.round(num(el.charBoxes)));
    const raw = clean(readPath(ctx, el.fieldKey)) || clean(el.fallback);
    const chars = Array.from(raw).slice(-n);
    const pad = /^\d+$/.test(raw) ? "0" : " ";
    while (chars.length < n) chars.unshift(pad);
    const bw = X(num(el.w, 140)) / n;
    return (
      <View style={style({ position: "absolute", left, top, flexDirection: "row", opacity })}>
        {chars.map((c, i) => (
          <View key={i} style={style({
            width: bw - 2, marginRight: 2, height: Y(num(el.h, 28)), alignItems: "center", justifyContent: "center",
            borderWidth: num(el.border, 1) || 1, borderColor: color(el.borderColor, "#333333"), borderStyle: bStyle,
            backgroundColor: color(el.bg, undefined), borderRadius: radius,
          })}>
            <Text style={style({ fontSize, fontWeight, color: color(el.color, "#000000") })}>{c}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (el.type === "field") {
    const value = resolveField(ctx, el);
    const hasLine = el.underline && el.underline !== "none";
    return (
      <View style={style({ position: "absolute", left, top, width: X(num(el.w, 140)), opacity })}>
        <Text
          style={style({
            fontSize, fontWeight, color: color(el.color, "#000000"), textAlign: align,
            paddingHorizontal: X(3), paddingBottom: Y(2),
          })}
        >
          {value || " "}
        </Text>
        {hasLine ? (
          <View
            style={{
              borderBottomWidth: 0.8,
              borderBottomColor: color(el.lineColor, "#555555"),
              borderBottomStyle: el.underline === "solid" ? "solid" : "dotted",
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <Text
      style={style({
        position: "absolute", left, top,
        width: el.w ? X(num(el.w)) : undefined,
        fontSize, fontWeight, color: color(el.color, "#111111"), textAlign: align, opacity,
      })}
    >
      {el.text || ""}
    </Text>
  );
}

export function TemplateCertificatePage({ template, member, program, now, trust }) {
  const tpl = normalizeTemplate(template);
  const ctx = buildContext(member, program, now, trust);

  const PAGE_W = num(tpl.page?.wmm, 210) * MM_TO_PT;
  const PAGE_H = num(tpl.page?.hmm, 148) * MM_TO_PT;
  const ART_W = num(tpl.art?.w, 1104) || 1104;
  const ART_H = num(tpl.art?.h, 739) || 739;

  const SX = PAGE_W / ART_W;
  const SY = PAGE_H / ART_H;
  const S = { X: (px) => px * SX, Y: (px) => px * SY, F: (px) => px * SY };

  const frame = imageSrc(tpl.frameImg);

  return (
    <Page size={{ width: PAGE_W, height: PAGE_H }} style={{ backgroundColor: color(tpl.bg?.color, "#ffffff"), fontFamily: "NotoSansDevanagari", position: "relative" }}>
      {frame ? <Image src={frame} style={{ position: "absolute", top: 0, left: 0, width: PAGE_W, height: PAGE_H }} /> : null}
      {(tpl.elements || []).filter((el) => !el.hidden).map((el, i) => (
        <Element key={el.id || `el_${i}`} el={el} ctx={ctx} S={S} />
      ))}
    </Page>
  );
}

/** One page per member — a single certificate, or a whole batch. */
export default function TemplateCertificatePdf({ template, members = [], program, title, trust }) {
  const now = Date.now();
  return (
    <Document title={title || template?.name || "सदस्यता प्रमाण पत्र"}>
      {members.map((m, i) => (
        <TemplateCertificatePage key={`${m?.id || m?.registrationNumber || "m"}_${i}`} template={template} member={m} program={program} now={now} trust={trust} />
      ))}
    </Document>
  );
}
