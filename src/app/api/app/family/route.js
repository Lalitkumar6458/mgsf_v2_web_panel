// Member app: everyone on my mobile number (all yojna), each with the whole account.
import { route } from "@/lib/http.js";
import { forbidden } from "@/lib/errors.js";
import { family } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => {
  if (auth.role !== "member") throw forbidden();
  return family(auth);
});
