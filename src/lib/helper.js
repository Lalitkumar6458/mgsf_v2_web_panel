"use client";
// Same helper functions the old screens used — now backed by our own API
// instead of Firestore transactions / Cloud Functions.
import { api } from "./client/api";
import { toLegacyMember } from "./client/legacy";

// मान लीजिए कि 'db' आपकी Firebase इनिशियलाइज़ेशन फ़ाइल से आयात किया गया है
// import { db } from "./firebase"; 

// एक उदाहरण generateUnique4Digit फ़ंक्शन (हालांकि ट्रांजेक्शन में अब इसका उपयोग नहीं किया जाता है)
let used4DigitNumbers = new Set(); // यह केवल उदाहरण के लिए है
export function genUnique4DigitByTime() {
    const now = Date.now().toString(); // timestamp
    const last4 = now.slice(-4);       // last 4 digits
    return Number(last4);
}
export function generate6DigitRegNo() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);

  return (array[0] % 900000) + 100000; // always 6 digit
}

export function generateUnique4Digit() {
    let num;
    do {
        num = Math.floor(1000 + Math.random() * 9000);
    } while (used4DigitNumbers.has(num));
    used4DigitNumbers.add(num);
    return num;
}

/* ════════════════════════════════════════════════════════════════════════
   REGISTRATION NUMBER — per-program (yojna) configuration

   Each program document can carry its own numbering rules:

     regPrefix   string   e.g. "MG"  → MG000123        (default "R")
     regMode     string   "series" | "random"          (default "random")
     regDigits   number   digit count / zero padding   (default 6)
     regStartNo  number   first number in series mode  (default 1)
     regCounter  number   INTERNAL — last issued serial, managed by the
                          transaction so two members can never get the
                          same number

   Series mode is safer than random: the counter is bumped inside the same
   Firestore transaction that creates the member, so collisions are
   impossible. Random can theoretically repeat.
   ════════════════════════════════════════════════════════════════════════ */

export const REG_DEFAULTS = {
    regPrefix: 'R',
    regMode: 'random',
    regDigits: 6,
    regStartNo: 1,
};

const clampDigits = (d) => {
    const n = parseInt(d, 10);
    if (!Number.isFinite(n)) return REG_DEFAULTS.regDigits;
    return Math.min(Math.max(n, 3), 10);
};

/** Cryptographically random integer with exactly `digits` digits. */
function randomNumberOfDigits(digits) {
    const d = clampDigits(digits);
    const min = Math.pow(10, d - 1);
    const range = min * 9;

    // crypto in the browser / node 19+, Math.random as a last resort
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c?.getRandomValues) {
        const arr = new Uint32Array(1);
        c.getRandomValues(arr);
        return (arr[0] % range) + min;
    }
    return Math.floor(Math.random() * range) + min;
}

/** Read the numbering config off a program document, filling in defaults. */
export function getRegConfig(programData = {}) {
    return {
        regPrefix: programData.regPrefix ?? REG_DEFAULTS.regPrefix,
        regMode: programData.regMode === 'series' ? 'series' : 'random',
        regDigits: clampDigits(programData.regDigits ?? REG_DEFAULTS.regDigits),
        regStartNo: parseInt(programData.regStartNo, 10) > 0
            ? parseInt(programData.regStartNo, 10)
            : REG_DEFAULTS.regStartNo,
        regCounter: parseInt(programData.regCounter, 10) || 0,
    };
}

/**
 * Build the next registration number for a program.
 * @returns {{ registrationNumber: string, nextCounter: number|null }}
 *          `nextCounter` is non-null only in series mode — the caller must
 *          persist it on the program document inside the same transaction.
 */
export function buildRegistrationNumber(programData = {}) {
    const cfg = getRegConfig(programData);

    if (cfg.regMode === 'series') {
        const next = cfg.regCounter >= cfg.regStartNo
            ? cfg.regCounter + 1
            : cfg.regStartNo;
        return {
            registrationNumber: `${cfg.regPrefix}${String(next).padStart(cfg.regDigits, '0')}`,
            nextCounter: next,
        };
    }

    return {
        registrationNumber: `${cfg.regPrefix}${randomNumberOfDigits(cfg.regDigits)}`,
        nextCounter: null,
    };
}

/** Sample numbers for the "what will it look like" preview in the yojna form. */
export function previewRegistrationNumbers(config = {}, count = 3) {
    const cfg = getRegConfig(config);
    const out = [];
    for (let i = 0; i < count; i++) {
        if (cfg.regMode === 'series') {
            const n = (cfg.regCounter >= cfg.regStartNo ? cfg.regCounter + 1 : cfg.regStartNo) + i;
            out.push(`${cfg.regPrefix}${String(n).padStart(cfg.regDigits, '0')}`);
        } else {
            out.push(`${cfg.regPrefix}${randomNumberOfDigits(cfg.regDigits)}`);
        }
    }
    return out;
}


const programIdFromPath = (path) => {
  const m = String(path || "").match(/programs\/([^/]+)/);
  return m ? m[1] : null;
};

/**
 * Create a member (admin → accepted at once with reg. number + login; agent → pending).
 * Old signature kept: (programDocPath, memberCollectionPath, memberData, agentId)
 */
export async function createMemberInTransaction(programDocPath, _memberCollectionPath, memberData, agentId) {
  const programId = programIdFromPath(programDocPath) || memberData.programId;
  const r = await api.post(`/programs/${programId}/members`, {
    ...memberData,
    agentId: agentId || null,
    addedBy: agentId ? "agent" : "admin",
  });
  return {
    ...toLegacyMember(r.member),
    id: r.member.id,
    registrationNumber: r.registrationNumber || r.member.registrationNumber,
    memberNumber: r.memberNumber || r.member.memberNumber,
    initialPassword: r.initialPassword,
  };
}

/** true when an accepted/closed member of this program already has this Aadhaar */
export const checkAadhaarExists = async (memberCollectionPath, aadhaarNo) => {
  const programId = programIdFromPath(memberCollectionPath);
  if (!programId || !aadhaarNo) return false;
  const r = await api.get(`/programs/${programId}/members/check-aadhaar`, { aadhaarNo, onlyActive: 1 });
  return !!r.exists;
};

export const checkAadhaarExistsWithDetails = async (memberCollectionPath, aadhaarNo) => {
  const programId = programIdFromPath(memberCollectionPath);
  if (!programId || !aadhaarNo) return { exists: false, member: null };
  const r = await api.get(`/programs/${programId}/members/check-aadhaar`, { aadhaarNo });
  return { exists: !!r.exists, member: r.member || null };
};

/** Accept a pending request (reg. number, login account and dues are created by the server). */
export async function acceptMemberWithCounterUpdate(_userUid, _programId, memberId, memberData = {}) {
  const r = await api.post(`/members/${memberId}/accept`, memberData);
  return {
    ...memberData,
    id: memberId,
    memberId,
    memberNumber: r.memberNumber,
    newMemberCount: r.memberNumber,
    registrationNumber: r.registrationNumber,
    initialPassword: r.initialPassword,
  };
}

/**
 * Old generic status update. rejected / removed go to the status endpoint,
 * everything else is a normal member update.
 */
export async function updateMemberStatus(_userUid, _programId, memberId, updateData = {}) {
  const { status, rejectReason, removeReason, reason, ...rest } = updateData;
  if (status === "rejected" || status === "removed") {
    await api.post(`/members/${memberId}/status`, { status, reason: rejectReason || removeReason || reason || "" });
  } else if (status === "blocked") {
    await api.post(`/members/${memberId}/status`, { blocked: true });
  } else if (status === "accepted") {
    await api.post(`/members/${memberId}/accept`, rest);
  }
  const fields = Object.keys(rest).filter((k) => !["active_flag", "updatedAt", "createdAt", "approvedAt", "approvedBy", "rejectedAt", "rejectedBy", "removedAt"].includes(k));
  if (status !== "accepted" && fields.length) {
    await api.patch(`/members/${memberId}`, Object.fromEntries(fields.map((k) => [k, rest[k]])));
  }
  return updateData;
}

/** Push notifications are now sent by the server itself (Expo push) — nothing to do here. */
export const sendFirebaseNotification = async () => true;

/** Block ⇄ unblock */
export async function toggleMemberBlockStatus(_userUid, _programId, memberId, _agentId = null, message) {
  const { member } = await api.get(`/members/${memberId}`);
  const blocked = !member.blocked;
  await api.post(`/members/${memberId}/status`, { blocked });
  if (message) message.success(blocked ? "Member Blocked Successfully" : "Member Unblocked Successfully");
  return { memberId, status: blocked ? "blocked" : "accepted", active_flag: !blocked, countChange: blocked ? -1 : 1, inactiveCount: blocked ? 1 : -1 };
}

/** Counts are calculated live by the database now. */
export async function updateCounts() {
  return { success: true };
}

/** Agent report (old Cloud Function getAgentMarriagePaymentReport) — same response shape, expanded. */
export async function getAgentMemberPaystatus({ programId, agentId, closingGroupId }) {
  const data = await api.get(`/programs/${programId}/agents/${agentId}/report`, {
    closingGroupId: closingGroupId && closingGroupId !== "all" ? closingGroupId : undefined,
    compact: 1,
  });
  if (data?.compact && data.closings && Array.isArray(data.report)) {
    const closings = data.closings;
    data.report = data.report.map((member) => ({
      ...member,
      marriages: (member.marriages || []).map((m) => ({
        ...m,
        payerMemberId: member.memberId,
        ...(closings[m.closingMemberId] || {}),
      })),
    }));
    delete data.closings;
  }
  return data;
}

/** The report from the API already carries the closing member's details. */
export async function attachClosingMemberDetails({ report = [] }) {
  return report;
}

/** One member's dues as payer (Members → Payment Details). Same shape as before. */
export const fetchSingleMemberMarriageReport = async ({ memberId }) => {
  if (!memberId) throw new Error("memberId required");
  const [{ member }, { dues }] = await Promise.all([
    api.get(`/members/${memberId}`),
    api.get(`/members/${memberId}/dues`),
  ]);
  const legacy = toLegacyMember(member);
  const summary = { totalMarriages: 0, pendingMarriages: 0, paidMarriages: 0, pendingAmount: 0, paidAmount: 0 };
  const dmy = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("-") : "");
  const marriages = dues.map((d) => {
    const status = d.status === "paid" ? "paid" : "pending";
    summary.totalMarriages++;
    if (status === "paid") { summary.paidMarriages++; summary.paidAmount += d.amount; }
    else { summary.pendingMarriages++; summary.pendingAmount += d.amount - d.paidAmount; summary.paidAmount += d.paidAmount; }
    return {
      paymentId: d.id,
      payerMemberId: memberId,
      closingMemberId: d.closingMemberId,
      closingMemberName: d.closingMemberName || "",
      closingRegNo: d.closingRegNo || "NA",
      closingFatherName: d.closingFatherName || "NA",
      closingVillage: d.closingVillage || "NA",
      closingState: "",
      closingGuardian: d.closingGuardian || "",
      closingGuardianRelation: d.closingGuardianRelation || "",
      closingGroupId: d.closingGroupId || "",
      marriageDate: dmy(d.closingDate),
      paymentFor: d.closingMemberName || "Marriage Case",
      closingPhone: "NA",
      status,
      rawStatus: d.status,
      amount: d.amount,
      paidAmount: d.paidAmount,
      addedManually: d.addedManually,
      createdDate: "",
      updatedDate: d.paidAt || "",
    };
  });
  return {
    success: true,
    report: { memberId, ...legacy, marriages, summary, totalAmount: summary.pendingAmount + summary.paidAmount },
    summary: {
      totalMembers: 1,
      totalPending: summary.pendingMarriages,
      totalPaid: summary.paidMarriages,
      totalPendingAmount: summary.pendingAmount,
      totalPaidAmount: summary.paidAmount,
      totalAmount: summary.pendingAmount + summary.paidAmount,
    },
  };
};
