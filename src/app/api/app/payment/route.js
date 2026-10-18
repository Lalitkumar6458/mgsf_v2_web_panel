// Mobile app → "भुगतान करें": UPI QR for the amount, UPI id, bank account, steps.
import { route } from "@/lib/http.js";
import { paymentInfo } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => ({ payment: await paymentInfo(auth, { amount: query.get("amount"), note: query.get("note") }) }));
