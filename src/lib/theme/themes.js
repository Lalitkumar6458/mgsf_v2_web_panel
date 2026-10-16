// App colour themes. Pure module (browser + server + tests).
//
// A theme is saved per trust as { preset, primary?, sidebar? } (admins.extra.theme). buildTheme()
// turns it into CSS variables (sidebar, top bar, page, brand colour) + Ant Design tokens, so every
// screen, button, tab and link follows the one colour the trust picked.

export const SIDEBAR_STYLES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "brand", label: "Brand colour" },
];

export const PRESETS = [
  { key: "royal", name: "Royal Blue", hi: "शाही नीला", primary: "#2563eb", sidebar: "dark", dark: "#0f172a" },
  { key: "indigo", name: "Indigo Night", hi: "इंडिगो", primary: "#4f46e5", sidebar: "dark", dark: "#1e1b4b" },
  { key: "emerald", name: "Emerald", hi: "पन्ना हरा", primary: "#059669", sidebar: "dark", dark: "#062925" },
  { key: "saffron", name: "Kesariya", hi: "केसरिया", primary: "#ea580c", sidebar: "dark", dark: "#1c1410" },
  { key: "maroon", name: "Maroon", hi: "मैरून", primary: "#9f1239", sidebar: "brand" },
  { key: "purple", name: "Royal Purple", hi: "जामुनी", primary: "#7c3aed", sidebar: "dark", dark: "#1a1033" },
  { key: "gold", name: "Black & Gold", hi: "काला-सुनहरा", primary: "#a16207", sidebar: "dark", dark: "#0c0a09" },
  { key: "teal", name: "Ocean Teal", hi: "समुद्री", primary: "#0d9488", sidebar: "brand" },
  { key: "classic", name: "Classic Light", hi: "सादा उजला", primary: "#2563eb", sidebar: "light" },
  { key: "rose", name: "Rose Light", hi: "गुलाबी", primary: "#e11d48", sidebar: "light" },
  { key: "forest", name: "Forest Light", hi: "हरियाली", primary: "#15803d", sidebar: "light" },
  { key: "graphite", name: "Graphite", hi: "स्लेटी", primary: "#475569", sidebar: "dark", dark: "#111827" },
];

export const DEFAULT_THEME = { preset: "royal" };

/* ── colour helpers ─────────────────────────────────────────────────────── */

const HEX = /^#([0-9a-f]{6})$/i;
export const isHex = (v) => HEX.test(String(v || ""));

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r, g, b) => `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;

/** mix(a, b, t): t = 0 → a, t = 1 → b */
export const mix = (a, b, t) => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
};
const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; };

/** WCAG relative luminance → is white text readable on this colour? */
const luminance = (hex) => {
  const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ── theme → variables ─────────────────────────────────────────────────── */

/** Clean what a client sent / what was stored. */
export function normalizeTheme(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const preset = PRESETS.find((p) => p.key === t.preset) ? t.preset : t.preset === "custom" ? "custom" : DEFAULT_THEME.preset;
  const out = { preset };
  if (isHex(t.primary)) out.primary = t.primary.toLowerCase();
  if (SIDEBAR_STYLES.some((s) => s.value === t.sidebar)) out.sidebar = t.sidebar;
  if (preset === "custom" && !out.primary) out.primary = "#2563eb";
  return out;
}

/** { preset, primary, sidebar } → { vars: {"--brand": …}, antd: {token}, resolved } */
export function buildTheme(raw) {
  const t = normalizeTheme(raw);
  const p = PRESETS.find((x) => x.key === t.preset) || {};
  let primary = t.primary || p.primary || "#2563eb";
  // a very light colour cannot carry white text on buttons → darken until readable
  for (let i = 0; i < 10 && contrast(primary, "#ffffff") < 3; i++) primary = mix(primary, "#000000", 0.12);
  const sidebar = t.sidebar || p.sidebar || "dark";
  const darkBase = (t.preset === p.key && !t.primary && p.dark) || mix(primary, "#0b0f19", 0.86);

  const brandDark = mix(primary, "#000000", 0.22);
  const brandLight = mix(primary, "#ffffff", 0.45);
  const vars = {
    "--brand": primary,
    "--brand-hover": brandDark,
    "--brand-light": brandLight,
    "--brand-soft": mix(primary, "#ffffff", 0.9),
    "--brand-softer": mix(primary, "#ffffff", 0.95),
    "--brand-ring": alpha(primary, 0.18),
    "--brand-shadow": alpha(primary, 0.35),
    "--page-bg": mix(primary, "#f1f5f9", 0.965),
    "--tb-bg": "#ffffff",
    // a full scale of the brand colour — globals.css maps Tailwind's blue-* / indigo-* onto it,
    // so the many `text-blue-600`, `bg-blue-50` … across the screens follow the theme too
    "--brand-50": mix(primary, "#ffffff", 0.95),
    "--brand-100": mix(primary, "#ffffff", 0.9),
    "--brand-200": mix(primary, "#ffffff", 0.78),
    "--brand-300": mix(primary, "#ffffff", 0.6),
    "--brand-400": mix(primary, "#ffffff", 0.32),
    "--brand-500": mix(primary, "#ffffff", 0.1),
    "--brand-600": primary,
    "--brand-700": mix(primary, "#000000", 0.18),
    "--brand-800": mix(primary, "#000000", 0.34),
    "--brand-900": mix(primary, "#000000", 0.5),
    "--tb-border": mix(primary, "#e5e7eb", 0.92),
  };

  if (sidebar === "light") {
    Object.assign(vars, {
      "--sb-bg1": "#ffffff", "--sb-bg2": "#ffffff", "--sb-border": "#e5e7eb",
      "--sb-text": "#1f2937", "--sb-muted": "#64748b", "--sb-dim": "#94a3b8",
      "--sb-hover": mix(primary, "#ffffff", 0.94), "--sb-icon-bg": "#f1f5f9", "--sb-icon": "#64748b",
      "--sb-active-bg": mix(primary, "#ffffff", 0.9), "--sb-active-text": mix(primary, "#000000", 0.3),
      "--sb-active-icon-bg": primary, "--sb-active-icon": "#ffffff", "--sb-accent": primary,
      "--sb-logo-text": "#0f172a", "--sb-card": "#f8fafc",
    });
  } else if (sidebar === "brand") {
    Object.assign(vars, {
      "--sb-bg1": mix(primary, "#000000", 0.18), "--sb-bg2": mix(primary, "#000000", 0.42), "--sb-border": "rgba(255,255,255,0.12)",
      "--sb-text": "#ffffff", "--sb-muted": "rgba(255,255,255,0.74)", "--sb-dim": "rgba(255,255,255,0.55)",
      "--sb-hover": "rgba(255,255,255,0.09)", "--sb-icon-bg": "rgba(255,255,255,0.12)", "--sb-icon": "rgba(255,255,255,0.86)",
      "--sb-active-bg": "rgba(255,255,255,0.17)", "--sb-active-text": "#ffffff",
      "--sb-active-icon-bg": "#ffffff", "--sb-active-icon": mix(primary, "#000000", 0.2), "--sb-accent": "#ffffff",
      "--sb-logo-text": "#ffffff", "--sb-card": "rgba(255,255,255,0.08)",
    });
  } else {
    Object.assign(vars, {
      "--sb-bg1": darkBase, "--sb-bg2": mix(darkBase, "#000000", 0.35), "--sb-border": "rgba(255,255,255,0.07)",
      "--sb-text": "#e2e8f0", "--sb-muted": "#94a3b8", "--sb-dim": "#64748b",
      "--sb-hover": "rgba(255,255,255,0.05)", "--sb-icon-bg": "rgba(255,255,255,0.06)", "--sb-icon": "#94a3b8",
      "--sb-active-bg": alpha(primary, 0.2), "--sb-active-text": "#ffffff",
      "--sb-active-icon-bg": primary, "--sb-active-icon": "#ffffff", "--sb-accent": brandLight,
      "--sb-logo-text": "#ffffff", "--sb-card": "rgba(255,255,255,0.05)",
    });
  }

  const antd = {
    token: {
      colorPrimary: primary,
      colorInfo: primary,
      colorLink: primary,
      colorSuccess: "#059669",
      colorWarning: "#d97706",
      colorError: "#dc2626",
      borderRadius: 8,
    },
  };
  return { vars, antd, resolved: { ...t, primary, sidebar } };
}

/** CSS text for the variables (used by the no-flash script and the provider). */
export const varsToCss = (vars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");

/**
 * Colours for the mobile app (agent / member app) from the same trust theme as the panel:
 * header = the panel's sidebar colour, brand scale for buttons, chips and soft backgrounds.
 */
export function appPalette(raw) {
  const { vars, resolved } = buildTheme(raw);
  const primary = resolved.primary;
  const lightHeader = resolved.sidebar === "light";
  return {
    preset: resolved.preset,
    primary,
    primaryDark: vars["--brand-700"],
    primaryLight: vars["--brand-400"],
    soft: vars["--brand-50"],
    softer: vars["--brand-100"],
    pageBg: vars["--page-bg"],
    header: lightHeader ? primary : vars["--sb-bg1"],
    headerEnd: lightHeader ? vars["--brand-700"] : vars["--sb-bg2"],
    headerText: "#ffffff",
    onPrimary: "#ffffff",
  };
}
