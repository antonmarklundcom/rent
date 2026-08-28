/**
 * Owner onboarding pipeline (plan §5.O10, feature #19).
 *
 * A checklist per owner with five fixed steps. Three of them can be answered by
 * the database itself — photos, info base, iCal, first published listing — so
 * they are DERIVED and refreshed on read rather than ticked by hand: a
 * checklist that says "photos done" while the listing has none is worse than no
 * checklist. `contract` is the one nobody can derive; a human ticks it.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  icalSources,
  listingImages,
  listings,
  onboardingSteps,
  ownerOnboarding,
  owners,
  users,
  type OnboardingStepStatus,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { listingsWithInfoBase } from "@/db/queries/messages";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";

export const ONBOARDING_STEPS = [
  { key: "contract", label: "Contrato firmado", derived: false },
  { key: "photos", label: "Fotos profesionales cargadas", derived: true },
  { key: "info_base", label: "Base de información completa", derived: true },
  { key: "ical", label: "Calendario iCal conectado", derived: true },
  { key: "first_listing_published", label: "Primera publicación publicada", derived: true },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

/** Create the checklist for an owner if it does not exist yet. Idempotent. */
export async function ensureOnboarding(
  ownerId: number,
  executor?: Executor | null,
): Promise<number> {
  return inTransaction(executor, async (tx) => {
    await tx
      .insert(ownerOnboarding)
      .values({ ownerId })
      .onDuplicateKeyUpdate({ set: { ownerId: sql`owner_id` } });
    const [row] = await tx
      .select()
      .from(ownerOnboarding)
      .where(eq(ownerOnboarding.ownerId, ownerId))
      .limit(1);
    if (!row) throw new DomainError("No se pudo crear el onboarding", "not_found", { ownerId });
    await tx
      .insert(onboardingSteps)
      .values(
        ONBOARDING_STEPS.map((step, index) => ({
          onboardingId: row.id,
          stepKey: step.key,
          label: step.label,
          sortOrder: index,
        })),
      )
      .onDuplicateKeyUpdate({ set: { label: sql`VALUES(label)` } });
    return row.id;
  });
}

/** What the database can prove about an owner's setup. */
async function derivedState(
  ownerId: number,
  executor: Executor,
): Promise<Record<OnboardingStepKey, boolean>> {
  const ownerListings = await executor
    .select({ id: listings.id, status: listings.status })
    .from(listings)
    .where(eq(listings.ownerId, ownerId));
  const ids = ownerListings.map((row) => row.id);

  if (ids.length === 0) {
    return {
      contract: false,
      photos: false,
      info_base: false,
      ical: false,
      first_listing_published: false,
    };
  }

  const [withImages, withIcal, withInfo] = await Promise.all([
    executor
      .selectDistinct({ listingId: listingImages.listingId })
      .from(listingImages)
      .where(inArray(listingImages.listingId, ids)),
    executor
      .selectDistinct({ listingId: icalSources.listingId })
      .from(icalSources)
      .where(inArray(icalSources.listingId, ids)),
    listingsWithInfoBase(ids, executor),
  ]);

  return {
    contract: false,
    photos: withImages.length > 0,
    info_base: withInfo.length > 0,
    ical: withIcal.length > 0,
    first_listing_published: ownerListings.some((row) => row.status === "published"),
  };
}

export type OnboardingStep = {
  id: number;
  stepKey: string;
  label: string;
  status: OnboardingStepStatus;
  derived: boolean;
  completedAt: Date | null;
};

export type OnboardingProgress = {
  ownerId: number;
  ownerName: string;
  onboardingId: number;
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
  completedAt: Date | null;
};

/**
 * Read the checklist, refreshing the derived steps first.
 *
 * A derived step that the data now satisfies is written `done` (and stays done
 * — deleting the last photo does not un-onboard an owner who has been trading
 * for a year). A `skipped` step is a human decision and is never overwritten.
 */
export async function getOnboardingProgress(
  ownerId: number,
  executor?: Executor | null,
): Promise<OnboardingProgress> {
  return inTransaction(executor, async (tx) => {
    const onboardingId = await ensureOnboarding(ownerId, tx);
    const derived = await derivedState(ownerId, tx);

    const rows = await tx
      .select()
      .from(onboardingSteps)
      .where(eq(onboardingSteps.onboardingId, onboardingId))
      .orderBy(onboardingSteps.sortOrder);

    for (const row of rows) {
      const spec = ONBOARDING_STEPS.find((step) => step.key === row.stepKey);
      if (!spec?.derived) continue;
      if (row.status !== "pending") continue;
      if (!derived[spec.key]) continue;
      await tx
        .update(onboardingSteps)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(onboardingSteps.id, row.id));
      row.status = "done";
      row.completedAt = new Date();
    }

    const steps: OnboardingStep[] = rows.map((row) => ({
      id: row.id,
      stepKey: row.stepKey,
      label: row.label,
      status: row.status,
      derived: ONBOARDING_STEPS.find((step) => step.key === row.stepKey)?.derived ?? false,
      completedAt: row.completedAt,
    }));

    const doneCount = steps.filter((step) => step.status !== "pending").length;
    const completedAt = doneCount === steps.length && steps.length > 0 ? new Date() : null;
    if (completedAt) {
      await tx
        .update(ownerOnboarding)
        .set({ completedAt })
        .where(and(eq(ownerOnboarding.id, onboardingId), sql`completed_at IS NULL`));
    }

    const [owner] = await tx
      .select({ displayName: owners.displayName })
      .from(owners)
      .where(eq(owners.id, ownerId))
      .limit(1);

    return {
      ownerId,
      ownerName: owner?.displayName ?? `Propietario ${ownerId}`,
      onboardingId,
      steps,
      doneCount,
      totalCount: steps.length,
      completedAt,
    };
  });
}

/** Tick, un-tick or skip one step. `contract` is the one that needs this. */
export async function setOnboardingStep(
  input: { ownerId: number; stepKey: string; status: OnboardingStepStatus },
  actor: SessionUser,
  executor?: Executor | null,
): Promise<void> {
  return inTransaction(executor, async (tx) => {
    const onboardingId = await ensureOnboarding(input.ownerId, tx);
    const [row] = await tx
      .select()
      .from(onboardingSteps)
      .where(
        and(
          eq(onboardingSteps.onboardingId, onboardingId),
          eq(onboardingSteps.stepKey, input.stepKey),
        ),
      )
      .limit(1);
    if (!row) {
      throw new DomainError("Ese paso no existe", "not_found", { stepKey: input.stepKey });
    }
    await tx
      .update(onboardingSteps)
      .set({
        status: input.status,
        completedBy: input.status === "pending" ? null : actor.id,
        completedAt: input.status === "pending" ? null : new Date(),
      })
      .where(eq(onboardingSteps.id, row.id));
    await logActivity(
      {
        entity: "owner_onboarding",
        entityId: input.ownerId,
        action: `onboarding.${input.status}`,
        userId: actor.id,
        meta: { stepKey: input.stepKey },
      },
      tx,
    );
  });
}

/** The admin pipeline view: every owner and how far along they are (#19). */
export async function listOnboardingPipeline(
  executor: Executor = db,
): Promise<OnboardingProgress[]> {
  const rows = await executor
    .select({ id: owners.id })
    .from(owners)
    .innerJoin(users, eq(users.id, owners.userId))
    .where(isNotNull(owners.id))
    .orderBy(owners.id);
  const out: OnboardingProgress[] = [];
  for (const row of rows) {
    out.push(await getOnboardingProgress(row.id, executor));
  }
  return out;
}
