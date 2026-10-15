// Certificate builder: template data model, saved designs (default / per-yojna), permissions.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import {
  buildContext, resolveField, normalizeTemplate, closingWordFor, DEFAULT_TEMPLATE, SAMPLE_MEMBER,
} from "../src/lib/certificateTemplate.js";
import {
  listTemplates, saveTemplate, setDefaultTemplate, deleteTemplate, getActiveTemplate,
} from "../src/services/certificateTemplates.js";
import { apiPermission } from "../src/lib/permissions.js";
import { GALLERY, BLOCKS, templateFromGallery, blockElements } from "../src/lib/certificateGallery.js";
import { adminOnly, OWNER_NO_TRUST } from "../src/lib/access.js";

let admin, other, p1, p2;

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "c@test.in", displayName: "T" }).returning();
  [other] = await db.insert(schema.admins).values({ email: "o@test.in", displayName: "O" }).returning();
  [p1] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Mayra" }).returning();
  [p2] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
});
after(() => pool.end());

test("context: labels, age, closing word, payer fallbacks, location group", () => {
  const ctx = buildContext(
    { ...SAMPLE_MEMBER, state: "rajasthan", district: "jodhpur", locactionGroupId: "g1", dateJoin: "13-05-2026", bobDate: "17-07-2000" },
    { name: "Vivah", isVivah: true, locationGroups: [{ id: "g1", name: "Jodhpur" }] },
    Date.UTC(2026, 9, 15),
  );
  assert.equal(ctx.state, "राजस्थान");
  assert.equal(ctx.district, "जोधपुर");
  assert.equal(ctx.districtState, "जोधपुर - राजस्थान");
  assert.equal(ctx.age, "25");
  assert.equal(ctx.closingWord, "विवाह");
  assert.equal(ctx.payer.state, "राजस्थान");
  assert.equal(ctx.locationGroup, "Jodhpur");
  assert.equal(ctx.memberNo, "473");
  assert.equal(closingWordFor({ category: "isSuraksha" }), "देहांत");
  assert.equal(resolveField(ctx, { fieldKey: "closingWord", prefix: "रू. प्रत्येक ", suffix: " पर" }), "रू. प्रत्येक विवाह पर");
  assert.equal(resolveField(ctx, { fieldKey: "nothing", fallback: "—" }), "");
  assert.equal(resolveField(ctx, { fieldKey: "nothing", fallback: "N/A" }), "");
  assert.equal(resolveField(ctx, { fieldKey: "nothing", fallback: "खाली" }), "खाली");
  assert.equal(normalizeTemplate(null).elements.length, DEFAULT_TEMPLATE.elements.length);
});

test("save: one default per trust, one template per yojna, frame must be a URL", async () => {
  const body = { ...DEFAULT_TEMPLATE, name: "A", isDefault: true, frameImg: "/api/files/x/certificates/a.jpg" };
  const a = await saveTemplate(admin.id, body, null, "acc1");
  assert.equal(a.isDefault, true);
  assert.equal(a.elements.length, DEFAULT_TEMPLATE.elements.length);

  const b = await saveTemplate(admin.id, { ...body, name: "B" });
  const list = await listTemplates(admin.id);
  assert.deepEqual(list.filter((t) => t.isDefault).map((t) => t.id), [b.id]);

  const c = await saveTemplate(admin.id, { ...body, name: "C", isDefault: false, programId: p1.id });
  const d = await saveTemplate(admin.id, { ...body, name: "D", isDefault: false, programId: p1.id });
  const after = await listTemplates(admin.id);
  assert.equal(after.find((t) => t.id === c.id).programId, null);
  assert.equal(after.find((t) => t.id === d.id).programId, p1.id);

  await assert.rejects(saveTemplate(admin.id, { ...body, frameImg: "data:image/png;base64,AAAA" }), /upload/);
  await assert.rejects(saveTemplate(admin.id, { ...body, programId: "nope" }), /Yojna/);
  await assert.rejects(saveTemplate(other.id, body, a.id), /nahi mila/); // other trust cannot touch it

  // updating keeps the id; elements round-trip exactly
  const moved = { ...d, elements: d.elements.map((e, i) => (i === 0 ? { ...e, x: 999 } : e)) };
  const saved = await saveTemplate(admin.id, moved, d.id);
  assert.equal(saved.id, d.id);
  assert.equal(saved.elements[0].x, 999);
});

test("active template: yojna-bound first, else default, else none", async () => {
  const list = await listTemplates(admin.id);
  const bound = list.find((t) => t.programId === p1.id);
  const def = list.find((t) => t.isDefault);
  assert.equal((await getActiveTemplate(admin.id, p1.id)).id, bound.id);
  assert.equal((await getActiveTemplate(admin.id, p2.id)).id, def.id);
  assert.equal((await getActiveTemplate(admin.id, null)).id, def.id);
  assert.equal(await getActiveTemplate(other.id, p1.id), null);

  const a = list.find((t) => t.name === "A");
  assert.equal((await setDefaultTemplate(admin.id, a.id)).isDefault, true);
  assert.equal((await listTemplates(admin.id)).filter((t) => t.isDefault).length, 1);

  await deleteTemplate(admin.id, a.id);
  assert.equal(await getActiveTemplate(admin.id, p2.id), null); // no default left → built-in certificate
  await assert.rejects(deleteTemplate(admin.id, a.id), /nahi mila/);

  // deleting a yojna frees its template instead of failing
  await db.execute(sql`DELETE FROM programs WHERE id = ${p1.id}`);
  assert.equal((await listTemplates(admin.id)).some((t) => t.programId === p1.id), false);
});

test("permissions: design = settings, printing = member screens; owner gets a clear message", () => {
  assert.deepEqual(apiPermission("GET", "/api/certificate-templates"), { module: "settings", action: "view" });
  assert.deepEqual(apiPermission("PATCH", "/api/certificate-templates/t1"), { module: "settings", action: "edit" });
  assert.deepEqual(apiPermission("POST", "/api/certificate-templates/t1/default"), { module: "settings", action: "edit" });
  assert.deepEqual(apiPermission("GET", "/api/certificate-templates/active"), { any: [["members", "view"], ["payments", "view"], ["agents", "view"]] });
  assert.throws(() => adminOnly({ role: "owner", adminId: null }), (e) => e.message === OWNER_NO_TRUST);
  assert.doesNotThrow(() => adminOnly({ role: "admin", adminId: "x" }));
});

test("gallery designs: every one saves as a template; page colour, pictures and trust fields kept", async () => {
  const keys = new Set(["text", "field", "box", "image", "picture"]);
  for (const g of GALLERY) {
    const t = templateFromGallery(g.key);
    assert.ok(t.elements.length > (g.key === "blank" ? 0 : 10), g.key);
    assert.ok(t.elements.every((e) => keys.has(e.type) && e.id), g.key);
    assert.equal(new Set(t.elements.map((e) => e.id)).size, t.elements.length, `${g.key} unique ids`);
  }
  const t = templateFromGallery("classic-maroon");
  t.elements.push({ id: "sig1", type: "picture", x: 10, y: 10, w: 100, h: 40, src: "/api/files/x/certificates/sig.png", opacity: 0.8 });
  const saved = await saveTemplate(admin.id, { ...t, bg: { color: "#fffbef" } });
  assert.equal(saved.bg.color, "#fffbef");
  assert.equal(saved.elements.find((e) => e.id === "sig1").src, "/api/files/x/certificates/sig.png");
  assert.ok(saved.elements.some((e) => e.fieldKey === "trust.name"));
  await assert.rejects(saveTemplate(admin.id, { ...t, elements: [{ id: "p", type: "picture", src: "data:image/png;base64,AAA" }] }), /upload/);
  const bad = await saveTemplate(admin.id, { ...t, bg: { color: "red; background:url(x)" } });
  assert.equal(bad.bg.color, "#ffffff");
  const ctx = buildContext({}, {}, Date.now(), { name: "Trust X", topTitle: ["A", "B"], logo: "/l.png" });
  assert.equal(ctx.trust.name, "Trust X");
  assert.equal(ctx.trust.title2, "B");
  assert.equal(ctx.trust.RightLogo, "/l.png");
});

test("ready blocks: each adds elements with fresh ids, twice without clashing", () => {
  for (const b of BLOCKS) {
    const a = blockElements(b.key), c = blockElements(b.key);
    assert.ok(a.length > 0, b.key);
    const ids = new Set([...a, ...c].map((e) => e.id));
    assert.equal(ids.size, a.length + c.length, `${b.key} ids unique`);
  }
});
