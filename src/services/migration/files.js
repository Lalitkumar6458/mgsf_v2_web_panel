// Copy photos / documents from Firebase Storage into our storage (R2 or the VPS disk) and point the rows
// at the new URLs. Runs AFTER the data is committed, so a slow or failed file never blocks the data;
// a file that cannot be copied keeps its old Firebase URL (still works while that project lives) and
// is listed in the report so it can be retried.
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { saveUpload } from "../../lib/storage.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const MAX = 25 * 1024 * 1024;
const TABLE_COLUMNS = {
  members: new Set(["photo_url", "extra_image_url", "document_front_url", "document_back_url", "guardian_document_url", "guardian_document_back_url", "invitation_card_url"]),
  agents: new Set(["photo_url", "signature_url", "document_urls"]),
  admins: new Set(["trust_info"]),
};

/** "https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?…" → { bucket, path } */
export function storagePath(url) {
  try {
    const u = new URL(url);
    let m = u.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (m) return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
    m = u.hostname === "storage.googleapis.com" && u.pathname.match(/^\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch { /* */ }
  return null;
}

const sniff = (buf) => (buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
  : buf[0] === 0x25 && buf[1] === 0x50 ? "application/pdf" : buf.slice(0, 4).toString() === "RIFF" ? "image/webp" : buf.slice(0, 3).toString() === "GIF" ? "image/gif" : "");

async function download(url, storage) {
  // 1. the download URL itself (has its own token)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, type: (res.headers.get("content-type") || "").split(";")[0].trim() || sniff(buf) };
    }
  } catch { /* fall through */ }
  // 2. the bucket, with the service account
  const sp = storagePath(url);
  if (!sp || !storage) throw new Error("download nahi hua");
  const file = storage.bucket(sp.bucket).file(sp.path);
  const [buf] = await file.download();
  const [meta] = await file.getMetadata().catch(() => [{}]);
  return { buf, type: meta.contentType || sniff(buf) };
}

/**
 * files: [{ table, id, column, url, key?, index? }]. One URL used in many places is copied once.
 * progress(done, total, note). Returns { copied, failed: [{url, error, where}] , skipped }.
 */
export async function copyFiles(adminId, files, { storage, progress = () => {}, isCancelled = () => false, concurrency = 6 } = {}) {
  const byUrl = new Map();
  for (const f of files) {
    if (!TABLE_COLUMNS[f.table]?.has(f.column)) continue;
    if (!byUrl.has(f.url)) byUrl.set(f.url, []);
    byUrl.get(f.url).push(f);
  }
  const urls = [...byUrl.keys()];
  const failed = [];
  let copied = 0, done = 0, skipped = 0;
  const put = async (f, newUrl) => {
    if (f.table === "admins") {
      await db.execute(sql`UPDATE admins SET trust_info = jsonb_set(trust_info, ${`{${f.key}}`}::text[], to_jsonb(${newUrl}::text)) WHERE id = ${f.id}`);
    } else if (f.column === "document_urls") {
      await db.execute(sql`
        UPDATE agents SET document_urls = (
          SELECT jsonb_agg(CASE WHEN ord - 1 = ${f.index} THEN (CASE WHEN jsonb_typeof(e) = 'object' THEN e || jsonb_build_object('url', ${newUrl}::text) ELSE to_jsonb(${newUrl}::text) END) ELSE e END ORDER BY ord)
          FROM jsonb_array_elements(document_urls) WITH ORDINALITY AS a(e, ord))
        WHERE id = ${f.id}`);
    } else {
      await db.execute(sql`UPDATE ${sql.raw(f.table)} SET ${sql.raw(f.column)} = ${newUrl} WHERE id = ${f.id} AND ${sql.raw(f.column)} = ${f.url}`);
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (isCancelled()) return;
      const url = urls[next++];
      const where = byUrl.get(url);
      try {
        const { buf, type } = await download(url, storage);
        const mime = ALLOWED.has(type) ? type : sniff(buf);
        if (!ALLOWED.has(mime)) { skipped++; failed.push({ url, error: `type ${type || "?"} copy nahi hota — purana link rakha`, where: where[0] }); }
        else {
          const name = (storagePath(url)?.path || "file").split("/").pop().replace(/[^\w.-]/g, "_").slice(-60) || "file";
          const file = new File([buf], name, { type: mime });
          const newUrl = await saveUpload(file, `${adminId}/migrated/${where[0].table}`, { maxBytes: MAX });
          for (const f of where) await put(f, newUrl);
          copied++;
        }
      } catch (e) {
        failed.push({ url, error: String(e?.message || e).slice(0, 200), where: where[0] });
      }
      done++;
      if (done % 5 === 0 || done === urls.length) progress(done, urls.length, `${copied} copy · ${failed.length} fail`);
    }
  };
  progress(0, urls.length, `${urls.length} files`);
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length || 1) }, worker));
  return { total: urls.length, copied, failed, skipped };
}
