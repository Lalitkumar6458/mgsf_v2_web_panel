import { readLocalUpload } from "@/lib/storage.js";

/** Serves uploads when STORAGE=local (no R2/S3 configured). */
export async function GET(_req, ctx) {
  const { path } = await ctx.params;
  const file = await readLocalUpload(path.join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.data, {
    headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
