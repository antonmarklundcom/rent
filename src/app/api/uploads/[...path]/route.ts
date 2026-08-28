import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { type NextRequest } from "next/server";
import { Readable } from "stream";
import { contentTypeForFile, resolveUploadPath } from "@/lib/uploads-core";

/**
 * Serves the photos written by `src/lib/uploads.ts` (#1, #5, #6).
 *
 * Deliberately unauthenticated, like `/api/ical/[token]`: the filename carries
 * 8 random bytes and is only ever handed to someone who can already see the
 * task, ticket or inspection it belongs to. Nothing here enumerates.
 *
 * `resolveUploadPath` is the security boundary — it refuses any segment that
 * is not `[A-Za-z0-9._-]` and any path that resolves outside `UPLOAD_DIR`.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const filePath = resolveUploadPath(segments ?? []);
  if (!filePath) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": contentTypeForFile(filePath),
      "Content-Length": String(size),
      // Immutable: the filename is unique per upload, so it never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
