// File uploads. Two modes:
//  STORAGE=r2 (or s3): Cloudflare R2 / any S3-compatible bucket → public URL (recommended, 10 GB free on R2)
//  STORAGE=local     : files saved under UPLOAD_DIR on the VPS and served by /api/files/...
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { badRequest } from "./errors.js";

const MAX_BYTES = Number(process.env.UPLOAD_MAX_MB || 8) * 1024 * 1024;
const TYPES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([m, e]) => [e, m]));
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || "./uploads");

let s3;
async function s3Client() {
  if (s3) return s3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3 = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT, // R2: https://<accountid>.r2.cloudflarestorage.com
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
  return s3;
}

/** Save a web File; returns its public URL. (maxBytes: the data migration copies bigger old files) */
export async function saveUpload(file, folder, { maxBytes = MAX_BYTES } = {}) {
  const ext = TYPES[file.type];
  if (!ext) throw badRequest("Only JPG, PNG, WEBP, GIF or PDF allowed");
  if (file.size > maxBytes) throw badRequest(`File too large (max ${maxBytes / 1048576} MB)`);
  const key = `${folder}/${randomUUID()}.${ext}`.replace(/\/+/g, "/");
  const data = Buffer.from(await file.arrayBuffer());

  const mode = (process.env.STORAGE || "local").toLowerCase();
  if (mode === "r2" || mode === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3Client()).send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET, Key: key, Body: data, ContentType: file.type, CacheControl: "public, max-age=31536000, immutable",
    }));
    return `${process.env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  const full = path.join(uploadDir(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/api/files/${key}`;
}

export async function readLocalUpload(key) {
  const root = uploadDir();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) return null; // no ../ tricks
  try {
    const data = await readFile(full);
    return { data, type: MIME_BY_EXT[path.extname(full).slice(1)] || "application/octet-stream" };
  } catch {
    return null;
  }
}
