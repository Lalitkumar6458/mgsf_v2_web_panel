// Small reversible encryption for values the office must be able to read back (e.g. an agent's
// password that the admin set). AES-256-GCM, key derived from JWT_SECRET. Never for member data dumps.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = () => createHash("sha256").update(`${process.env.JWT_SECRET || ""}|secret-box-v1`).digest();
export function seal(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), data].map((b) => (typeof b === "string" ? b : b.toString("base64"))).join(".");
}
/** null if missing / tampered / JWT_SECRET changed */
export function open(blob) {
  try {
    const [v, iv, tag, data] = String(blob || "").split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}
