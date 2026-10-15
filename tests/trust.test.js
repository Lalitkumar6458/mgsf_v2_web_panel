// Trust profile: defaults, saving from Settings, and what PDFs receive.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { normalizeTrust, pickTrustInput, TRUST_DEFAULTS, displayName, initials } from "../src/lib/trust/profile.js";
import { trustHeaderHtml } from "../src/lib/trust/htmlHeader.js";
import { getTrustProfile, updateTrustInfo, publicBranding } from "../src/services/trust.js";

let admin;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "trust@test.in", displayName: "Test Trust" }).returning();
});
after(() => pool.end());

test("nothing saved → neutral 'Trust Manager', no logos, no MGSF details", () => {
  const t = normalizeTrust({});
  assert.equal(t.name, "Trust Manager");
  assert.equal(t.isDefault, true);
  assert.equal(t.headerMode, "auto");
  assert.equal(t.logo, null);
  assert.equal(t.RightLogo, null);
  assert.equal(t.regNo, "");
  assert.deepEqual(t.topTitle, []);
  assert.equal(displayName(t), "Trust Manager");
  assert.equal(initials(t), "TM");
  const html = trustHeaderHtml(t);
  assert.match(html, /Trust Manager/);
  assert.doesNotMatch(html, /रजिस्ट्रेशन|<img/);
});

test("old trustInfo with only trustName; empty name falls back", () => {
  assert.equal(normalizeTrust({ trustName: "पुराना ट्रस्ट" }).name, "पुराना ट्रस्ट");
  assert.equal(normalizeTrust({ name: "  " }).name, "Trust Manager");
  assert.equal(displayName({ name: "Mera Ghanchi Samaj", shortName: "MGSF" }), "MGSF");
  assert.equal(initials({ name: "Mera Ghanchi Samaj" }), "MG");
});

test("old Firestore shape: trustStamp → stampImg, comma topTitle → array, empty string kept", () => {
  const t = normalizeTrust({ trustStamp: "https://x/stamp.png", topTitle: "a, b", regNo: "", name: "New Trust" });
  assert.equal(t.stampImg, "https://x/stamp.png");
  assert.deepEqual(t.topTitle, ["a", "b"]);
  assert.equal(t.regNo, "");
  assert.equal(t.name, "New Trust");
});

test("pickTrustInput drops data: images and unknown keys", () => {
  const p = pickTrustInput({ name: "X", logo: "data:image/png;base64,AAA", stampImg: "/api/files/trust/a.png", hacker: 1, headerMode: "bad" });
  assert.deepEqual(p, { name: "X", logo: null, stampImg: "/api/files/trust/a.png" });
});

test("save from Settings → every PDF gets the new details; images inlined", async () => {
  await updateTrustInfo(admin.id, {
    name: "नया ट्रस्ट", shortName: "NT", contact: "9000000001", regNo: "R-77", address: "नया पता", founder: "राम 9000000001",
    topTitle: "|| जय माताजी ||\n|| श्री गणेशाय नमः ||", logo: "/Images/logo.jpg", headerMode: "auto",
  }, "acc-1");
  const t = await getTrustProfile(admin.id);
  assert.equal(t.name, "नया ट्रस्ट");
  assert.equal(t.regNo, "R-77");
  assert.deepEqual(t.topTitle, ["|| जय माताजी ||", "|| श्री गणेशाय नमः ||"]);
  assert.ok(t.logo.startsWith("data:image/jpeg;base64,"), "public file turned into a data URI");
  assert.equal(t.RightLogo, t.logo);
  const row = await db.query.admins.findFirst();
  assert.equal(row.displayName, "नया ट्रस्ट");

  const html = trustHeaderHtml(t);
  assert.match(html, /नया ट्रस्ट/);
  assert.match(html, /रजिस्ट्रेशन R-77/);
  assert.match(html, /9000000001/);

  assert.equal(t.isDefault, false);
  const pub = await publicBranding();
  assert.equal(pub.name, "नया ट्रस्ट");
  assert.equal(pub.shortName, "NT");
  assert.equal(pub.logo, "/Images/logo.jpg");
});

test("header picture mode + reset image back to default", async () => {
  await updateTrustInfo(admin.id, { headerMode: "image", logo: null }, "acc-1");
  const t = await getTrustProfile(admin.id, { inlineImages: false });
  assert.equal(t.headerMode, "image");
  assert.equal(t.logo, null, "logo removed");
  assert.equal(t.name, "नया ट्रस्ट", "other fields untouched");
  // no header picture uploaded → still the auto header
  assert.doesNotMatch(trustHeaderHtml(t), /object-fit:fill/);
  await updateTrustInfo(admin.id, { headerImg: "/Images/headerImg.png" }, "acc-1");
  assert.match(trustHeaderHtml(await getTrustProfile(admin.id, { inlineImages: false })), /object-fit:fill/);
});
