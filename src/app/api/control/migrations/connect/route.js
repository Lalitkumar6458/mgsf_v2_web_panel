// Data migration — POST { kind: "mgsf" | "trustNew", serviceAccount: <JSON text> | backup: <JSON backup text> } → the trusts found.
// The key is kept in server memory only (3 hours) and never written anywhere.
import { route, readJson } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { connect } from "@/services/migration/jobs.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = route(async ({ request }) => {
  await requireControl(request);
  const body = await readJson(request);
  return connect({ kind: body.kind, serviceAccount: body.serviceAccount, backup: body.backup });
}, { auth: false });
