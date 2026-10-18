"use client";
// Login state from our own API (/api/auth/me) instead of Firebase Auth.
// `user.uid` is the trust id — the same value the old screens used (users/{uid}).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { message } from "antd";
import { api } from "./client/api";
import { can as canDo } from "./permissions";
import { hasFeature } from "./features";
import { PanelBlocked } from "@/components/base/PanelPlan";

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

// the developer's /feature-control page never shows a trust's "panel band" screen
const isControlPage = () => typeof window !== "undefined" && window.location.pathname.startsWith("/feature-control");

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // panel plan over / switched off → full "panel band" screen: { reason, message, expiresAt, support, trustName }
  const [blocked, setBlocked] = useState(null);
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get("/auth/me");
      setUser(toUser(me));
      setBlocked(null);
    } catch (e) {
      if (e?.details?.blocked) setBlocked(e.details.blocked);
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
    const onUnauthorized = (e) => {
      if (e?.detail?.blocked) setBlocked(e.detail.blocked);
      setUser(null);
    };
    window.addEventListener("mgsf:unauthorized", onUnauthorized);
    return () => window.removeEventListener("mgsf:unauthorized", onUnauthorized);
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, messageApi, refresh, logout, blocked, setBlocked }}>
      {contextHolder}
      {blocked && !isControlPage() ? (
        <PanelBlocked info={blocked}
          onRetry={async () => {
            try { await api.get("/auth/me"); setBlocked(null); window.location.href = "/"; }
            catch (e) { messageApi.info(e?.details?.blocked ? "Abhi bhi band hai — renew ke baad 1 minute rukein." : "Dobara login karein"); if (!e?.details?.blocked) { setBlocked(null); window.location.href = "/auth/login"; } }
          }}
          onLogin={async () => { try { await api.post("/auth/logout"); } catch { /* ignore */ } setBlocked(null); window.location.href = "/auth/login"; }} />
      ) : children}
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
