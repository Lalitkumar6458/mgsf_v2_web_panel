// PDF renderer running in its own thread, so a 500-page PDF does not freeze the API for
// everyone else. Bundled by scripts/build-workers.mjs → workers/receipt-worker.mjs
// (react / @react-pdf stay external, resolved from node_modules).
//   message: { id, kind: "receipts" | "transactions", props }
import { parentPort } from "node:worker_threads";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import VivahMemoPDF from "@/components/screen/agents/agentDetails/component/pdfcom/VivahMemoPDF";
import { buildTransactionsReport } from "@/lib/pdf/transactionsReport";

const DOCS = { receipts: VivahMemoPDF };
// drawn directly with pdfkit (react-pdf layout was ~8 ms per row — far too slow for big reports)
const BUILDERS = { transactions: buildTransactionsReport };

parentPort.on("message", async ({ id, kind = "receipts", props }) => {
  try {
    let buf;
    if (BUILDERS[kind]) buf = await BUILDERS[kind](props);
    else if (DOCS[kind]) buf = await renderToBuffer(React.createElement(DOCS[kind], props));
    else throw new Error(`unknown PDF kind: ${kind}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ id, ok: true, pdf: ab, kind }, [ab]); // kind echoed: lets the caller spot an old bundle
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
});
