"use client";
// Browser side of the trust profile. Layout loads it into redux (state.data.trustData);
// every screen/PDF reads it from there. After Settings → Organization saves, call
// notifyTrustChanged() and every open tab reloads it — no page refresh needed.
import { api } from "./api";
import { normalizeTrust, TRUST_IMAGE_FIELDS } from "@/lib/trust/profile";

const EVENT = "mgsf:trust-changed";
const CHANNEL = "mgsf-trust";
const imageCache = new Map();

/** URL → data: URI, so react-pdf (and print windows) never need to fetch anything */
async function toDataUri(src) {
  if (!src || typeof src !== "string" || src.startsWith("data:")) return src;
  if (imageCache.has(src)) return imageCache.get(src);
  try {
    const res = await fetch(src, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const uri = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    imageCache.set(src, uri);
    return uri;
  } catch (e) {
    // e.g. an old Firebase Storage link without CORS: keep the URL (<img> still shows it)
    console.warn("trust image could not be inlined:", src, e);
    return src;
  }
}

export async function inlineTrustImages(profile) {
  const t = { ...profile };
  await Promise.all(TRUST_IMAGE_FIELDS.map(async (k) => { if (t[k]) t[k] = await toDataUri(t[k]); }));
  if (!t.RightLogo) t.RightLogo = t.logo;
  return t;
}

/** { profile (with data: images), stored (raw trust_info) } */
export async function loadTrustProfile() {
  const { trust, profile } = await api.get("/trust");
  return { profile: await inlineTrustImages(profile || normalizeTrust(trust?.trustInfo)), stored: trust?.trustInfo || {} };
}

/** Save Settings → Organization; tells every open screen to reload. */
export async function saveTrustProfile(data) {
  const res = await api.patch("/trust", { profile: data });
  notifyTrustChanged();
  return res.profile;
}

export function notifyTrustChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage("changed");
    bc.close();
  } catch { /* old browser */ }
}

/** Run cb whenever the trust profile changes (this tab or another). Returns unsubscribe. */
export function onTrustChanged(cb) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  let bc;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = cb;
  } catch { /* old browser */ }
  return () => {
    window.removeEventListener(EVENT, cb);
    bc?.close();
  };
}
