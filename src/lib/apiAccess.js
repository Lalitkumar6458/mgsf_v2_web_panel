// Route guard for trust users (see lib/permissions.js, lib/features.js). Plain module so tests can import it.
import { apiPermission, allowed, MODULES } from "./permissions.js";
import { featureForApi, featureLabel } from "./features.js";
import { forbidden } from "./errors.js";

/**
 * 1. Feature lock (developer's /feature-control page): applies to everyone of the trust —
 *    super admin, staff, agents, members. Owner is never limited.
 * 2. Roles: staff users (admin login with a custom role) may only call what their role allows.
 *    Super admin only meets switched-off screens here; agents / members / owner have their own checks.
 */
export function assertApiAccess(auth, request) {
  if (!auth || auth.role === "owner") return;
  const path = new URL(request.url).pathname;

  if (auth.features) {
    const fk = featureForApi(request.method, path);
    if (fk && auth.features[fk] === false) throw forbidden(`"${featureLabel(fk)}" is panel mein chalu nahi hai`);
  }

  if (auth.role !== "admin" || !auth.access) return;
  const rule = apiPermission(request.method, path);
  if (auth.access.isSuper) {
    // super admin: only screens switched off for the trust (unmapped routes stay open)
    if (!auth.access.off?.length || !rule || rule.fallback || allowed(auth.access, rule)) return;
    throw forbidden("Ye screen is panel mein chalu nahi hai");
  }
  if (allowed(auth.access, rule)) return;
  const mod = MODULES.find((m) => m.key === (rule.module || rule.any?.[0]?.[0]));
  const act = rule.action || rule.any?.[0]?.[1] || "view";
  throw forbidden(`Aapke role (${auth.access.roleName}) ko ${mod?.label || "is screen"} — ${act} ki permission nahi hai`);
}
