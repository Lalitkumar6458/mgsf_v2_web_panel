// Mobile app, before anything else: maintenance on? update needed? may members / agents pay in the app?
import { route } from "@/lib/http.js";
import { appStatus } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async () => appStatus(), { auth: false });
