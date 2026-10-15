// Yojna member count display: actual / percent / fixed-start.  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCountDisplay, displayCount } from "../src/lib/memberCountDisplay.js";

test("percent grows with the real count", () => {
  const c = normalizeCountDisplay({ mode: "percent", percent: 70 });
  assert.equal(displayCount(1000, c), 700);
  assert.equal(displayCount(1100, c), 770);
  assert.equal(normalizeCountDisplay({ mode: "percent", percent: 0 }).percent, 100);
});

test("fixed starts at the chosen number, then adds every new member", () => {
  const c = normalizeCountDisplay({ mode: "fixed", fixed: 600 }, {}, 1000);
  assert.equal(displayCount(1000, c), 600);
  assert.equal(displayCount(1050, c), 650);
  assert.equal(displayCount(990, c), 600); // members leaving never drop it below the start
  // saving again with the same number keeps the starting point
  const again = normalizeCountDisplay({ mode: "fixed", fixed: 600 }, c, 1050);
  assert.equal(again.baseActual, 1000);
  assert.equal(displayCount(1050, again), 650);
  // a new number starts over from today's real count
  const reset = normalizeCountDisplay({ mode: "fixed", fixed: 800 }, c, 1050);
  assert.equal(displayCount(1050, reset), 800);
});

test("actual / junk", () => {
  assert.deepEqual(normalizeCountDisplay(null), { mode: "actual" });
  assert.equal(displayCount(1234, { mode: "actual" }), 1234);
  assert.equal(displayCount(1234, undefined), 1234);
});
