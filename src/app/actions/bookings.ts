"use server";

/**
 * Server actions over the booking engine (plan §5.O4).
 *
 * Every mutating action calls `requireRole` first and scopes owner access with
 * `src/lib/scope.ts` — the engine functions themselves take no session, so the
 * gate has to live here and nowhere else. Phase O-4 builds the pages that call
 * these; Window 2 styles those pages without touching this file (§4.7).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createBooking,
  quoteForListing,
  transitionBooking,
  type BookingQuote,
} from "@/db/queries/bookings";
import { createBlock, deleteBlock, getBlockById } from "@/db/queries/blocks";
import { ADMIN_ROLES } from "@/lib/auth-core";
import { requireRole } from "@/lib/auth";
import { BOOKING_STATUSES } from "@/db/schema";
import { assertCanAccessBooking, assertCanAccessListing } from "@/lib/scope";
import { DomainError } from "@/lib/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

/** Domain failures are expected input errors; anything else is a real bug. */
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: error.message, code: error.code };
    }
    throw error;
  }
}

const dateish = z.union([z.string().min(4), z.date()]);
const extrasSchema = z
  .array(z.object({ extraId: z.number().int().positive(), qty: z.number().int().min(1).max(50) }))
  .max(20)
  .optional();

const quoteSchema = z.object({
  listingId: z.number().int().positive(),
  startAt: dateish,
  endAt: dateish,
  extras: extrasSchema,
  promoCode: z.string().trim().max(40).nullish(),
});

/** Public — anyone may price a stay before asking for it. */
export async function quoteBookingAction(
  input: z.input<typeof quoteSchema>,
): Promise<ActionResult<BookingQuote>> {
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de reserva inválidos" };
  return run(() => quoteForListing({ ...parsed.data, requirePublished: true }));
}

const requestSchema = quoteSchema.extend({
  guestName: z.string().trim().min(2).max(180),
  guestPhone: z.string().trim().max(40).nullish(),
  guestEmail: z.string().trim().max(255).nullish(),
  guestCount: z.number().int().min(1).max(50).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

/**
 * Public booking request → an `inquiry`. An inquiry never holds dates; an
 * admin confirms it, and confirmation is where availability is enforced.
 */
export async function requestBookingAction(
  input: z.input<typeof requestSchema>,
): Promise<ActionResult<{ id: number; reference: string; total: string }>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de reserva inválidos" };
  return run(async () => {
    const { booking } = await createBooking({
      ...parsed.data,
      status: "inquiry",
      source: "web",
      requirePublished: true,
    });
    revalidatePath("/admin");
    return { id: booking.id, reference: booking.reference, total: booking.total };
  });
}

const manualSchema = requestSchema.extend({
  status: z.enum(["inquiry", "confirmed"]).default("confirmed"),
  source: z.enum(["web", "whatsapp", "manual"]).default("manual"),
});

/** Admin manual booking — the same engine, so it cannot double-book either. */
export async function createManualBookingAction(
  input: z.input<typeof manualSchema>,
): Promise<ActionResult<{ id: number; reference: string; total: string }>> {
  const user = await requireRole(ADMIN_ROLES);
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de reserva inválidos" };
  return run(async () => {
    const { booking } = await createBooking(parsed.data, user);
    revalidatePath("/admin");
    return { id: booking.id, reference: booking.reference, total: booking.total };
  });
}

const transitionSchema = z.object({
  bookingId: z.number().int().positive(),
  to: z.enum(BOOKING_STATUSES),
  reason: z.string().trim().max(300).optional(),
});

/** Admins move any booking; an owner may only move their own. */
export async function transitionBookingAction(
  input: z.input<typeof transitionSchema>,
): Promise<ActionResult<{ id: number; status: string }>> {
  const user = await requireRole(["super_admin", "admin", "owner"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Transición inválida" };
  await assertCanAccessBooking(user, parsed.data.bookingId);
  return run(async () => {
    const result = await transitionBooking(parsed.data.bookingId, parsed.data.to, user, {
      reason: parsed.data.reason,
    });
    revalidatePath("/admin");
    revalidatePath("/panel");
    return { id: result.booking.id, status: result.booking.status };
  });
}

const blockSchema = z.object({
  listingId: z.number().int().positive(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  reason: z.enum(["owner_use", "maintenance"]).default("owner_use"),
  note: z.string().trim().max(300).nullish(),
});

/** Owner blocked dates (#15) — behave exactly like a booking in availability. */
export async function createBlockAction(
  input: z.input<typeof blockSchema>,
): Promise<ActionResult<{ id: number }>> {
  const user = await requireRole(["super_admin", "admin", "owner"]);
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fechas inválidas" };
  await assertCanAccessListing(user, parsed.data.listingId);
  return run(async () => {
    const block = await createBlock(parsed.data, user);
    revalidatePath("/panel");
    return { id: block.id };
  });
}

export async function deleteBlockAction(
  blockId: number,
): Promise<ActionResult<{ id: number }>> {
  const user = await requireRole(["super_admin", "admin", "owner"]);
  return run(async () => {
    const block = await getBlockById(blockId);
    if (!block) throw new DomainError("El bloqueo no existe", "not_found", { blockId });
    await assertCanAccessListing(user, block.listingId);
    await deleteBlock(blockId, user);
    revalidatePath("/panel");
    return { id: blockId };
  });
}
