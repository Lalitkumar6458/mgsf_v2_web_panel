// PDF renderer running in its own thread, so a 1000-page PDF does not freeze the API for
// everyone else. Bundled by scripts/build-workers.mjs → workers/receipt-worker.mjs
// (pdfkit / qrcode stay external, resolved from node_modules).
//   message: { id, kind: "receipts" | "transactions", props }
// Both are drawn straight with pdfkit (react-pdf's layout was far too slow for big runs).
import { parentPort } from "node:worker_threads";
import { buildTransactionsReport } from "@/lib/pdf/transactionsReport";
import { buildReceipts } from "@/lib/pdf/receipts";

const BUILDERS = { receipts: buildReceipts, transactions: buildTransactionsReport };

parentPort.on("message", async ({ id, kind = "receipts", props }) => {
  try {
    if (!BUILDERS[kind]) throw new Error(`unknown PDF kind: ${kind}`);
    const buf = await BUILDERS[kind](props);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ id, ok: true, pdf: ab, kind }, [ab]); // kind echoed: lets the caller spot an old bundle
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
});
