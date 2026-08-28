/**
 * Polymorphic photo store (#1, #5, #6 — plan §5.O2 `task_photos`).
 *
 * One table serves cleaning tasks, maintenance tickets and inspections, keyed
 * by `(subject_type, subject_id)`. The bytes themselves are handled by
 * `src/lib/uploads.ts`; this module only ever sees the URL it returned.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { taskPhotos, type PhotoSubject } from "@/db/schema";
import type { Executor } from "@/db/queries/availability";

export type AddPhotoInput = {
  subjectType: PhotoSubject;
  subjectId: number;
  url: string;
  caption?: string | null;
  uploadedBy?: number | null;
};

export async function addPhoto(
  input: AddPhotoInput,
  executor: Executor = db,
): Promise<typeof taskPhotos.$inferSelect> {
  const [inserted] = await executor
    .insert(taskPhotos)
    .values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      url: input.url,
      caption: input.caption?.trim() || null,
      uploadedBy: input.uploadedBy ?? null,
    })
    .$returningId();
  const [row] = await executor
    .select()
    .from(taskPhotos)
    .where(eq(taskPhotos.id, inserted!.id))
    .limit(1);
  return row!;
}

export async function listPhotos(
  subjectType: PhotoSubject,
  subjectId: number,
  executor: Executor = db,
) {
  return executor
    .select()
    .from(taskPhotos)
    .where(and(eq(taskPhotos.subjectType, subjectType), eq(taskPhotos.subjectId, subjectId)))
    .orderBy(asc(taskPhotos.id));
}

/** Photo counts for a list of subjects — one query instead of N. */
export async function countPhotosBySubject(
  subjectType: PhotoSubject,
  subjectIds: number[],
  executor: Executor = db,
): Promise<Map<number, number>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await executor
    .select({ subjectId: taskPhotos.subjectId, id: taskPhotos.id })
    .from(taskPhotos)
    .where(
      and(eq(taskPhotos.subjectType, subjectType), inArray(taskPhotos.subjectId, subjectIds)),
    );
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.subjectId, (counts.get(row.subjectId) ?? 0) + 1);
  return counts;
}

export async function deletePhoto(photoId: number, executor: Executor = db): Promise<void> {
  await executor.delete(taskPhotos).where(eq(taskPhotos.id, photoId));
}

/** Most recent photos across a subject type — the admin "latest evidence" strip. */
export async function recentPhotos(subjectType: PhotoSubject, limit = 12, executor: Executor = db) {
  return executor
    .select()
    .from(taskPhotos)
    .where(eq(taskPhotos.subjectType, subjectType))
    .orderBy(desc(taskPhotos.id))
    .limit(limit);
}
