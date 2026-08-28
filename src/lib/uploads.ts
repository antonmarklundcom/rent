import "server-only";
/**
 * Photo storage (#1, #5, #6 — plan §5.O6/O8).
 *
 * A cleaner standing in a flat with a phone has to be able to attach a photo,
 * so this phase needs a real upload path, not a URL field. The mechanism is
 * deliberately the smallest one that works on Hostinger's managed Node hosting
 * (plan §1.4): write the bytes to a directory on disk and serve them back
 * through `/api/uploads/...`.
 *
 * Why a route handler instead of `public/`: `public/` is a BUILD input, so a
 * file written there after `next build` is not part of the deployment and does
 * not survive the next Git deploy. `UPLOAD_DIR` is a plain directory outside
 * the build output, which means it also survives a redeploy.
 *
 * Everything object-storage-shaped (S3, Bunny, Cloudinary) is a swap of
 * `storeUpload` + the route handler and nothing else — no caller knows where
 * the bytes live, they only ever see the returned URL string.
 */
import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { DomainError } from "@/lib/errors";
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  UPLOAD_FOLDERS,
  UPLOAD_URL_PREFIX,
  uploadRoot,
  type UploadFolder,
} from "@/lib/uploads-core";

export {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_FOLDERS,
  UPLOAD_URL_PREFIX,
  contentTypeForFile,
  resolveUploadPath,
  uploadRoot,
} from "@/lib/uploads-core";
export type { UploadFolder } from "@/lib/uploads-core";

export type StoredUpload = { url: string; bytes: number; contentType: string };

/**
 * Persist one uploaded image and return the URL to store on the row.
 * Rejects the wrong type or an oversized file BEFORE touching the disk.
 */
export async function storeUpload(file: File, folder: UploadFolder): Promise<StoredUpload> {
  if (!UPLOAD_FOLDERS.includes(folder)) {
    throw new DomainError("Destino de archivo inválido", "invalid_file", { folder });
  }
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    throw new DomainError("No se recibió ningún archivo", "invalid_file");
  }
  const extension = ACCEPTED_UPLOAD_EXTENSIONS[file.type];
  if (!extension) {
    throw new DomainError(
      "Formato no admitido: subí una foto JPG, PNG, WEBP o HEIC",
      "invalid_file",
      { type: file.type },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DomainError("La foto supera los 8 MB", "invalid_file", { size: file.size });
  }

  const name = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}.${extension}`;
  const directory = path.join(uploadRoot(), folder);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, name), Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    // Missing/unwritable UPLOAD_DIR must fail THIS action with a readable
    // message, never crash a page render (plan §4.5).
    throw new DomainError(
      "No se pudo guardar la foto. Revisá UPLOAD_DIR en el servidor.",
      "upload_failed",
      { cause: String(error) },
    );
  }
  return {
    url: `${UPLOAD_URL_PREFIX}/${folder}/${name}`,
    bytes: file.size,
    contentType: file.type,
  };
}
