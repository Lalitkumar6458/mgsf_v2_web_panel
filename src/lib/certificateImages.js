// Server side only: load the frame and photo of a template certificate before rendering.
// react-pdf on the server cannot reach a relative "/api/files/…" URL, and fetching our own
// public URL goes out through the internet and back — read local uploads straight from disk.
import { readLocalUpload } from "./storage.js";

const FORMAT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg" };

export async function loadImage(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    const local = s.match(/\/api\/files\/(.+)$/);
    if (local) {
      const f = await readLocalUpload(decodeURIComponent(local[1]));
      return f && FORMAT[f.type] ? { data: f.data, format: FORMAT[f.type] } : "";
    }
    if (/^https?:\/\//i.test(s)) {
      const res = await fetch(s, { signal: AbortSignal.timeout(10000) });
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!res.ok || !FORMAT[type]) return "";
      return { data: Buffer.from(await res.arrayBuffer()), format: FORMAT[type] };
    }
  } catch (e) {
    console.error("[certificate] image not loaded:", s, e.message);
  }
  return "";
}

/** Template's frame + every image field the template uses, for each member. */
export async function resolveCertificateImages(template, members) {
  const imageKeys = [...new Set((template.elements || []).filter((e) => e.type === "image" && e.fieldKey).map((e) => e.fieldKey))];
  const frameImg = await loadImage(template.frameImg);
  // uploaded stamp / signature / logo pictures
  const elements = [];
  for (const e of template.elements || []) elements.push(e.type === "picture" && e.src ? { ...e, src: await loadImage(e.src) } : e);
  const out = [];
  for (const m of members) {
    const copy = { ...m };
    for (const k of imageKeys) if (!k.includes(".") && copy[k] && !String(copy[k]).startsWith("data:")) copy[k] = await loadImage(copy[k]);
    out.push(copy);
  }
  return { template: { ...template, frameImg, elements }, members: out };
}
