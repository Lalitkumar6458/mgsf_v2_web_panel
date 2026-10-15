// Colour themes: presets, custom colours, readable buttons, saved shape, permissions.  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, buildTheme, normalizeTheme, contrast, DEFAULT_THEME } from "../src/lib/theme/themes.js";
import { apiPermission } from "../src/lib/permissions.js";

const VARS = ["--brand", "--brand-600", "--page-bg", "--sb-bg1", "--sb-bg2", "--sb-text", "--sb-active-bg", "--sb-accent", "--tb-border"];

test("every preset builds every variable and readable text", () => {
  for (const p of PRESETS) {
    const { vars, antd, resolved } = buildTheme({ preset: p.key });
    for (const k of VARS) assert.ok(vars[k], `${p.key} ${k}`);
    assert.equal(antd.token.colorPrimary, vars["--brand"]);
    assert.ok(contrast(vars["--brand"], "#ffffff") >= 3, `${p.key} white text on brand`);
    if (resolved.sidebar === "light") assert.ok(contrast(vars["--sb-text"], vars["--sb-bg1"]) >= 7, `${p.key} sidebar text`);
    else if (resolved.sidebar === "dark") assert.ok(contrast(vars["--sb-text"], vars["--sb-bg1"]) >= 7, `${p.key} sidebar text`);
  }
});

test("custom colour: too-light colours are darkened, sidebar style respected", () => {
  const t = buildTheme({ preset: "custom", primary: "#ffe066", sidebar: "brand" });
  assert.ok(contrast(t.vars["--brand"], "#ffffff") >= 3);
  assert.equal(t.resolved.sidebar, "brand");
  assert.equal(buildTheme({ preset: "royal", sidebar: "light" }).vars["--sb-bg1"], "#ffffff");
});

test("normalize: junk in, safe theme out", () => {
  assert.deepEqual(normalizeTheme(null), DEFAULT_THEME);
  assert.deepEqual(normalizeTheme({ preset: "nope", primary: "red", sidebar: "x", evil: 1 }), DEFAULT_THEME);
  assert.deepEqual(normalizeTheme({ preset: "custom" }), { preset: "custom", primary: "#2563eb" });
  assert.deepEqual(normalizeTheme({ preset: "emerald", primary: "#ABCDEF", sidebar: "light" }), { preset: "emerald", primary: "#abcdef", sidebar: "light" });
});

test("permissions: everyone reads the theme, settings edit saves it", () => {
  assert.equal(apiPermission("GET", "/api/trust/theme"), null);
  assert.deepEqual(apiPermission("PATCH", "/api/trust/theme"), { module: "settings", action: "edit" });
});
