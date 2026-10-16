"use client";
// Verify QR images for certificate designs that use the "verifyQr" image field.
import { api } from "./api";

export const usesVerifyQr = (template) => !!template?.elements?.some((e) => e.fieldKey === "verifyQr" && !e.hidden);

const toPng = async (text) => (await import("qrcode")).toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 300 });

let sample = null;
/** A sample QR for the builder canvas / preview. */
export const sampleVerifyQr = () => (sample ??= toPng("https://example.in/verify/c/sample"));

/** members (with id) → same members with verifyQr (PNG data URL), only if the design needs it. */
export async function attachVerifyQr(members, template) {
  if (!usesVerifyQr(template) || !members?.length) return members;
  const ids = members.map((m) => m.id || m.memberId).filter(Boolean);
  const { urls } = await api.post("/certificate-templates/verify-codes", { memberIds: ids });
  return Promise.all(members.map(async (m) => {
    const url = urls?.[m.id || m.memberId];
    return url ? { ...m, verifyQr: await toPng(url) } : m;
  }));
}
