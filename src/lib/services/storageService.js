"use client";
// File uploads now go to our own server (/api/upload) instead of Firebase Storage.
import { api } from "../client/api";

const folderOf = (path) => {
  const p = String(path || "");
  if (p.includes("agents")) return "agents";
  if (p.includes("invitation") || p.includes("closing")) return "closings";
  if (p.includes("members")) return "members";
  return "misc";
};

/** Upload file and return { url, path } (same shape as before) */
export async function uploadFile(folderName, file) {
  const { url } = await api.upload(file, folderOf(folderName));
  return { url, path: url };
}

/** Upload with progress callback (progress jumps 0 → 100) */
export async function uploadFileWithProgress(folderName, file, progressCallback) {
  progressCallback?.("0");
  const r = await uploadFile(folderName, file);
  progressCallback?.("100");
  return r;
}

/** Old files stay where they are; deleting is a no-op for now. */
export async function deleteFile() {
  return true;
}

export async function uploadMultiple(folderName, files) {
  return Promise.all(Array.from(files || []).map((f) => uploadFile(folderName, f)));
}
