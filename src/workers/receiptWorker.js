// Receipts (रसीद) PDF renderer running in its own thread, so a 500-page PDF does not
// freeze the API for everyone else. Bundled by scripts/build-workers.mjs →
// workers/receipt-worker.mjs (react / @react-pdf stay external, resolved from node_modules).
import { parentPort } from "node:worker_threads";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import VivahMemoPDF from "@/components/screen/agents/agentDetails/component/pdfcom/VivahMemoPDF";

parentPort.on("message", async ({ id, props }) => {
  try {
    const buf = await renderToBuffer(React.createElement(VivahMemoPDF, props));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ id, ok: true, pdf: ab }, [ab]);
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
});
