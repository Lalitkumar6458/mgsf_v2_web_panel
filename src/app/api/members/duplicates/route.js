// GET ?aadhaarNo=&phone=&name=&fatherName=&excludeId= → members of this trust that look the same (all yojna)
import { route } from "@/lib/http.js";
import { findDuplicates } from "@/services/duplicates.js";

export const GET = route(async ({ auth, query }) => {
  if (!auth.adminId) return { matches: [] };
  const q = Object.fromEntries(query.entries());
  return { matches: await findDuplicates(auth.adminId, q) };
});
