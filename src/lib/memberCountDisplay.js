// How a yojna's member count is SHOWN (Yojna → Add / Edit → "Member count kaise dikhe").
// Stored on programs.extra.countDisplay. Pure module (browser + server + tests).
//
//   actual   asli ginti
//   percent  asli ginti ka X%  (1000 members, 70% → 700; 1100 → 770 — badhta rehta hai)
//   fixed    ek tay ginti se shuru, phir jitne naye member jude utne plus
//            (600 set kiya jab asli 1000 the → 600; 50 naye jude → 650)
//
// "Asli" = members on books: active + inactive + blocked + closed (pending requests not counted).

export const COUNT_MODES = [
  { value: "actual", label: "Asli ginti" },
  { value: "percent", label: "Percent (%)" },
  { value: "fixed", label: "Fixed ginti se shuru" },
];

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** Clean what the form sent. `prev` = what is stored now; `actualNow` = members on books right now. */
export function normalizeCountDisplay(raw, prev = {}, actualNow = 0) {
  const r = raw && typeof raw === "object" ? raw : {};
  const mode = COUNT_MODES.some((m) => m.value === r.mode) ? r.mode : "actual";
  if (mode === "percent") return { mode, percent: Math.min(Math.max(int(r.percent) || 100, 1), 1000) };
  if (mode === "fixed") {
    const fixed = Math.max(int(r.fixed), 0);
    // the starting point moves only when the fixed number (or the mode) is changed
    const same = prev?.mode === "fixed" && int(prev.fixed) === fixed && prev.baseActual !== undefined;
    return { mode, fixed, baseActual: same ? int(prev.baseActual) : int(actualNow), setAt: same ? prev.setAt : new Date().toISOString() };
  }
  return { mode: "actual" };
}

/** The number to show for `actual` members. */
export function displayCount(actual, cfg) {
  const a = Math.max(int(actual), 0);
  if (!cfg || typeof cfg !== "object") return a;
  if (cfg.mode === "percent") return Math.round((a * (int(cfg.percent) || 100)) / 100);
  if (cfg.mode === "fixed") return Math.max(int(cfg.fixed) + Math.max(a - int(cfg.baseActual), 0), 0);
  return a;
}

/** short text for the admin: "70% of real" / "600 se shuru" */
export function describeCountDisplay(cfg) {
  if (cfg?.mode === "percent") return `asli ginti ka ${int(cfg.percent)}%`;
  if (cfg?.mode === "fixed") return `${int(cfg.fixed)} se shuru + naye members`;
  return "asli ginti";
}
