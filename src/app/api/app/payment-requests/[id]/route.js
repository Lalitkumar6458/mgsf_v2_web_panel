// App: DELETE → take back my request (only while the office has not decided).
import { route } from "@/lib/http.js";
import { cancelRequest } from "@/services/paymentRequests.js";

export const dynamic = "force-dynamic";
export const DELETE = route(async ({ auth, params }) => cancelRequest(auth, params.id));
