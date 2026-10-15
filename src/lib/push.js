// Notifications: saved in Postgres (in-app list) + sent as Expo push (free; replaces FCM HTTP v1 + service account)
import { sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const EXPO_URL = "https://exp.host/--/api/v2/push/send";

export async function notify(adminId, accountIds, { title, body = "", data = {} }) {
  if (!accountIds.length) return { saved: 0, pushed: 0 };
  await db.insert(schema.notifications).values(accountIds.map((accountId) => ({ adminId, accountId, title, body, data })));

  const { rows } = await db.execute(sql`
    SELECT push_token FROM accounts
    WHERE id IN (${sql.join(accountIds.map((x) => sql`${x}`), sql`, `)}) AND push_token LIKE 'ExponentPushToken%'`);
  const messages = rows.map((r) => ({ to: r.push_token, title, body, data, sound: "default", channelId: "marriage-custom-channel" }));
  let pushed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const res = await fetch(EXPO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (res.ok) pushed += messages.slice(i, i + 100).length;
    } catch (e) {
      console.error("[push]", e.message);
    }
  }
  return { saved: accountIds.length, pushed };
}

/** Notify an agent's account (e.g. "new member added"). */
export async function notifyAgent(adminId, agentId, msg) {
  const { rows } = await db.execute(sql`SELECT id FROM accounts WHERE agent_id = ${agentId} AND active`);
  return notify(adminId, rows.map((r) => r.id), msg);
}
