// Settings → App logins. GET ?role=member|agent&q=&status=in|out&page= → { summary, logins, total }
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { loginList, loginSummary } from "@/services/appLogins.js";

export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  const [summary, list] = await Promise.all([
    loginSummary(auth.adminId),
    loginList(auth.adminId, { role: query.get("role") || "member", q: query.get("q") || "", status: query.get("status") || "", page: query.get("page") }),
  ]);
  return { summary, ...list };
});
