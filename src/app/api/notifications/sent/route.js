// GET — the panel's last sends (grouped) with how many logins got / read them
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { sentList } from "@/services/notifySend.js";

export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return { sent: await sentList(auth.adminId, query.get("limit")) };
});
