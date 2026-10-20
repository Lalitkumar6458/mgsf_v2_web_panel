// One migration run: GET → live steps, log, report.  POST { action: "cancel" | "dropLogins" | "revertInfo" | "revert", confirm }
import { route, readJson } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { badRequest } from "@/lib/errors.js";
import { getJob, cancelJob, dropLogins, revertInfo, revertJob } from "@/services/migration/jobs.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ request, params }) => {
  await requireControl(request);
  return { job: await getJob(params.id) };
}, { auth: false });
export const POST = route(async ({ request, params }) => {
  await requireControl(request);
  const { action, confirm } = await readJson(request);
  if (action === "cancel") return cancelJob(params.id);
  if (action === "dropLogins") return dropLogins(params.id);
  if (action === "revertInfo") return revertInfo(params.id);
  if (action === "revert") return revertJob(params.id, { confirm });
  throw badRequest('action: "cancel" | "dropLogins" | "revertInfo" | "revert"');
}, { auth: false });
