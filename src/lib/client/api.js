"use client";
// Browser → our own API (same domain, login cookie is sent automatically).
// Replaces the firebase SDK in the admin panel.

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, query) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, v);
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const opts = { method, credentials: "include", headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("mgsf:unauthorized", { detail: data.details || null }));
    }
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.details);
  }
  return data;
}

export const api = {
  get: (path, query) => request("GET", path, undefined, query),
  post: (path, body) => request("POST", path, body ?? {}),
  patch: (path, body) => request("PATCH", path, body ?? {}),
  put: (path, body) => request("PUT", path, body ?? {}),
  del: (path, query) => request("DELETE", path, undefined, query),
  /** Upload a File/Blob → { url } */
  upload: (file, folder = "members") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    return request("POST", "/upload", fd);
  },
};
