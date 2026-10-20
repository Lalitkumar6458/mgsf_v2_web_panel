// The generated passwords of a migration run as CSV (Excel opens it). Share privately, then delete it on the page.
import { route } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { jobLoginsCsv } from "@/services/migration/jobs.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ request, params }) => {
  await requireControl(request);
  const { csv, name } = await jobLoginsCsv(params.id);
  const file = `logins-${String(name || params.id).replace(/[^\w-]+/g, "_").slice(0, 40)}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" } });
}, { auth: false });
