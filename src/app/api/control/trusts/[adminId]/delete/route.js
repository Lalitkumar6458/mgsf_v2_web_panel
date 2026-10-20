// Feature control → delete one trust completely (rows + uploaded files).
//   GET              → what would be removed (counts, files)
//   GET ?backup=1    → full JSON backup (download before deleting)
//   POST { confirm: "<admin e-mail>", deleteFiles: true }
import { route, readJson } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { clientIp } from "@/lib/access.js";
import { trustDeleteInfo, trustBackup, deleteTrust } from "@/services/trustDelete.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ request, params, query }) => {
  await requireControl(request);
  if (query.get("backup")) {
    const { json, name } = await trustBackup(params.adminId);
    return new Response(json, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
  }
  return trustDeleteInfo(params.adminId);
}, { auth: false });
export const POST = route(async ({ request, params }) => {
  await requireControl(request);
  const body = await readJson(request);
  return deleteTrust(params.adminId, { confirm: body.confirm, deleteFiles: body.deleteFiles !== false }, `control@${clientIp(request) || "?"}`);
}, { auth: false });
