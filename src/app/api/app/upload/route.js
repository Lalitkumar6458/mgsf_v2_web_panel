// Mobile app photo / document upload as JSON { data: base64 JPEG, folder, name } → { url }.
// (React Native's multipart upload fails on some Android phones; base64 JSON always goes through.)
import { route, readJson } from "@/lib/http.js";
import { saveUpload } from "@/lib/storage.js";
import { badRequest, forbidden } from "@/lib/errors.js";

export const POST = route(async ({ auth, request }) => {
  const { data, folder = "members", name = "photo.jpg" } = await readJson(request);
  if (auth.role === "member" && folder !== "payments") throw forbidden(); // members: only the payment screenshot
  const b64 = String(data || "").replace(/^data:[^,]+,/, "");
  if (!b64) throw badRequest("फोटो नहीं मिली");
  const buf = Buffer.from(b64, "base64");
  const type = buf[0] === 0x89 ? "image/png" : buf[0] === 0x25 ? "application/pdf" : "image/jpeg";
  const file = new File([buf], String(name).replace(/[^\w.-]/g, "_") || "photo.jpg", { type });
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, "") || "members";
  return { success: true, url: await saveUpload(file, `${auth.adminId}/${safeFolder}`) };
});
