/**
 * Upload rules with NO Next.js and NO filesystem dependency, so
 * `scripts/verify-logic.ts` can pin the path-traversal guard and the accepted
 * types without a server (same split as `auth-core.ts` / `auth.ts`).
 *
 * The bytes themselves are written by `src/lib/uploads.ts`, which is
 * `server-only`.
 */
import path from "path";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Extension per accepted type — the ONLY extensions this app ever writes. */
export const ACCEPTED_UPLOAD_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const ACCEPTED_UPLOAD_TYPES = Object.keys(ACCEPTED_UPLOAD_EXTENSIONS);
/** `accept` attribute for the file inputs. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_UPLOAD_TYPES.join(",");

/** Folders callers may write into — an allow-list, never a caller-built path. */
export const UPLOAD_FOLDERS = ["cleaning", "maintenance", "inspection", "document"] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export const UPLOAD_URL_PREFIX = "/api/uploads";

/** Absolute path of the upload root. Configurable so prod can point at a volume. */
export function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? ".uploads");
}

/**
 * Resolve a stored file's path, refusing anything that escapes the root.
 * The route handler's only defence against `../../etc/passwd`.
 */
export function resolveUploadPath(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 3) return null;
  if (segments.some((s) => !/^[A-Za-z0-9._-]+$/.test(s) || s === "." || s === "..")) return null;
  const root = uploadRoot();
  const full = path.resolve(root, ...segments);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return full.startsWith(rootWithSep) ? full : null;
}

export function contentTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const found = Object.entries(ACCEPTED_UPLOAD_EXTENSIONS).find(([, e]) => e === ext);
  return found ? found[0] : "application/octet-stream";
}
