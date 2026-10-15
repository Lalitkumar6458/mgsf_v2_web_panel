// Same letterhead as the PDF header (HeaderCom), as HTML for the print-window reports.
import { normalizeTrust, regLine } from "./profile.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function trustHeaderHtml(trust, { height = 130 } = {}) {
  const t = trust && trust.name !== undefined ? trust : normalizeTrust(trust);
  if (t.headerMode === "image" && t.headerImg) {
    return `<img src="${t.headerImg}" alt="" style="width:100%;height:${height}px;object-fit:fill;display:block"/>`;
  }
  const logo = Math.round(height * 0.85);
  const img = (src) => (src
    ? `<img src="${src}" alt="" style="width:${logo}px;height:${logo}px;object-fit:contain;flex-shrink:0"/>`
    : `<div style="width:${logo}px;flex-shrink:0"></div>`);
  const reg = regLine(t);
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:${height}px">
  ${img(t.logo)}
  <div style="flex:1;text-align:center;font-family:'Noto Sans Devanagari',sans-serif">
    <div style="color:#e0262b;font-weight:800;font-size:${Math.round(height * 0.22)}px;line-height:1.2">${esc(t.name)}</div>
    ${t.cityState ? `<div style="font-size:13px;color:#111;margin-top:2px">${esc(t.cityState)}</div>` : ""}
    ${t.address ? `<div style="font-size:13px;color:#111;margin-top:2px">${esc(t.address)}</div>` : ""}
    ${t.contact ? `<div style="font-size:13px;color:#111;margin-top:2px">मो. ${esc(t.contact)}</div>` : ""}
    ${reg ? `<div style="font-size:15px;color:#e0262b;font-weight:700;margin-top:4px">${esc(reg)}</div>` : ""}
  </div>
  ${img(t.RightLogo || t.logo)}
</div>`;
}
