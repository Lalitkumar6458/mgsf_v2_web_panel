import { route } from "@/lib/http.js";
import { getJob, publicJob } from "@/services/receiptJobs.js";
import { notFound } from "@/lib/errors.js";

export const GET = route(async ({ auth, params }) => {
  const job = getJob(auth.adminId, params.jobId);
  if (!job) throw notFound("Receipt job not found (files are kept for 24 hours)");
  return { job: publicJob(job) };
});
