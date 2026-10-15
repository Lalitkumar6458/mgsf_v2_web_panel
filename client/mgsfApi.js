// Tiny API client for the web panel AND the Expo app (replaces firebase SDK calls).
//
// Web panel (same domain, cookie login):   const api = createApi();
// Expo app:  const api = createApi({ baseUrl: "https://api.your-domain.in", getToken: () => SecureStore.getItemAsync("token") });
//
//   const { token, user } = await api.login("R100001", "amit1998");   // app: save token in SecureStore
//   const { members } = await api.get(`/programs/${programId}/members`, { q: "ram", page: 1 });
//   await api.post(`/members/${id}/closing`, { closingDate: "15-02-2026", closingGroupId });
//   await api.post(`/programs/${programId}/payments`, { type: "single", payerId, closingIds: [closingId] });
export function createApi({ baseUrl = "", getToken } = {}) {
  async function request(method, path, body, query) {
    const url = new URL(`${baseUrl}/api${path}`, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    const headers = {};
    const token = getToken ? await getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (body && !(typeof FormData !== "undefined" && body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(baseUrl ? url.toString() : url.pathname + url.search, { method, headers, body: payload, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.details = data.details;
      throw err;
    }
    return data;
  }
  return {
    get: (path, query) => request("GET", path, undefined, query),
    post: (path, body) => request("POST", path, body || {}),
    patch: (path, body) => request("PATCH", path, body || {}),
    del: (path, query) => request("DELETE", path, undefined, query),
    login: (loginId, password, otp) => request("POST", "/auth/login", { loginId, password, otp }),
    logout: () => request("POST", "/auth/logout", {}),
    upload: (file, folder = "members") => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      return request("POST", "/upload", fd);
    },
  };
}
