// Mobile app → Settings: the trust's details and how to reach the office.
import { route } from "@/lib/http.js";
import { appAbout } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ about: await appAbout() }), { auth: false });
