// Receipts (रसीद) job queue.
// - The browser only sends filters; data comes from the DB (receiptMembers).
// - Big runs are split into parts (≤ MAX_PAGES pages each); receipt numbers continue across parts.
// - PDFs are drawn in a worker thread (workers/receipt-worker.mjs) one part at a time, so the
//   API stays fast for everyone while a 1000-page run is being made.
// - Finished files live in <UPLOAD_DIR>/tmp/receipts for 24 hours.
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { receiptMembers, receiptEstimate } from "./reports.js";
import { badRequest } from "../lib/errors.js";

const ROWS_PER_PAGE = 10;           // VivahMemoPDF
const MAX_PAGES = Number(process.env.RECEIPT_PART_PAGES || 300);   // ≈ 30 s per part
const MAX_TOTAL_PAGES = Number(process.env.RECEIPT_MAX_PAGES || 20000);
const KEEP_MS = 24 * 3600 * 1000;

const g = globalThis;
const state = (g.__mgsfReceipts ??= { jobs: new Map(), queue: [], running: false, worker: null, waiting: new Map(), seq: 0 });

const dir = () => path.resolve(process.env.UPLOAD_DIR || "./uploads", "tmp", "receipts");
const workerFile = () => path.join(process.cwd(), "workers", "receipt-worker.mjs");

const pagesOf = (m) => Math.max(1, Math.ceil(m.marriages.length / ROWS_PER_PAGE));

/** split payers into parts of at most MAX_PAGES pages (a payer is never split) */
export function splitParts(members, maxPages = MAX_PAGES) {
  const parts = [];
  let cur = null;
  for (const m of members) {
    const p = pagesOf(m);
    if (!cur || (cur.pages + p > maxPages && cur.members.length)) {
      cur = { members: [], pages: 0, rows: 0 };
      parts.push(cur);
    }
    cur.members.push(m);
    cur.pages += p;
    cur.rows += m.marriages.length;
  }
  return parts;
}

async function getWorker() {
  // the bundle is rebuilt by `npm run dev` / `npm run build`; a worker started from an older
  // bundle would keep drawing with old code (e.g. a receipt instead of a report) — restart it
  const { mtimeMs } = await stat(workerFile()); // throws ENOENT if the bundle is missing → fallback below
  if (state.worker && state.workerMtime === mtimeMs) return state.worker;
  if (state.worker) { state.worker.terminate().catch(() => {}); state.worker = null; }
  const w = new Worker(workerFile());
  w.on("message", ({ id, ok, pdf, error, kind }) => {
    const p = state.waiting.get(id);
    if (!p) return;
    state.waiting.delete(id);
    ok ? p.resolve({ buf: Buffer.from(pdf), kind }) : p.reject(new Error(error));
  });
  w.on("error", (e) => {
    for (const p of state.waiting.values()) p.reject(e);
    state.waiting.clear();
    state.worker = null;
  });
  w.on("exit", () => { if (state.worker === w) state.worker = null; });
  state.worker = w;
  state.workerMtime = mtimeMs;
  return w;
}

/** Same PDF drawn in this thread — when the worker bundle is missing or out of date. */
async function renderHere(props, kind) {
  if (kind === "transactions") return (await import("@/lib/pdf/transactionsReport")).buildTransactionsReport(props);
  const React = (await import("react")).default;
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { default: VivahMemoPDF } = await import("@/components/screen/agents/agentDetails/component/pdfcom/VivahMemoPDF");
  return renderToBuffer(React.createElement(VivahMemoPDF, props));
}

/** Draw a PDF in the worker thread. kind: "receipts" (VivahMemoPDF) | "transactions" (pdfkit report) */
export async function renderPdf(props, kind = "receipts") {
  let res;
  try {
    const w = await getWorker();
    const id = ++state.seq;
    res = await new Promise((resolve, reject) => {
      state.waiting.set(id, { resolve, reject });
      w.postMessage({ id, kind, props });
    });
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
    console.warn("[pdf] worker bundle missing — run `npm run build:workers`; drawing in the main thread");
    return renderHere(props, kind);
  }
  // an old bundle does not know `kind` (it always drew receipts) — never hand that PDF out
  if (res.kind !== kind) {
    console.warn("[pdf] worker bundle is out of date — run `npm run build:workers`; drawing in the main thread");
    return renderHere(props, kind);
  }
  return res.buf;
}

async function cleanup() {
  try {
    const files = await readdir(dir());
    const now = Date.now();
    await Promise.all(files.map(async (f) => {
      const full = path.join(dir(), f);
      const s = await stat(full).catch(() => null);
      if (s && now - s.mtimeMs > KEEP_MS) await unlink(full).catch(() => {});
    }));
  } catch { /* dir not there yet */ }
  for (const [id, j] of state.jobs) if (Date.now() - j.createdAt > KEEP_MS) state.jobs.delete(id);
}

async function pump() {
  if (state.running) return;
  state.running = true;
  try {
    while (state.queue.length) {
      const job = state.queue[0];
      job.state = "running";
      job.startedAt ??= Date.now();
      try {
        await mkdir(dir(), { recursive: true });
        for (const part of job.parts) {
          if (part.status === "done") continue;
          part.status = "running";
          const t = Date.now();
          const pdf = await renderPdf({
            members: job._data[part.n - 1],
            agentInfo: job.agentInfo,
            programInfo: job.programInfo,
            TrustData: job.trust,
            paymentStatus: job.status,
            receiptStartNo: part.receiptFrom,
            receiptPrefix: job.receiptPrefix,
          });
          part.file = path.join(dir(), `${job.id}-${part.n}.pdf`);
          await writeFile(part.file, pdf);
          part.size = pdf.length;
          part.ms = Date.now() - t;
          part.status = "done";
          job._data[part.n - 1] = null; // free memory
        }
        job.state = "done";
      } catch (e) {
        console.error("receipt job failed", job.id, e);
        job.state = "error";
        job.error = e.message || "PDF failed";
        for (const p of job.parts) if (p.status !== "done") p.status = "error";
      }
      job.finishedAt = Date.now();
      job._data = null;
      state.queue.shift();
    }
  } finally {
    state.running = false;
  }
}

/**
 * Start a receipts run. opts: { status, agentId, closingGroupId, from, to, memberIds,
 * receiptStartNo, receiptPrefix, label, programInfo, agentInfo }
 */
export async function createReceiptJob(programId, adminId, trust, opts) {
  await cleanup();
  const status = opts.status === "paid" ? "paid" : "pending";
  // cheap size check first, so a huge request is refused without loading lakhs of rows
  const est = await receiptEstimate(programId, { ...opts, status });
  if (!est.members) throw badRequest(status === "paid" ? "No paid entries for these filters." : "No pending entries for these filters.");
  if (est.pages > MAX_TOTAL_PAGES) {
    throw badRequest(`Too big: ${est.pages} pages (${est.members} receipts). Choose a closing group, a date range or one agent.`);
  }
  const members = await receiptMembers(programId, { ...opts, status });
  const totalPages = members.reduce((s, m) => s + pagesOf(m), 0);
  const chunks = splitParts(members);
  const start = Math.max(1, Math.floor(Number(opts.receiptStartNo) || 1));
  let next = start;
  const job = {
    id: randomUUID(), adminId, programId, createdAt: Date.now(), state: "queued", status,
    label: opts.label || `${status === "paid" ? "Paid" : "Pending"} receipts`,
    filters: { agentId: opts.agentId || null, closingGroupId: opts.closingGroupId || null, from: opts.from || null, to: opts.to || null, members: opts.memberIds?.length || null },
    totals: { members: members.length, rows: members.reduce((s, m) => s + m.marriages.length, 0), pages: totalPages },
    receiptPrefix: opts.receiptPrefix || "",
    agentInfo: opts.agentInfo || {}, programInfo: opts.programInfo || {}, trust,
    parts: chunks.map((c, i) => {
      const p = {
        n: i + 1, status: "queued", members: c.members.length, rows: c.rows, pages: c.pages,
        receiptFrom: next, receiptTo: next + c.members.length - 1,
        firstMember: c.members[0]?.displayName, lastMember: c.members[c.members.length - 1]?.displayName,
      };
      next += c.members.length;
      return p;
    }),
    _data: chunks.map((c) => c.members),
  };
  state.jobs.set(job.id, job);
  state.queue.push(job);
  pump(); // not awaited
  return publicJob(job);
}

export function publicJob(job) {
  if (!job) return null;
  const position = state.queue.indexOf(job);
  const { _data, trust, adminId, ...rest } = job;
  return {
    ...rest,
    queuePosition: position > 0 ? position : 0,
    parts: job.parts.map(({ file, ...p }) => ({ ...p, url: p.status === "done" ? `/api/receipts/jobs/${job.id}/${p.n}` : null })),
    // rough ETA from ~10 pages / second
    etaSeconds: job.state === "done" || job.state === "error" ? 0
      : Math.round(job.parts.filter((p) => p.status !== "done").reduce((s, p) => s + p.pages, 0) / 10),
  };
}

export function getJob(adminId, jobId) {
  const j = state.jobs.get(jobId);
  return j && j.adminId === adminId ? j : null;
}

export function listJobs(adminId, programId) {
  return [...state.jobs.values()]
    .filter((j) => j.adminId === adminId && (!programId || j.programId === programId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map(publicJob);
}
