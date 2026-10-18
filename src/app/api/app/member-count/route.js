// Agent / member app: yojna ki kul sadasya sankhya — only when Settings → Mobile App → "Member count"
// is on for this login type; the number follows the trust's chosen display (yojna / asli / % / fixed).
import { route } from "@/lib/http.js";
import { forbidden } from "@/lib/errors.js";
import { appMemberCount } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => {
  if (auth.role !== "agent" && auth.role !== "member") throw forbidden();
  return appMemberCount(auth);
});
