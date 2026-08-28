/**
 * alquilar.com.py — complete database schema (plan §2 + §5.O2).
 *
 * The FULL schema lives here from phase O-1 onward, including tables that only
 * later phases read or write. Schema is never retrofitted (plan §5 header).
 *
 * Conventions:
 * - Table and column identifiers are English (plan §1.3b); domain enum values
 *   that ARE Spanish stay Spanish (`casa`, `departamento`, `auto`, ...).
 * - Money is `decimal(14,2)` and returned as a string by mysql2; always run it
 *   through `src/lib/money.ts` rather than JS floats.
 * - All date ranges are stored as `datetime` in UTC (pool sets timezone "Z").
 *   Stays are normalised to their check-in/check-out clock times so a single
 *   overlap function serves both verticals (see plan §9).
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

const createdAt = () => timestamp("created_at").notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at").notNull().defaultNow().onUpdateNow();
const money = (name: string) => decimal(name, { precision: 14, scale: 2 });

/* -------------------------------------------------------------------------- */
/* Enums (exported so app code never re-types a literal union)                 */
/* -------------------------------------------------------------------------- */

export const USER_ROLES = ["super_admin", "admin", "owner", "cleaner"] as const;
export const VERTICALS = ["stay", "car"] as const;
export const PRICE_UNITS = ["per_night", "per_day", "per_month"] as const;
export const LISTING_STATUSES = ["draft", "published", "paused"] as const;
export const CANCELLATION_POLICIES = ["flexible", "moderate", "strict"] as const;
export const PROPERTY_TYPES = ["casa", "departamento", "habitacion", "otro"] as const;
export const VEHICLE_TYPES = ["auto", "camioneta", "suv", "moto", "otro"] as const;
export const BOOKING_STATUSES = [
  "inquiry",
  "confirmed",
  "active",
  "completed",
  "cancelled",
] as const;
export const BOOKING_SOURCES = ["web", "whatsapp", "manual"] as const;
export const BLOCK_REASONS = ["owner_use", "maintenance", "external_ical"] as const;
export const CLEANING_STATUSES = ["needed", "in_progress", "ready"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "done"] as const;
export const EXPENSE_CATEGORIES = [
  "cleaning",
  "supplies",
  "repair",
  "fuel",
  "other",
] as const;
export const PHOTO_SUBJECTS = ["cleaning_task", "maintenance_ticket", "inspection"] as const;
export const INSPECTION_TYPES = ["pickup", "return"] as const;
export const DEPOSIT_STATUSES = ["held", "returned", "deducted"] as const;
export const REMINDER_TYPES = ["service", "insurance", "registration"] as const;
export const REMINDER_STATUSES = ["upcoming", "due", "done"] as const;
export const DOCUMENT_TYPES = ["cedula", "passport", "license", "other"] as const;
export const DOCUMENT_STATUSES = ["pending", "verified", "rejected"] as const;
export const DISCOUNT_TYPES = ["percent", "fixed"] as const;
export const PAYMENT_STATUSES = ["pending", "paid", "expired"] as const;
export const SCHEDULED_MESSAGE_STATUSES = [
  "scheduled",
  "due",
  "sent",
  "cancelled",
] as const;
export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const MESSAGE_CHANNELS = ["whatsapp", "web"] as const;
export const LEAD_FORWARD_STATUSES = ["pending", "forwarded", "failed"] as const;
export const EXTRA_SCOPES = ["vertical", "listing"] as const;
export const ONBOARDING_STEP_STATUSES = ["pending", "done", "skipped"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type Vertical = (typeof VERTICALS)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type PriceUnit = (typeof PRICE_UNITS)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type CancellationPolicy = (typeof CANCELLATION_POLICIES)[number];
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export type BlockReason = (typeof BLOCK_REASONS)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type ExtraScope = (typeof EXTRA_SCOPES)[number];

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    /** null for `cleaner` rows — cleaners never log in (plan §2). */
    passwordHash: varchar("password_hash", { length: 255 }),
    role: mysqlEnum("role", USER_ROLES).notNull().default("owner"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("users_email_uq").on(t.email), index("users_role_idx").on(t.role)],
);

/** Owner profile — 1:1 with a `users` row whose role is `owner`. */
export const owners = mysqlTable(
  "owners",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    displayName: varchar("display_name", { length: 180 }).notNull(),
    ruc: varchar("ruc", { length: 40 }),
    /** Default commission % applied when a listing has no override. */
    defaultCommissionPct: decimal("default_commission_pct", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("20.00"),
    payoutNotes: text("payout_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("owners_user_uq").on(t.userId)],
);

/* -------------------------------------------------------------------------- */
/* Geography                                                                   */
/* -------------------------------------------------------------------------- */

/** Ciudad rows have `parentId` null; barrios point at their ciudad. */
export const locations = mysqlTable(
  "locations",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 140 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    parentId: int("parent_id"),
    department: varchar("department", { length: 140 }),
    lat: decimal("lat", { precision: 10, scale: 7 }),
    lng: decimal("lng", { precision: 10, scale: 7 }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("locations_slug_uq").on(t.slug),
    index("locations_parent_idx").on(t.parentId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Listings                                                                    */
/* -------------------------------------------------------------------------- */

export const listings = mysqlTable(
  "listings",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 200 }).notNull(),
    vertical: mysqlEnum("vertical", VERTICALS).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    description: text("description"),
    price: money("price").notNull(),
    priceUnit: mysqlEnum("price_unit", PRICE_UNITS).notNull().default("per_night"),
    currency: varchar("currency", { length: 3 }).notNull().default("PYG"),
    locationId: int("location_id"),
    lat: decimal("lat", { precision: 10, scale: 7 }),
    lng: decimal("lng", { precision: 10, scale: 7 }),
    status: mysqlEnum("status", LISTING_STATUSES).notNull().default("draft"),
    publishedAt: timestamp("published_at"),
    ownerId: int("owner_id").notNull(),
    /** Overrides `owners.default_commission_pct` when set. */
    commissionPct: decimal("commission_pct", { precision: 5, scale: 2 }),
    cancellationPolicy: mysqlEnum("cancellation_policy", CANCELLATION_POLICIES)
      .notNull()
      .default("moderate"),
    /** Token in the public iCal export URL `/api/ical/[token].ics` (#2). */
    icalExportToken: varchar("ical_export_token", { length: 64 }),
    updatedBy: int("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("listings_slug_uq").on(t.slug),
    unique("listings_ical_token_uq").on(t.icalExportToken),
    index("listings_owner_idx").on(t.ownerId),
    index("listings_vertical_status_idx").on(t.vertical, t.status),
    index("listings_location_idx").on(t.locationId),
  ],
);

export const stayDetails = mysqlTable(
  "stay_details",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    propertyType: mysqlEnum("property_type", PROPERTY_TYPES).notNull(),
    bedrooms: int("bedrooms"),
    bathrooms: int("bathrooms"),
    maxGuests: int("max_guests"),
    areaM2: int("area_m2"),
    amenities: json("amenities").$type<string[]>(),
    checkInTime: varchar("check_in_time", { length: 5 }).notNull().default("14:00"),
    checkOutTime: varchar("check_out_time", { length: 5 }).notNull().default("11:00"),
  },
  (t) => [unique("stay_details_listing_uq").on(t.listingId)],
);

export const carDetails = mysqlTable(
  "car_details",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    vehicleType: mysqlEnum("vehicle_type", VEHICLE_TYPES).notNull(),
    make: varchar("make", { length: 80 }),
    model: varchar("model", { length: 80 }),
    year: int("year"),
    transmission: varchar("transmission", { length: 40 }),
    fuel: varchar("fuel", { length: 40 }),
    seats: int("seats"),
    /** Private — never exposed on public pages. */
    plate: varchar("plate", { length: 20 }),
    dailyKmLimit: int("daily_km_limit"),
    insuranceTerms: text("insurance_terms"),
  },
  (t) => [unique("car_details_listing_uq").on(t.listingId)],
);

export const listingImages = mysqlTable(
  "listing_images",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    alt: varchar("alt", { length: 300 }),
    sortOrder: int("sort_order").notNull().default(0),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("listing_images_listing_idx").on(t.listingId, t.sortOrder)],
);

/** Per-listing knowledge base grounding the AI-drafted replies (O9). */
export const infoItems = mysqlTable(
  "info_items",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    question: varchar("question", { length: 300 }).notNull(),
    answer: text("answer").notNull(),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("info_items_listing_idx").on(t.listingId),
    unique("info_items_listing_question_uq").on(t.listingId, t.question),
  ],
);

/* -------------------------------------------------------------------------- */
/* Pricing modifiers                                                           */
/* -------------------------------------------------------------------------- */

export const extras = mysqlTable(
  "extras",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 140 }).notNull(),
    description: varchar("description", { length: 300 }),
    price: money("price").notNull(),
    /** `vertical` → applies to every listing of `vertical`; `listing` → one listing. */
    scope: mysqlEnum("scope", EXTRA_SCOPES).notNull().default("vertical"),
    vertical: mysqlEnum("vertical", VERTICALS),
    listingId: int("listing_id"),
    /** true → price multiplied by nights/days, false → flat per booking. */
    perUnit: boolean("per_unit").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("extras_scope_idx").on(t.scope, t.vertical, t.listingId)],
);

export const promoCodes = mysqlTable(
  "promo_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull(),
    discountType: mysqlEnum("discount_type", DISCOUNT_TYPES).notNull(),
    /** percent → 0-100; fixed → currency amount. */
    discountValue: money("discount_value").notNull(),
    validFrom: datetime("valid_from"),
    validUntil: datetime("valid_until"),
    maxUses: int("max_uses"),
    usedCount: int("used_count").notNull().default(0),
    vertical: mysqlEnum("vertical", VERTICALS),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("promo_codes_code_uq").on(t.code)],
);

/* -------------------------------------------------------------------------- */
/* Bookings & availability                                                     */
/* -------------------------------------------------------------------------- */

export const bookings = mysqlTable(
  "bookings",
  {
    id: int("id").autoincrement().primaryKey(),
    reference: varchar("reference", { length: 24 }).notNull(),
    listingId: int("listing_id").notNull(),
    guestName: varchar("guest_name", { length: 180 }).notNull(),
    guestPhone: varchar("guest_phone", { length: 40 }),
    guestEmail: varchar("guest_email", { length: 255 }),
    /** UTC. Stays carry the listing's check-in/check-out clock time. */
    startAt: datetime("start_at").notNull(),
    endAt: datetime("end_at").notNull(),
    status: mysqlEnum("status", BOOKING_STATUSES).notNull().default("inquiry"),
    /** Price snapshot — never recomputed from the listing after creation. */
    unitPrice: money("unit_price").notNull().default("0"),
    units: int("units").notNull().default(1),
    baseTotal: money("base_total").notNull().default("0"),
    extrasTotal: money("extras_total").notNull().default("0"),
    discountTotal: money("discount_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("PYG"),
    /** Commission % snapshot resolved at confirmation (listing → owner default). */
    commissionPct: decimal("commission_pct", { precision: 5, scale: 2 }),
    commissionAmount: money("commission_amount"),
    source: mysqlEnum("source", BOOKING_SOURCES).notNull().default("web"),
    promoCodeId: int("promo_code_id"),
    cancellationPolicy: mysqlEnum("cancellation_policy", CANCELLATION_POLICIES),
    notes: text("notes"),
    guestCount: int("guest_count"),
    createdBy: int("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("bookings_reference_uq").on(t.reference),
    index("bookings_listing_range_idx").on(t.listingId, t.startAt, t.endAt),
    index("bookings_status_idx").on(t.status),
  ],
);

export const bookingExtras = mysqlTable(
  "booking_extras",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id").notNull(),
    extraId: int("extra_id").notNull(),
    /** Name/price snapshot so later edits to `extras` never rewrite history. */
    nameSnapshot: varchar("name_snapshot", { length: 140 }).notNull(),
    unitPrice: money("unit_price").notNull(),
    qty: int("qty").notNull().default(1),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [index("booking_extras_booking_idx").on(t.bookingId)],
);

export const availabilityBlocks = mysqlTable(
  "availability_blocks",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    startAt: datetime("start_at").notNull(),
    endAt: datetime("end_at").notNull(),
    reason: mysqlEnum("reason", BLOCK_REASONS).notNull().default("owner_use"),
    /** iCal UID for `external_ical` rows; free-form ref otherwise. */
    sourceRef: varchar("source_ref", { length: 255 }),
    icalSourceId: int("ical_source_id"),
    note: varchar("note", { length: 300 }),
    createdBy: int("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("availability_blocks_listing_range_idx").on(t.listingId, t.startAt, t.endAt),
    unique("availability_blocks_source_uq").on(t.icalSourceId, t.sourceRef),
  ],
);

export const icalSources = mysqlTable(
  "ical_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    url: varchar("url", { length: 700 }).notNull(),
    label: varchar("label", { length: 120 }),
    lastSyncedAt: timestamp("last_synced_at"),
    lastStatus: varchar("last_status", { length: 255 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ical_sources_listing_idx").on(t.listingId)],
);

/* -------------------------------------------------------------------------- */
/* Ground operations                                                           */
/* -------------------------------------------------------------------------- */

export const cleaningTasks = mysqlTable(
  "cleaning_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    bookingId: int("booking_id"),
    status: mysqlEnum("status", CLEANING_STATUSES).notNull().default("needed"),
    assignedUserId: int("assigned_user_id"),
    dueBy: datetime("due_by"),
    /** Magic-link token — the cleaner's only credential (plan §2). */
    magicToken: varchar("magic_token", { length: 64 }).notNull(),
    checklist: json("checklist").$type<{ key: string; label: string; done: boolean }[]>(),
    notes: text("notes"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("cleaning_tasks_token_uq").on(t.magicToken),
    index("cleaning_tasks_listing_idx").on(t.listingId),
    index("cleaning_tasks_assignee_due_idx").on(t.assignedUserId, t.dueBy),
    index("cleaning_tasks_status_idx").on(t.status),
  ],
);

/** Polymorphic photo store for cleaning tasks, tickets and inspections. */
export const taskPhotos = mysqlTable(
  "task_photos",
  {
    id: int("id").autoincrement().primaryKey(),
    subjectType: mysqlEnum("subject_type", PHOTO_SUBJECTS).notNull(),
    subjectId: int("subject_id").notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    caption: varchar("caption", { length: 300 }),
    uploadedBy: int("uploaded_by"),
    createdAt: createdAt(),
  },
  (t) => [index("task_photos_subject_idx").on(t.subjectType, t.subjectId)],
);

export const maintenanceTickets = mysqlTable(
  "maintenance_tickets",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    reportedBy: int("reported_by"),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", TICKET_STATUSES).notNull().default("open"),
    assignedUserId: int("assigned_user_id"),
    cost: money("cost"),
    inspectionId: int("inspection_id"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_tickets_listing_idx").on(t.listingId),
    index("maintenance_tickets_status_idx").on(t.status),
  ],
);

export const expenses = mysqlTable(
  "expenses",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    category: mysqlEnum("category", EXPENSE_CATEGORIES).notNull().default("other"),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("PYG"),
    incurredOn: date("incurred_on", { mode: "string" }).notNull(),
    description: varchar("description", { length: 300 }),
    maintenanceTicketId: int("maintenance_ticket_id"),
    cleaningTaskId: int("cleaning_task_id"),
    /** Set once the expense has been billed on an owner statement (#3). */
    statementId: int("statement_id"),
    createdBy: int("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("expenses_listing_date_idx").on(t.listingId, t.incurredOn),
    unique("expenses_ticket_uq").on(t.maintenanceTicketId),
  ],
);

export const supplies = mysqlTable(
  "supplies",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 140 }).notNull(),
    unit: varchar("unit", { length: 40 }).notNull().default("unidad"),
    /** How many units one cleaning task consumes (auto-decrement hook, O6). */
    consumedPerCleaning: int("consumed_per_cleaning").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique("supplies_name_uq").on(t.name)],
);

export const supplyLevels = mysqlTable(
  "supply_levels",
  {
    id: int("id").autoincrement().primaryKey(),
    supplyId: int("supply_id").notNull(),
    listingId: int("listing_id").notNull(),
    qty: int("qty").notNull().default(0),
    lowThreshold: int("low_threshold").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [unique("supply_levels_uq").on(t.supplyId, t.listingId)],
);

/* -------------------------------------------------------------------------- */
/* Autos protection                                                            */
/* -------------------------------------------------------------------------- */

export const inspections = mysqlTable(
  "inspections",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id").notNull(),
    type: mysqlEnum("type", INSPECTION_TYPES).notNull(),
    odometer: int("odometer"),
    /** 0-100 %, or eighths converted to % by the UI. */
    fuelLevel: int("fuel_level"),
    notes: text("notes"),
    damageFlag: boolean("damage_flag").notNull().default(false),
    confirmedByGuest: boolean("confirmed_by_guest").notNull().default(false),
    performedBy: int("performed_by"),
    performedAt: timestamp("performed_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("inspections_booking_type_uq").on(t.bookingId, t.type)],
);

export const deposits = mysqlTable(
  "deposits",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id").notNull(),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("PYG"),
    status: mysqlEnum("status", DEPOSIT_STATUSES).notNull().default("held"),
    deductionAmount: money("deduction_amount"),
    deductionReason: text("deduction_reason"),
    inspectionId: int("inspection_id"),
    maintenanceTicketId: int("maintenance_ticket_id"),
    settledBy: int("settled_by"),
    settledAt: timestamp("settled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("deposits_booking_uq").on(t.bookingId)],
);

export const vehicleReminders = mysqlTable(
  "vehicle_reminders",
  {
    id: int("id").autoincrement().primaryKey(),
    listingId: int("listing_id").notNull(),
    type: mysqlEnum("type", REMINDER_TYPES).notNull(),
    label: varchar("label", { length: 160 }),
    dueDate: date("due_date", { mode: "string" }),
    dueKm: int("due_km"),
    status: mysqlEnum("status", REMINDER_STATUSES).notNull().default("upcoming"),
    completedAt: timestamp("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("vehicle_reminders_listing_idx").on(t.listingId, t.status)],
);

export const bookingDocuments = mysqlTable(
  "booking_documents",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id").notNull(),
    type: mysqlEnum("type", DOCUMENT_TYPES).notNull(),
    fileUrl: varchar("file_url", { length: 500 }).notNull(),
    status: mysqlEnum("status", DOCUMENT_STATUSES).notNull().default("pending"),
    reviewedBy: int("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    rejectionReason: varchar("rejection_reason", { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [index("booking_documents_booking_idx").on(t.bookingId, t.status)],
);

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

export const paymentLinks = mysqlTable(
  "payment_links",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id").notNull(),
    /** Free-form provider label — "Bancard", "QR Tigo Money", ... (#8). */
    provider: varchar("provider", { length: 80 }).notNull(),
    url: varchar("url", { length: 700 }),
    reference: varchar("reference", { length: 160 }),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("PYG"),
    status: mysqlEnum("status", PAYMENT_STATUSES).notNull().default("pending"),
    expiresAt: datetime("expires_at"),
    markedPaidBy: int("marked_paid_by"),
    markedPaidAt: timestamp("marked_paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_links_booking_idx").on(t.bookingId, t.status)],
);

export const ownerStatements = mysqlTable(
  "owner_statements",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("owner_id").notNull(),
    /** `YYYY-MM` — one statement per owner per month (idempotent generation). */
    period: varchar("period", { length: 7 }).notNull(),
    grossTotal: money("gross_total").notNull().default("0"),
    commissionTotal: money("commission_total").notNull().default("0"),
    expensesTotal: money("expenses_total").notNull().default("0"),
    netTotal: money("net_total").notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("PYG"),
    bookingCount: int("booking_count").notNull().default(0),
    htmlRef: varchar("html_ref", { length: 500 }),
    pdfRef: varchar("pdf_ref", { length: 500 }),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("owner_statements_period_uq").on(t.ownerId, t.period)],
);

/* -------------------------------------------------------------------------- */
/* Communication                                                               */
/* -------------------------------------------------------------------------- */

export const messageTemplates = mysqlTable(
  "message_templates",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Stable key: `booking_confirmed`, `pre_arrival`, `review_request`, ... */
    key: varchar("key", { length: 80 }).notNull(),
    locale: varchar("locale", { length: 5 }).notNull().default("es"),
    label: varchar("label", { length: 160 }).notNull(),
    body: text("body").notNull(),
    /** Booking event this template fires on, plus its offset. */
    triggerEvent: varchar("trigger_event", { length: 60 }),
    offsetMinutes: int("offset_minutes").notNull().default(0),
    vertical: mysqlEnum("vertical", VERTICALS),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("message_templates_key_locale_uq").on(t.key, t.locale)],
);

export const scheduledMessages = mysqlTable(
  "scheduled_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id").notNull(),
    templateId: int("template_id"),
    templateKey: varchar("template_key", { length: 80 }).notNull(),
    sendAfter: datetime("send_after").notNull(),
    status: mysqlEnum("status", SCHEDULED_MESSAGE_STATUSES)
      .notNull()
      .default("scheduled"),
    /** Rendered at enqueue time so the outbox never re-renders stale data. */
    renderedBody: text("rendered_body"),
    channel: mysqlEnum("channel", MESSAGE_CHANNELS).notNull().default("whatsapp"),
    sentBy: int("sent_by"),
    sentAt: timestamp("sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("scheduled_messages_booking_template_uq").on(t.bookingId, t.templateKey),
    index("scheduled_messages_due_idx").on(t.status, t.sendAfter),
  ],
);

export const messages = mysqlTable(
  "messages",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("booking_id"),
    listingId: int("listing_id"),
    direction: mysqlEnum("direction", MESSAGE_DIRECTIONS).notNull(),
    channel: mysqlEnum("channel", MESSAGE_CHANNELS).notNull().default("whatsapp"),
    contactName: varchar("contact_name", { length: 180 }),
    contactPhone: varchar("contact_phone", { length: 40 }),
    body: text("body").notNull(),
    /** true when the body came from the AI draft action and a human approved it. */
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    loggedBy: int("logged_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_booking_idx").on(t.bookingId, t.createdAt),
    index("messages_listing_idx").on(t.listingId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Growth & audit                                                              */
/* -------------------------------------------------------------------------- */

export const ownerOnboarding = mysqlTable(
  "owner_onboarding",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("owner_id").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    updatedAt: updatedAt(),
  },
  (t) => [unique("owner_onboarding_owner_uq").on(t.ownerId)],
);

export const onboardingSteps = mysqlTable(
  "onboarding_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    onboardingId: int("onboarding_id").notNull(),
    /** `contract`, `photos`, `info_base`, `ical`, `first_listing_published`. */
    stepKey: varchar("step_key", { length: 60 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    status: mysqlEnum("status", ONBOARDING_STEP_STATUSES).notNull().default("pending"),
    sortOrder: int("sort_order").notNull().default(0),
    completedBy: int("completed_by"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [unique("onboarding_steps_uq").on(t.onboardingId, t.stepKey)],
);

export const leads = mysqlTable(
  "leads",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 255 }),
    message: text("message"),
    vertical: mysqlEnum("vertical", VERTICALS),
    listingId: int("listing_id"),
    bookingId: int("booking_id"),
    sourceUrl: varchar("source_url", { length: 500 }),
    /** Stored first, forwarded second — a CRM outage never loses a lead. */
    forwardStatus: mysqlEnum("forward_status", LEAD_FORWARD_STATUSES)
      .notNull()
      .default("pending"),
    forwardedAt: timestamp("forwarded_at"),
    forwardError: varchar("forward_error", { length: 500 }),
    crmContactId: varchar("crm_contact_id", { length: 80 }),
    crmDealId: varchar("crm_deal_id", { length: 80 }),
    createdAt: createdAt(),
  },
  (t) => [index("leads_forward_idx").on(t.forwardStatus, t.createdAt)],
);

export const activityLog = mysqlTable(
  "activity_log",
  {
    id: int("id").autoincrement().primaryKey(),
    entity: varchar("entity", { length: 60 }).notNull(),
    entityId: int("entity_id"),
    action: varchar("action", { length: 80 }).notNull(),
    userId: int("user_id"),
    meta: json("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_log_entity_idx").on(t.entity, t.entityId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Relations (query-layer convenience only — no FKs are declared so that       */
/* migrations stay reorderable on Hostinger's MySQL)                           */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ one, many }) => ({
  ownerProfile: one(owners, { fields: [users.id], references: [owners.userId] }),
  assignedTasks: many(cleaningTasks),
}));

export const ownersRelations = relations(owners, ({ one, many }) => ({
  user: one(users, { fields: [owners.userId], references: [users.id] }),
  listings: many(listings),
  statements: many(ownerStatements),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  parent: one(locations, {
    fields: [locations.parentId],
    references: [locations.id],
    relationName: "location_parent",
  }),
  children: many(locations, { relationName: "location_parent" }),
  listings: many(listings),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  owner: one(owners, { fields: [listings.ownerId], references: [owners.id] }),
  location: one(locations, {
    fields: [listings.locationId],
    references: [locations.id],
  }),
  stay: one(stayDetails, {
    fields: [listings.id],
    references: [stayDetails.listingId],
  }),
  car: one(carDetails, { fields: [listings.id], references: [carDetails.listingId] }),
  images: many(listingImages),
  infoItems: many(infoItems),
  bookings: many(bookings),
  blocks: many(availabilityBlocks),
  icalSources: many(icalSources),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  listing: one(listings, { fields: [bookings.listingId], references: [listings.id] }),
  promoCode: one(promoCodes, {
    fields: [bookings.promoCodeId],
    references: [promoCodes.id],
  }),
  extras: many(bookingExtras),
  documents: many(bookingDocuments),
  inspections: many(inspections),
  deposit: one(deposits, { fields: [bookings.id], references: [deposits.bookingId] }),
  paymentLinks: many(paymentLinks),
  messages: many(messages),
  scheduledMessages: many(scheduledMessages),
  cleaningTasks: many(cleaningTasks),
}));

export const cleaningTasksRelations = relations(cleaningTasks, ({ one }) => ({
  listing: one(listings, {
    fields: [cleaningTasks.listingId],
    references: [listings.id],
  }),
  booking: one(bookings, {
    fields: [cleaningTasks.bookingId],
    references: [bookings.id],
  }),
  assignee: one(users, {
    fields: [cleaningTasks.assignedUserId],
    references: [users.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  listing: one(listings, { fields: [expenses.listingId], references: [listings.id] }),
  ticket: one(maintenanceTickets, {
    fields: [expenses.maintenanceTicketId],
    references: [maintenanceTickets.id],
  }),
}));

export const ownerOnboardingRelations = relations(ownerOnboarding, ({ one, many }) => ({
  owner: one(owners, { fields: [ownerOnboarding.ownerId], references: [owners.id] }),
  steps: many(onboardingSteps),
}));

export const onboardingStepsRelations = relations(onboardingSteps, ({ one }) => ({
  onboarding: one(ownerOnboarding, {
    fields: [onboardingSteps.onboardingId],
    references: [ownerOnboarding.id],
  }),
}));
