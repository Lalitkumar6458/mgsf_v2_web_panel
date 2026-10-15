import { route } from "@/lib/http.js";
import { listJobs } from "@/services/receiptJobs.js";

/** Recent receipt runs of this trust (last 24 h). ?programId= */
export const GET = route(async ({ auth, query }) => ({ jobs: listJobs(auth.adminId, query.get("programId") || undefined) }));
