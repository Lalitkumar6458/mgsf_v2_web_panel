// Data migration runs.
//   GET  → last runs
//   POST { connectionId, trustId, trustName, mode: "new"|"replace", dryRun, copyFiles, adminEmail, adminPassword } → { jobId }
import { route, readJson } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { clientIp } from "@/lib/access.js";
import { listJobs, startJob } from "@/services/migration/jobs.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ request }) => {
  await requireControl(request);
  return { jobs: await listJobs() };
}, { auth: false });
export const POST = route(async ({ request }) => {
  await requireControl(request);
  return startJob(await readJson(request), `control@${clientIp(request) || "?"}`);
}, { auth: false });
