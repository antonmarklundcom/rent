/**
 * Activity log (plan §5.O2): every money- or legally-adjacent mutation writes
 * one row here.
 *
 * Callers pass their transaction, so the audit row commits or rolls back WITH
 * the write it describes. That is the point: for money movements a trail that
 * can silently diverge from the ledger is worse than none.
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
