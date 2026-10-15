import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { nextApplicationNumber } from "@/services/members.js";

export const GET = route(async ({ auth, params }) => {
  await getProgramFor(auth, params.programId);
  return { applicationNumber: await nextApplicationNumber(params.programId) };
});
