// Route guard for trust staff users (see lib/permissions.js). Plain module so tests can import it.
import { apiPermission, allowed, MODULES } from "./permissions.js";
import { forbidden } from "./errors.js";

/**
 * Staff users (admin login with a custom role) may only call what their role allows.
 * Super admin, agents, members and owner are not limited here (they have their own checks).
 */
export function assertApiAccess(auth, request) {
  if (auth?.role !== "admin" || !auth.access || auth.access.isSuper) return;
  const rule = apiPermission(request.method, new URL(request.url).pathname);
  if (allowed(auth.access, rule)) return;
  const mod = MODULES.find((m) => m.key === (rule.module || rule.any?.[0]?.[0]));
  const act = rule.action || rule.any?.[0]?.[1] || "view";
  throw forbidden(`Aapke role (${auth.access.roleName}) ko ${mod?.label || "is screen"} — ${act} ki permission nahi hai`);
}
