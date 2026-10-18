// POST — the app's "टेस्ट नोटिफिकेशन": push one message to the caller's own phone and say where it
// got stuck: no token from the phone · Expo refused · Google refused (FCM key not on Expo) · delivered.
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { isExpoToken } from "@/lib/push.js";

const EXPO = "https://exp.host/--/api/v2/push";
const headers = () => ({
  "Content-Type": "application/json", Accept: "application/json",
  ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
});

// Expo error codes → what to do (Hindi for the phone, short English for the developer)
const HINT = {
  "no-token": "इस फ़ोन ने सर्वर को नोटिफिकेशन टोकन नहीं दिया — नोटिफिकेशन की अनुमति दें; Android ऐप में google-services.json होना चाहिए।",
  DeviceNotRegistered: "यह फ़ोन अब रजिस्टर नहीं है — ऐप दोबारा खोलें / लॉगिन करें।",
  InvalidCredentials: "Expo पर Android FCM V1 key अपलोड नहीं है (expo.dev → Credentials → FCM V1 service account key)।",
  MismatchSenderId: "ऐप की google-services.json और Expo पर रखी FCM key अलग-अलग Firebase प्रोजेक्ट की हैं।",
  MessageTooBig: "संदेश बहुत लंबा है।",
  MessageRateExceeded: "बहुत जल्दी-जल्दी भेजा — थोड़ी देर बाद।",
};

export const POST = route(async ({ auth }) => {
  // this phone's token (the session the request came from); older builds: the login's token
  const { rows: [a] } = await db.execute(sql`
    SELECT coalesce(s.push_token, ac.push_token) AS push_token
    FROM accounts ac LEFT JOIN sessions s ON s.id = ${auth.sessionId} WHERE ac.id = ${auth.accountId}`);
  const to = a?.push_token;
  if (!isExpoToken(to)) return { ok: false, step: "token", code: "no-token", message: HINT["no-token"] };

  const res = await fetch(`${EXPO}/send`, {
    method: "POST", headers: headers(),
    body: JSON.stringify([{ to, title: "टेस्ट नोटिफिकेशन ✅", body: "यह संदेश दिख रहा है — नोटिफिकेशन ठीक चल रहे हैं।", sound: "default", priority: "high", channelId: "marriage-custom-channel", data: { type: "test" } }]),
  }).catch((e) => ({ ok: false, json: async () => ({ errors: [{ message: e.message }] }) }));
  const j = await res.json().catch(() => ({}));
  const ticket = Array.isArray(j.data) ? j.data[0] : null;
  if (!ticket) return { ok: false, step: "expo", code: "expo-error", message: j.errors?.[0]?.message || "Expo सर्वर से जवाब नहीं मिला।" };
  if (ticket.status !== "ok") {
    const code = ticket.details?.error || "error";
    if (code === "DeviceNotRegistered") {
      await db.execute(sql`UPDATE accounts SET push_token = NULL WHERE push_token = ${to}`);
      await db.execute(sql`UPDATE sessions SET push_token = NULL WHERE push_token = ${to}`);
    }
    return { ok: false, step: "expo", code, message: HINT[code] || ticket.message || code };
  }

  // Expo accepted it; ask whether Google / Apple took it (receipt is ready after a moment)
  let receipt = null;
  for (let i = 0; i < 3 && !receipt; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const rr = await fetch(`${EXPO}/getReceipts`, { method: "POST", headers: headers(), body: JSON.stringify({ ids: [ticket.id] }) }).catch(() => null);
    const rj = rr ? await rr.json().catch(() => ({})) : {};
    receipt = rj?.data?.[ticket.id] || null;
  }
  if (receipt && receipt.status !== "ok") {
    const code = receipt.details?.error || "error";
    return { ok: false, step: "fcm", code, message: HINT[code] || receipt.message || code };
  }
  return { ok: true, step: receipt ? "delivered" : "sent", message: receipt ? "नोटिफिकेशन फ़ोन तक भेज दी गई — ऊपर देखें।" : "भेज दी गई — कुछ सेकंड में आनी चाहिए।" };
});
