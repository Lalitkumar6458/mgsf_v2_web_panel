import { route } from "@/lib/http.js";
import { badRequest, forbidden } from "@/lib/errors.js";
import { saveUpload } from "@/lib/storage.js";

/** multipart/form-data: file=<File>, folder=members|agents|closings|trust → { url } */
export const POST = route(async ({ request, auth }) => {
  if (auth.role === "member") throw forbidden();
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("file required");
  const folder = String(form.get("folder") || "misc").replace(/[^a-z0-9_-]/gi, "");
  return { success: true, url: await saveUpload(file, `${auth.adminId}/${folder}`) };
});
