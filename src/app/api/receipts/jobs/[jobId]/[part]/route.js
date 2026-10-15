import { readFile } from "node:fs/promises";
import { getAuth } from "@/lib/auth.js";
import { assertApiAccess } from "@/lib/apiAccess.js";
import { getJob } from "@/services/receiptJobs.js";

export const runtime = "nodejs";

/** The PDF of one finished part. ?download=1 → save instead of open */
export async function GET(request, ctx) {
  let auth;
  try { auth = await getAuth(request); } catch { return new Response("Unauthorized", { status: 401 }); }
  try { assertApiAccess(auth, request); } catch (e) { return new Response(e.message, { status: 403 }); }
  const { jobId, part } = await ctx.params;
  const job = getJob(auth.adminId, jobId);
  const p = job?.parts.find((x) => String(x.n) === String(part));
  if (!p || p.status !== "done" || !p.file) return new Response("Not ready", { status: 404 });
  const data = await readFile(p.file).catch(() => null);
  if (!data) return new Response("File expired", { status: 410 });
  const name = `receipts-${job.status}-part${p.n}-of-${job.parts.length}.pdf`;
  const dl = new URL(request.url).searchParams.get("download");
  return new Response(data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
