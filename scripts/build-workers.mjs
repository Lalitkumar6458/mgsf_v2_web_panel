// Bundles background workers (receipts PDF) into ./workers. Runs before `next dev` / `next build`.
import path from "node:path";
import { fileURLToPath } from "node:url";

let build;
try {
  ({ build } = await import("esbuild"));
} catch {
  console.warn("[build-workers] esbuild not installed — skipping (receipts will be drawn in the main thread). Run: npm install");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: { "receipt-worker": path.join(root, "src/workers/receiptWorker.js") },
  outdir: path.join(root, "workers"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  loader: { ".js": "jsx" },
  alias: { "@": path.join(root, "src") },
  external: ["react", "react-dom", "react/jsx-runtime", "@react-pdf/renderer", "pdfkit"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("✔ workers built");
