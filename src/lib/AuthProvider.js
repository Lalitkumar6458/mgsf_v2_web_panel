"use client";
// Login state from our own API (/api/auth/me) instead of Firebase Auth.
// `user.uid` is the trust id — the same value the old screens used (users/{uid}).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { message } from "antd";
import { api } from "./client/api";
import { can as canDo } from "./permissions";
import { hasFeature } from "./features";

const AuthContext = createContext();

function toUser(me) {
  const u = me.user;
  const t = me.trust || {};
  return {
    ...t,
    uid: u.adminId,
    accountId: u.accountId,
    sessionId: u.sessionId,
    role: u.role,
    // { isSuper, permissions, roleName } for trust logins (lib/permissions.js)
    access: u.access || null,
    agentId: u.agentId,
    memberId: u.memberId,
    username: t.displayName || u.displayName || "Admin",
    displayName: u.displayName || t.displayName || "",
    email: t.email || "",
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get("/auth/me");
      setUser(toUser(me));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* already logged out */ }
    setUser(null);
    window.location.href = "/auth/login";
  }, []);

  useEffect(() => {
    refresh();
    // any API call that returns 401 (session revoked / expired) logs the user out
    const onUnauthorized = () => setUser(null);
    window.addEventListener("mgsf:unauthorized", onUnauthorized);
    return () => window.removeEventListener("mgsf:unauthorized", onUnauthorized);
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, messageApi, refresh, logout }}>
      {contextHolder}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** can("members", "add") → true / false for the logged-in trust user (super admin: always true) */
/** Feature lock of the trust (secret /feature-control page): useFeature()("theme") → true / false */
export function useFeature() {
  const { user } = useContext(AuthContext) || {};
  return useCallback((key) => hasFeature(user?.access, key), [user?.access]);
}

export function useCan() {
  const { user } = useContext(AuthContext) || {};
  return useCallback((module, action = "view") => canDo(user?.access, module, action), [user?.access]);
}
