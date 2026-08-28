/**
 * Activity log (plan §5.O2): every money- or legally-adjacent mutation writes
 * one row here. Deliberately fire-and-forget-safe — a logging failure must
 * never roll back the business write it describes, so callers that are outside
 * a transaction can ignore the returned promise's failure.
 */
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import type { Executor } from "@/db/queries/availability";

export type ActivityEntry = {
  entity: string;
  entityId?: number | null;
  action: string;
  userId?: number | null;
  meta?: Record<string, unknown>;
};

export async function logActivity(
  entry: ActivityEntry,
  executor: Executor = db,
): Promise<void> {
  await executor.insert(activityLog).values({
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    action: entry.action,
    userId: entry.userId ?? null,
    meta: entry.meta ?? null,
  });
}
