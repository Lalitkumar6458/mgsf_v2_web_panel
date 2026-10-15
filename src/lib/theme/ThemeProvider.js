"use client";
// Applies the trust's colour theme to the whole app: CSS variables on <html> (sidebar, top bar,
// page, brand colour) + Ant Design's ConfigProvider (buttons, tabs, inputs, links …).
//
// The last theme is cached in localStorage and put on <html> by the inline script in app/layout.js
// before React loads, so a reload never flashes the old colours. After login the trust's saved
// theme is fetched and wins.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConfigProvider } from "antd";
import { useAuth } from "@/lib/AuthProvider";
import { api } from "@/lib/client/api";
import { buildTheme, normalizeTheme, varsToCss, DEFAULT_THEME } from "./themes";

export const THEME_CACHE_KEY = "mgsf.theme";
export const THEME_CSS_KEY = "mgsf.theme.css"; // read by the inline script in app/layout.js

const ThemeContext = createContext(null);

const readCache = () => {
  try { return normalizeTheme(JSON.parse(localStorage.getItem(THEME_CACHE_KEY) || "null") || DEFAULT_THEME); } catch { return DEFAULT_THEME; }
};
const writeCache = (t) => { try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(t)); } catch { /* private window */ } };

const applyVars = (vars, cache) => {
  const el = document.documentElement;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  if (cache) { try { localStorage.setItem(THEME_CSS_KEY, varsToCss(vars)); } catch { /* ignore */ } }
};

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(null); // what the trust has stored (null until the cache is read)
  const [preview, setPreview] = useState(null); // Settings → Theme while choosing (not saved yet)

  useEffect(() => { setSaved(readCache()); }, []);

  useEffect(() => {
    if (!user?.uid) return;
    let live = true;
    api.get("/trust/theme")
      .then((r) => { if (live && r?.theme) { setSaved(r.theme); writeCache(r.theme); } })
      .catch(() => { /* keep the cached theme */ });
    return () => { live = false; };
  }, [user?.uid]);

  const active = preview || saved || DEFAULT_THEME;
  const built = useMemo(() => buildTheme(active), [active]);
  // nothing is touched before the cache is read (the inline script already painted it);
  // a preview is shown but not cached — a reload goes back to the saved theme
  useEffect(() => { if (saved || preview) applyVars(built.vars, !preview); }, [built, saved, preview]);

  const save = useCallback(async (theme) => {
    const r = await api.patch("/trust/theme", theme);
    setSaved(r.theme);
    writeCache(r.theme);
    setPreview(null);
    return r.theme;
  }, []);

  const value = useMemo(() => ({ saved: saved || DEFAULT_THEME, active: built.resolved, preview, setPreview, save }), [saved, built, preview, save]);

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={built.antd}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
}

export const useAppTheme = () => useContext(ThemeContext);
