// DELETE → remove a wrong cash-handover entry (kept in the table, marked deleted; the audit log has who did it).
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden } from "@/lib/errors.js";
import { deleteHandover } from "@/services/cashHandover.js";

export const DELETE = route(async ({ auth, params }) => {
  if (auth.role !== "admin" && auth.role !== "owner") throw forbidden();
  const program = await getProgramFor(auth, params.programId);
  return { success: true, ...(await deleteHandover(program.adminId, params.programId, params.id)) };
});
