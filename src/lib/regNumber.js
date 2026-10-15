// Registration number rules — same as old helper.js (buildRegistrationNumber)
import { randomInt } from "node:crypto";

export const REG_DEFAULTS = { regPrefix: "R", regMode: "random", regDigits: 6, regStartNo: 1 };

const clampDigits = (d) => {
  const n = parseInt(d, 10);
  if (!Number.isFinite(n)) return REG_DEFAULTS.regDigits;
  return Math.min(Math.max(n, 3), 10);
};

export function getRegConfig(p = {}) {
  const start = parseInt(p.regStartNo, 10);
  return {
    regPrefix: p.regPrefix ?? REG_DEFAULTS.regPrefix,
    regMode: p.regMode === "series" ? "series" : "random",
    regDigits: clampDigits(p.regDigits ?? REG_DEFAULTS.regDigits),
    regStartNo: start > 0 ? start : REG_DEFAULTS.regStartNo,
    regCounter: parseInt(p.regCounter, 10) || 0,
  };
}

/** @returns {{registrationNumber: string, nextCounter: number|null}} */
export function buildRegistrationNumber(program = {}) {
  const cfg = getRegConfig(program);
  if (cfg.regMode === "series") {
    const next = cfg.regCounter >= cfg.regStartNo ? cfg.regCounter + 1 : cfg.regStartNo;
    return {
      registrationNumber: `${cfg.regPrefix}${String(next).padStart(cfg.regDigits, "0")}`,
      nextCounter: next,
    };
  }
  const min = 10 ** (cfg.regDigits - 1);
  return { registrationNumber: `${cfg.regPrefix}${randomInt(min, min * 10)}`, nextCounter: null };
}

/**
 * Old default password rule (commonFun.generateMemberPassword):
 * first word of the name, max 5 letters, lowercase + birth year. "Ram Lal", 1999 → "ram1999"
 */
export function defaultMemberPassword(displayName, birthDate) {
  const first = String(displayName || "").trim().split(" ")[0].toLowerCase().slice(0, 5);
  const m = String(birthDate || "").match(/(\d{4})/);
  return first && m ? `${first}${m[1]}` : "Member@123";
}
