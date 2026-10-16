// Screen / action permissions for trust staff users. Pure module — used by the API (lib/http.js route
// wrapper), by the browser (sidebar, page guard, buttons) and by tests.
//
// Who has what:
//   - the trust's own admin login (accounts.role = 'admin', role_id NULL)  → SUPER ADMIN, everything
//   - staff users (accounts.role = 'admin', role_id = a custom role)       → only what the role allows
//   - agents / members / owner are handled by their own rules, not by this file.

export const ACTIONS = ["view", "add", "edit", "delete"];
export const ACTION_LABEL = { view: "View", add: "Add", edit: "Edit", delete: "Delete" };

/** Every screen a role can be given. `actions` = which checkboxes make sense for it. */
export const MODULES = [
  { key: "dashboard", label: "Dashboard", hi: "डैशबोर्ड", actions: ["view"] },
  { key: "members", label: "Members", hi: "सदस्य", actions: ["view", "add", "edit", "delete"], hint: "Edit includes accepting requests, block, status" },
  { key: "agents", label: "Agents", hi: "एजेंट", actions: ["view", "add", "edit", "delete"] },
  { key: "yojna", label: "Yojna", hi: "योजना", actions: ["view", "add", "edit", "delete"] },
  { key: "closings", label: "Closed Members / Closing", hi: "क्लोजिंग", actions: ["view", "add", "edit", "delete"], hint: "Add = record closing, Delete = revert closing" },
  { key: "payments", label: "Payments & Receipts", hi: "भुगतान / रसीद", actions: ["view", "add", "delete"], hint: "Add = take payment / join fees / receipts, Delete = reverse payment" },
  { key: "reports", label: "Reports (late payments, agent performance)", hi: "रिपोर्ट", actions: ["view"] },
  { key: "commission", label: "Agent Commission", hi: "कमीशन", actions: ["view", "add", "edit"], hint: "Add = pay agent, Edit = revert payout" },
  { key: "master", label: "Master Data", hi: "मास्टर डेटा", actions: ["view", "add", "edit", "delete"] },
  { key: "users", label: "Users & Roles", hi: "यूज़र / रोल", actions: ["view", "add", "edit", "delete"] },
  { key: "settings", label: "Trust Settings", hi: "सेटिंग्स", actions: ["view", "edit"], hint: "Organization details, PDF header, rules" },
];
export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Clean a permissions object: { members: ["view","add"], … } — unknown keys/actions dropped, view implied. */
export function normalizePermissions(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const m of MODULES) {
    let acts = src[m.key];
    if (acts && !Array.isArray(acts) && typeof acts === "object") acts = Object.keys(acts).filter((k) => acts[k]);
    if (!Array.isArray(acts)) continue;
    const set = new Set(acts.filter((a) => m.actions.includes(a)));
    if (set.size && !set.has("view") && m.actions.includes("view")) set.add("view"); // can't edit what you can't see
    if (set.size) out[m.key] = m.actions.filter((a) => set.has(a));
  }
  return out;
}

export const FULL_ACCESS = Object.fromEntries(MODULES.map((m) => [m.key, [...m.actions]]));

/** Ready-made roles offered when creating a role */
export const ROLE_TEMPLATES = [
  { name: "Manager", description: "Everything except users & trust settings", permissions: Object.fromEntries(MODULES.filter((m) => !["users", "settings"].includes(m.key)).map((m) => [m.key, [...m.actions]])) },
  { name: "Accountant", description: "Payments, receipts, reports and commission", permissions: { dashboard: ["view"], members: ["view"], agents: ["view"], closings: ["view"], payments: ["view", "add"], reports: ["view"], commission: ["view", "add"] } },
  { name: "Data entry", description: "Add / edit members only", permissions: { members: ["view", "add", "edit"], agents: ["view"], master: ["view", "add"] } },
  { name: "Viewer", description: "Can see, cannot change", permissions: Object.fromEntries(MODULES.filter((m) => m.key !== "users").map((m) => [m.key, ["view"]])) },
];

/**
 * access = { isSuper, permissions } (what /api/auth/me returns as user.access).
 * Agents / members / owner never reach admin screens, so for them this answers false.
 */
export function can(access, module, action = "view") {
  if (!access) return false;
  if (access.off?.includes(module)) return false; // switched off for the whole trust (lib/features.js)
  if (access.isSuper) return true;
  return !!access.permissions?.[module]?.includes(action);
}

/** Screen path → module (page guard + sidebar) */
export const PAGE_MODULES = [
  ["/members", "members"],
  ["/agents", "agents"],
  ["/yojna", "yojna"],
  ["/closedMembers", "closings"],
  ["/closingPayments", "payments"],
  ["/transactions", "payments"],
  ["/agentCash", "payments"],
  ["/master", "master"],
  ["/reports", "reports"],
  ["/setting", null], // settings page itself: everyone (password / sessions); its tabs check their own module
];
export function pageModule(pathname) {
  if (pathname === "/") return "dashboard";
  const hit = PAGE_MODULES.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return hit ? hit[1] : null;
}

const W = { POST: "add", PUT: "edit", PATCH: "edit", DELETE: "delete" };

/**
 * API request → required permission.
 * Returns null (no check: login / branding / lists every form needs), { module, action },
 * or { any: [[module, action], …] } (any one is enough).
 */
export function apiPermission(method, pathname) {
  const p = pathname.replace(/^\/api/, "").replace(/\/+$/, "");
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";
  const act = read ? "view" : W[m] || "edit";
  const is = (re) => re.test(p);

  // open to every logged-in trust user
  if (is(/^\/(auth|health|upload|files|notifications|email-send|owner)(\/|$)/)) return null;
  if (is(/^\/trust\/public$/)) return null;
  if (is(/^\/trust$/)) return read ? null : { module: "settings", action: "edit" };
  if (is(/^\/trust\/theme$/)) return read ? null : { module: "settings", action: "edit" };
  if (is(/^\/programs$/) || is(/^\/programs\/[^/]+$/)) return read ? null : { module: "yojna", action: act };
  if (is(/^\/master-data(\/|$)/)) return read ? null : { module: "master", action: act };
  if (is(/^\/(users|roles)(\/|$)/)) return { module: "users", action: act };
  if (is(/^\/audit$/)) return { module: "settings", action: "view" };

  if (is(/^\/programs\/[^/]+\/(analytics|dashboard)$/)) return { module: "dashboard", action: "view" };
  if (is(/^\/programs\/[^/]+\/reports\//)) return { module: "reports", action: "view" };
  if (is(/^\/members\/[^/]+\/payment-history$/)) return { any: [["reports", "view"], ["members", "view"]] };

  // members
  if (is(/^\/programs\/[^/]+\/members(\/|$)/)) return { module: "members", action: read ? "view" : "add" };
  if (is(/^\/members\/[^/]+\/closing$/)) return { module: "closings", action: act };
  if (is(/^\/members\/[^/]+\/(accept|status|reset-password)$/)) return { module: "members", action: "edit" };
  if (is(/^\/members\/[^/]+\/dues\/check$/)) return { module: "members", action: read ? "view" : "edit" };
  if (is(/^\/members\/[^/]+(\/(dues|closing-dues|join-fees))?$/)) return { module: "members", action: act };

  // closings
  if (is(/^\/programs\/[^/]+\/(closings|closing-groups)$/)) return { module: "closings", action: read ? "view" : "add" };

  // agents (the agent list also feeds member / payment forms)
  if (is(/^\/agents\/[^/]+\/commission-payouts$/)) return { module: "commission", action: read ? "view" : "add" };
  if (is(/^\/agents\/[^/]+\/commissions\/backfill$/)) return { module: "commission", action: "add" };
  if (is(/^\/agents\/[^/]+\/commissions$/)) return { module: "commission", action: "view" };
  if (is(/^\/commission-payouts\/[^/]+\/revert$/)) return { module: "commission", action: "edit" };
  if (is(/^\/commissions\/totals$/)) return { any: [["commission", "view"], ["agents", "view"]] };
  if (is(/^\/agents(\/[^/]+)?$/)) {
    return read ? { any: [["agents", "view"], ["members", "view"], ["payments", "view"], ["commission", "view"]] } : { module: "agents", action: act };
  }
  if (is(/^\/programs\/[^/]+\/agents\/[^/]+\/report$/) || is(/^\/all-payment-status$/)) {
    return { any: [["agents", "view"], ["payments", "view"]] };
  }

  // payments, join fees, receipts
  if (is(/^\/programs\/[^/]+\/cash-handovers(\/[^/]+)?$/)) return { module: "payments", action: read ? "view" : m === "DELETE" ? "delete" : "add" };
  if (is(/^\/transactions\/[^/]+\/reverse$/)) return { module: "payments", action: "delete" };
  if (is(/^\/join-fees\/[^/]+$/)) return { module: "payments", action: "delete" };
  if (is(/^\/programs\/[^/]+\/(payments|join-fees|receipts)$/) || is(/^\/payments\/process$/)) return { module: "payments", action: "add" };
  if (is(/^\/programs\/[^/]+\/transactions(\/report)?$/) || is(/^\/payments\/fetch$/) || is(/^\/receipts(\/|$)/)) return { module: "payments", action: "view" };
  // certificate builder: designing = trust settings; printing a member's certificate = member screens
  if (is(/^\/certificate-templates\/(active|verify-codes)$/)) return { any: [["members", "view"], ["payments", "view"], ["agents", "view"]] };
  if (is(/^\/certificate-templates(\/|$)/)) return { module: "settings", action: read ? "view" : "edit" };
  if (is(/^\/(rasid-generate|all-payment-pdf|certificate-send)$/)) return { any: [["payments", "view"], ["members", "view"], ["agents", "view"]] };

  // anything new that is not mapped yet: staff need edit rights on settings (super admin always passes)
  return { module: "settings", action: read ? "view" : "edit", fallback: true };
}

/** Does `access` satisfy the rule returned by apiPermission? */
export function allowed(access, rule) {
  if (!rule) return true;
  if (rule.any) return rule.any.some(([m, a]) => can(access, m, a));
  return can(access, rule.module, rule.action);
}
