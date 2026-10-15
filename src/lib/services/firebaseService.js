"use client";
// Same function names the old screens used (getData, createProgram …), but the
// data now comes from our own API instead of Firestore.
//
// getData(path, filters, order, limit) understands the old Firestore paths:
//   /users/{uid}/programs
//   /users/{uid}/agents
//   /users/{uid}/programs/{programId}/members
//   /users/{uid}/programs/{programId}/closing_groups
// The rows come back in the OLD document shape (photoURL, delete_flag, …) and
// the old where/orderBy/limit are applied in the browser.
import { api } from "../client/api";
import { toLegacyMember, toLegacyAgent, toLegacyProgram, toLegacyTransaction } from "../client/legacy";

// ─── loaders ────────────────────────────────────────────────────────────────
export async function fetchAllMembers(programId, query = {}) {
  // first page tells the total; the rest are fetched in parallel (5000 members ≈ 5 requests at once)
  const PAGE = 1000;
  const first = await api.get(`/programs/${programId}/members`, { pageSize: PAGE, page: 1, ...query });
  const pages = Math.min(99, Math.ceil((first.total || 0) / PAGE));
  const rest = pages > 1
    ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
        api.get(`/programs/${programId}/members`, { pageSize: PAGE, page: i + 2, ...query })))
    : [];
  return [first, ...rest].flatMap((r) => r.members.map(toLegacyMember));
}

export async function fetchPrograms() {
  const r = await api.get("/programs");
  return r.programs.map(toLegacyProgram);
}

export async function fetchAgents(programId) {
  const r = await api.get("/agents", { programId });
  return r.agents.map((a) => toLegacyAgent(a, programId));
}

export async function fetchClosingGroups(programId) {
  if (!programId) return [];
  const r = await api.get(`/programs/${programId}/closing-groups`);
  return r.groups.map((g) => ({ ...g, memberCount: g.memberCount || 0, members: [] }));
}

/** All transactions of a program (paged from the API). query: payerId, closingId, agentId, from, to, q, status */
export async function fetchAllTransactions(programId, query = {}) {
  // one request for the whole (filtered) list; the server caps it at 50,000 rows
  const r = await api.get(`/programs/${programId}/transactions`, { all: 1, status: "all", ...query });
  const out = r.transactions.map(toLegacyTransaction);
  out.capped = !!r.capped;
  out.cap = r.cap;
  return out;
}

// ─── old Firestore-style query emulation ────────────────────────────────────
function parsePath(path) {
  const p = String(path).replace(/^\/+|\/+$/g, "").split("/");
  // users/{uid}/...
  if (p[0] !== "users") return { kind: "unknown" };
  if (p.length === 3 && p[2] === "programs") return { kind: "programs" };
  if (p.length === 3 && p[2] === "agents") return { kind: "agents" };
  if (p.length === 5 && p[2] === "programs") return { kind: p[4], programId: p[3] };
  return { kind: "unknown" };
}

const get = (obj, field) => String(field).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

function matches(row, { field, operator, value }) {
  const v = get(row, field);
  switch (operator) {
    case "==": return v === value;
    case "!=": return v !== value;
    case "in": return Array.isArray(value) && value.includes(v);
    case "not-in": return Array.isArray(value) && !value.includes(v);
    case ">": return v > value;
    case ">=": return v >= value;
    case "<": return v < value;
    case "<=": return v <= value;
    case "array-contains": return Array.isArray(v) && v.includes(value);
    default: return true;
  }
}

function sortValue(v) {
  if (v && typeof v.toMillis === "function") return v.toMillis();
  return v ?? "";
}

/** One-time read (old getData) */
export async function getData(collectionName, filters = [], order = null, limitCount = null) {
  const { kind, programId } = parsePath(collectionName);
  let rows;
  if (kind === "programs") rows = await fetchPrograms();
  else if (kind === "agents") rows = await fetchAgents();
  else if (kind === "members") rows = await fetchAllMembers(programId, { includeDeleted: 1 });
  else if (kind === "closing_groups") rows = await fetchClosingGroups(programId);
  else if (kind === "transactions") {
    // let the server narrow it down when the old query filtered by payer / closing member
    const eq = (f) => filters.find((x) => x.field === f && x.operator === "==")?.value;
    rows = await fetchAllTransactions(programId, {
      payerId: eq("payerId"),
      closingId: eq("closingMemberId") || eq("marriageId"),
    });
  }
  else throw new Error(`getData: "${collectionName}" is not available in v2 yet`);

  rows = rows.filter((r) => filters.every((f) => matches(r, f)));
  if (order?.field) {
    const dir = order.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const x = sortValue(get(a, order.field)), y = sortValue(get(b, order.field));
      return x < y ? -dir : x > y ? dir : 0;
    });
  }
  return limitCount ? rows.slice(0, limitCount) : rows;
}

/** Old live listener — now a single fetch (call the returned function to "unsubscribe"). */
export function liveData(collectionName, callback) {
  let stop = false;
  getData(collectionName, [], { field: "createdAt", direction: "desc" }).then((d) => !stop && callback(d)).catch(console.error);
  return () => { stop = true; };
}

export async function createData() {
  throw new Error("createData is not supported in v2 — use the API");
}
export async function updateData() {
  throw new Error("updateData is not supported in v2 — use the API");
}
export async function deleteData() {
  throw new Error("deleteData is not supported in v2 — use the API");
}

// ─── programs (yojna) ───────────────────────────────────────────────────────
export const createProgram = async (_userId, programData) => {
  const r = await api.post("/programs", programData);
  return { success: true, id: r.program.id };
};

export const updateProgram = async (_userId, programId, programData) => {
  await api.patch(`/programs/${programId}`, programData);
  return { success: true };
};

export const deleteProgram = async (_userId, programId) => {
  await api.del(`/programs/${programId}`);
  return { success: true };
};

export const getSelectedProgram = async () => {
  const list = await fetchPrograms();
  return list.find((p) => p.isSelected) || null;
};
