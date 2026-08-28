/**
 * Owner onboarding pipeline (#19 — plan §5.O10).
 *
 * A checklist per owner: contract, photos, info base, iCal, first listing
 * published. Three of the five steps have an objective answer already in the
 * database, so `refreshDerivedSteps` reconciles them instead of asking an admin
 * to tick a box that a query can answer — a checklist that lies is worse than
 * no checklist.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  icalSources,
  listingImages,
  listings,
  onboardingSteps,
  owners,
  ownerOnboarding,
  users,
  type OnboardingStepStatus,
} from "@/db/schema";
import type { Executor } from "@/db/queries/availability";
import { infoItemCounts } from "@/db/queries/info";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";

export const ONBOARDING_STEPS = [
  { key: "contract", label: "Contrato firmado", derived: false },
  { key: "photos", label: "Fotos cargadas", derived: true },
  { key: "info_base", label: "Base de información completa", derived: true },
  { key: "ical", label: "Calendario iCal conectado", derived: true },
  { key: "first_listing_published", label: "Primera publicación publicada", derived: true },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

/** Steps a query can answer — an admin only ever ticks `contract` by hand. */
const DERIVED_KEYS = ONBOARDING_STEPS.filter((s) => s.derived).map((s) => s.key);

export async function ensureOnboarding(ownerId: number, executor: Executor = db) {
  await executor
    .insert(ownerOnboarding)
    .values({ ownerId })
    .onDuplicateKeyUpdate({ set: { ownerId: sql`owner_id` } });
  const [row] = await executor
    .select()
    .from(ownerOnboarding)
    .where(eq(ownerOnboarding.ownerId, ownerId))
    .limit(1);
  if (!row) throw new DomainError("No se pudo crear el onboarding", "not_found", { ownerId });

  await executor
    .insert(onboardingSteps)
    .values(
      ONBOARDING_STEPS.map((step, index) => ({
        onboardingId: row.id,
        stepKey: step.key,
        label: step.label,
        sortOrder: index,
      })),
    )
    .onDuplicateKeyUpdate({ set: { label: sql`label` } });
  return row;
}

/**
 * Re-derive the four objective steps from the data, and close the checklist
 * when every step is settled. Cheap enough to run on a page read.
 */
export async function refreshDerivedSteps(
  ownerId: number,
  executor: Executor = db,
): Promise<void> {
  const onboarding = await ensureOnboarding(ownerId, executor);

  const ownedListings = await executor
    .select({ id: listings.id, status: listings.status })
    .from(listings)
    .where(eq(listings.ownerId, ownerId));
  const listingIds = ownedListings.map((l) => l.id);

  const [images, sources, infoCounts] = await Promise.all([
    listingIds.length
      ? executor
          .select({ listingId: listingImages.listingId })
          .from(listingImages)
          .where(inArray(listingImages.listingId, listingIds))
      : Promise.resolve([]),
    listingIds.length
      ? executor
          .select({ listingId: icalSources.listingId })
          .from(icalSources)
          .where(inArray(icalSources.listingId, listingIds))
      : Promise.resolve([]),
    infoItemCounts(listingIds, executor),
  ]);

  const derived: Record<string, boolean> = {
    photos: images.length > 0,
    info_base: [...infoCounts.values()].some((count) => count >= 2),
    ical: sources.length > 0,
    first_listing_published: ownedListings.some((l) => l.status === "published"),
  };

  for (const [stepKey, done] of Object.entries(derived)) {
    await executor
      .update(onboardingSteps)
      .set({ status: done ? "done" : "pending", completedAt: done ? new Date() : null })
      .where(
        and(
          eq(onboardingSteps.onboardingId, onboarding.id),
          eq(onboardingSteps.stepKey, stepKey),
          // A step an admin marked `skipped` stays skipped — the derivation
          // reconciles fact, it does not overrule a human decision.
          inArray(onboardingSteps.status, ["pending", "done"]),
        ),
      );
  }

  const steps = await executor
    .select()
    .from(onboardingSteps)
    .where(eq(onboardingSteps.onboardingId, onboarding.id));
  const settled = steps.every((step) => step.status !== "pending");
  await executor
    .update(ownerOnboarding)
    .set({ completedAt: settled ? (onboarding.completedAt ?? new Date()) : null })
    .where(eq(ownerOnboarding.id, onboarding.id));
}

export type OnboardingView = {
  ownerId: number;
  onboardingId: number;
  displayName: string;
  email: string;
  startedAt: Date;
  completedAt: Date | null;
  notes: string | null;
  steps: (typeof onboardingSteps.$inferSelect)[];
  doneCount: number;
  totalCount: number;
};

export async function getOnboarding(
  ownerId: number,
  executor: Executor = db,
): Promise<OnboardingView | null> {
  await refreshDerivedSteps(ownerId, executor);
  const [row] = await executor
    .select({
      onboarding: ownerOnboarding,
      displayName: owners.displayName,
      email: users.email,
    })
    .from(ownerOnboarding)
    .innerJoin(owners, eq(owners.id, ownerOnboarding.ownerId))
    .innerJoin(users, eq(users.id, owners.userId))
    .where(eq(ownerOnboarding.ownerId, ownerId))
    .limit(1);
  if (!row) return null;

  const steps = await executor
    .select()
    .from(onboardingSteps)
    .where(eq(onboardingSteps.onboardingId, row.onboarding.id))
    .orderBy(asc(onboardingSteps.sortOrder), asc(onboardingSteps.id));

  return {
    ownerId,
    onboardingId: row.onboarding.id,
    displayName: row.displayName,
    email: row.email,
    startedAt: row.onboarding.startedAt,
    completedAt: row.onboarding.completedAt,
    notes: row.onboarding.notes,
    steps,
    doneCount: steps.filter((s) => s.status === "done").length,
    totalCount: steps.length,
  };
}

/** Every owner's checklist — the admin pipeline view (#19). */
export async function listOnboarding(executor: Executor = db): Promise<OnboardingView[]> {
  const ownerRows = await executor.select({ id: owners.id }).from(owners).orderBy(asc(owners.id));
  const views: OnboardingView[] = [];
  for (const owner of ownerRows) {
    const view = await getOnboarding(owner.id, executor);
    if (view) views.push(view);
  }
  return views;
}

/**
 * Set a step by hand. `contract` is the only step with no query behind it;
 * the rest can still be skipped deliberately (an owner with one property has
 * no iCal to connect), which the derivation then leaves alone.
 */
export async function setOnboardingStep(
  input: { ownerId: number; stepKey: string; status: OnboardingStepStatus },
  actor: SessionUser,
  executor: Executor = db,
): Promise<void> {
  const onboarding = await ensureOnboarding(input.ownerId, executor);
  const known = ONBOARDING_STEPS.some((step) => step.key === input.stepKey);
  if (!known) {
    throw new DomainError("Ese paso no existe", "not_found", { stepKey: input.stepKey });
  }
  if (input.status === "done" && DERIVED_KEYS.includes(input.stepKey as never)) {
    throw new DomainError(
      "Ese paso se marca solo cuando el dato existe. Cargalo, o marcalo como omitido.",
      "invalid_transition",
      { stepKey: input.stepKey },
    );
  }
  await executor
    .update(onboardingSteps)
    .set({
      status: input.status,
      completedBy: input.status === "pending" ? null : actor.id,
      completedAt: input.status === "pending" ? null : new Date(),
    })
    .where(
      and(
        eq(onboardingSteps.onboardingId, onboarding.id),
        eq(onboardingSteps.stepKey, input.stepKey),
      ),
    );
  await refreshDerivedSteps(input.ownerId, executor);
}

export async function setOnboardingNotes(
  ownerId: number,
  notes: string | null,
  executor: Executor = db,
): Promise<void> {
  await ensureOnboarding(ownerId, executor);
  await executor
    .update(ownerOnboarding)
    .set({ notes: notes?.trim() || null })
    .where(eq(ownerOnboarding.ownerId, ownerId));
}
