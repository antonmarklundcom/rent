/**
 * Idempotent seed for local + staging (plan §5.O12 seed spec).
 *
 * Re-running must never duplicate rows: every insert upserts on a unique key
 * (email, slug, code, reference, token). Later phases verify against exactly
 * this data set, so change it additively rather than reshaping it.
 *
 *   npm run seed
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { closePool, db } from "../src/db";
import {
  availabilityBlocks,
  bookingExtras,
  bookings,
  carDetails,
  cleaningTasks,
  deposits,
  expenses,
  extras,
  icalSources,
  infoItems,
  inspections,
  leads,
  listingImages,
  listings,
  locations,
  maintenanceTickets,
  messageTemplates,
  messages,
  onboardingSteps,
  ownerOnboarding,
  owners,
  paymentLinks,
  promoCodes,
  stayDetails,
  supplies,
  supplyLevels,
  users,
  vehicleReminders,
} from "../src/db/schema";

import { computeCommission, resolveCommissionPct } from "../src/lib/pricing";

const BCRYPT_ROUNDS = 10;
const DEFAULT_PASSWORD = "Alquilar2026!";

/** Fixed clock so seeded date ranges stay deterministic relative to today. */
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const day = (offset: number, hour = 14) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function upsertUser(input: {
  name: string;
  email: string;
  phone?: string;
  role: "super_admin" | "admin" | "owner" | "cleaner";
  password?: string;
}) {
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    : null;
  await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      passwordHash,
      isActive: true,
    })
    .onDuplicateKeyUpdate({
      set: {
        name: input.name,
        phone: input.phone,
        role: input.role,
        isActive: true,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
  const [row] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  return row!;
}

async function upsertOwner(userId: number, displayName: string, commission: string) {
  await db
    .insert(owners)
    .values({ userId, displayName, defaultCommissionPct: commission })
    .onDuplicateKeyUpdate({
      set: { displayName, defaultCommissionPct: commission },
    });
  const [row] = await db.select().from(owners).where(eq(owners.userId, userId)).limit(1);
  return row!;
}

async function upsertLocation(input: {
  name: string;
  slug: string;
  parentId?: number;
  department?: string;
}) {
  await db
    .insert(locations)
    .values(input)
    .onDuplicateKeyUpdate({
      set: { name: input.name, parentId: input.parentId, department: input.department },
    });
  const [row] = await db
    .select()
    .from(locations)
    .where(eq(locations.slug, input.slug))
    .limit(1);
  return row!;
}

async function upsertListing(input: {
  slug: string;
  vertical: "stay" | "car";
  title: string;
  description: string;
  price: string;
  priceUnit: "per_night" | "per_day" | "per_month";
  ownerId: number;
  locationId: number;
  status?: "draft" | "published" | "paused";
  commissionPct?: string | null;
  cancellationPolicy?: "flexible" | "moderate" | "strict";
}) {
  const status = input.status ?? "published";
  await db
    .insert(listings)
    .values({
      slug: input.slug,
      vertical: input.vertical,
      title: input.title,
      description: input.description,
      price: input.price,
      priceUnit: input.priceUnit,
      ownerId: input.ownerId,
      locationId: input.locationId,
      status,
      publishedAt: status === "published" ? day(-30, 12) : null,
      commissionPct: input.commissionPct ?? null,
      cancellationPolicy: input.cancellationPolicy ?? "moderate",
      icalExportToken: `seed-ical-${input.slug}`.slice(0, 64),
    })
    .onDuplicateKeyUpdate({
      set: {
        title: input.title,
        description: input.description,
        price: input.price,
        priceUnit: input.priceUnit,
        ownerId: input.ownerId,
        locationId: input.locationId,
        status,
        commissionPct: input.commissionPct ?? null,
        cancellationPolicy: input.cancellationPolicy ?? "moderate",
      },
    });
  const [row] = await db
    .select()
    .from(listings)
    .where(eq(listings.slug, input.slug))
    .limit(1);
  return row!;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
  }

  /* ---------------------------------------------------------------- people */
  const superAdmin = await upsertUser({
    name: process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin",
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@alquilar.com.py",
    role: "super_admin",
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? DEFAULT_PASSWORD,
    phone: "+595981000001",
  });

  const admin = await upsertUser({
    name: "Lucía Benítez",
    email: "ops@alquilar.com.py",
    role: "admin",
    password: DEFAULT_PASSWORD,
    phone: "+595981000002",
  });

  // Owner A owns BOTH a casa and an auto — proving one account covers both
  // verticals with no extra role (plan §2).
  const ownerAUser = await upsertUser({
    name: "Marta Gómez",
    email: "marta@example.com",
    role: "owner",
    password: DEFAULT_PASSWORD,
    phone: "+595981111111",
  });
  const ownerBUser = await upsertUser({
    name: "Rodrigo Ayala",
    email: "rodrigo@example.com",
    role: "owner",
    password: DEFAULT_PASSWORD,
    phone: "+595982222222",
  });
  const cleaner = await upsertUser({
    name: "Sofía Cabrera",
    email: "sofia.limpieza@example.com",
    role: "cleaner",
    phone: "+595983333333",
  });

  const ownerA = await upsertOwner(ownerAUser.id, "Marta Gómez", "20.00");
  const ownerB = await upsertOwner(ownerBUser.id, "Ayala Rentals", "15.00");

  /* ------------------------------------------------------------- locations */
  const asuncion = await upsertLocation({
    name: "Asunción",
    slug: "asuncion",
    department: "Central",
  });
  const villaMorra = await upsertLocation({
    name: "Villa Morra",
    slug: "asuncion-villa-morra",
    parentId: asuncion.id,
    department: "Central",
  });
  const carmelitas = await upsertLocation({
    name: "Carmelitas",
    slug: "asuncion-carmelitas",
    parentId: asuncion.id,
    department: "Central",
  });
  const encarnacion = await upsertLocation({
    name: "Encarnación",
    slug: "encarnacion",
    department: "Itapúa",
  });
  const sanIsidro = await upsertLocation({
    name: "San Isidro",
    slug: "encarnacion-san-isidro",
    parentId: encarnacion.id,
    department: "Itapúa",
  });
  const cde = await upsertLocation({
    name: "Ciudad del Este",
    slug: "ciudad-del-este",
    department: "Alto Paraná",
  });
  const area1 = await upsertLocation({
    name: "Área 1",
    slug: "ciudad-del-este-area-1",
    parentId: cde.id,
    department: "Alto Paraná",
  });

  /* -------------------------------------------------------------- listings */
  const staySeeds = [
    {
      slug: "casa-con-piscina-villa-morra",
      title: "Casa con piscina en Villa Morra",
      propertyType: "casa" as const,
      ownerId: ownerA.id,
      locationId: villaMorra.id,
      price: "650000.00",
      bedrooms: 3,
      bathrooms: 2,
      maxGuests: 6,
      areaM2: 210,
    },
    {
      slug: "departamento-moderno-carmelitas",
      title: "Departamento moderno en Carmelitas",
      propertyType: "departamento" as const,
      ownerId: ownerA.id,
      locationId: carmelitas.id,
      price: "420000.00",
      // One listing carries an explicit rate so the "listing override → owner
      // default" resolution in `src/lib/pricing.ts` has a live fixture (#3).
      commissionPct: "25.00",
      bedrooms: 2,
      bathrooms: 1,
      maxGuests: 4,
      areaM2: 78,
    },
    {
      slug: "monoambiente-centro-asuncion",
      title: "Monoambiente en el centro de Asunción",
      propertyType: "departamento" as const,
      ownerId: ownerA.id,
      locationId: asuncion.id,
      price: "260000.00",
      bedrooms: 1,
      bathrooms: 1,
      maxGuests: 2,
      areaM2: 40,
    },
    {
      slug: "habitacion-privada-villa-morra",
      title: "Habitación privada en Villa Morra",
      propertyType: "habitacion" as const,
      ownerId: ownerA.id,
      locationId: villaMorra.id,
      price: "150000.00",
      bedrooms: 1,
      bathrooms: 1,
      maxGuests: 2,
      areaM2: 22,
      status: "paused" as const,
    },
    {
      slug: "casa-frente-al-lago-encarnacion",
      title: "Casa frente al lago en Encarnación",
      propertyType: "casa" as const,
      ownerId: ownerB.id,
      locationId: sanIsidro.id,
      price: "580000.00",
      bedrooms: 4,
      bathrooms: 3,
      maxGuests: 8,
      areaM2: 260,
    },
    {
      slug: "departamento-costanera-encarnacion",
      title: "Departamento sobre la costanera",
      propertyType: "departamento" as const,
      ownerId: ownerB.id,
      locationId: encarnacion.id,
      price: "390000.00",
      bedrooms: 2,
      bathrooms: 2,
      maxGuests: 4,
      areaM2: 95,
    },
    {
      slug: "departamento-area-1-cde",
      title: "Departamento en Área 1, Ciudad del Este",
      propertyType: "departamento" as const,
      ownerId: ownerB.id,
      locationId: area1.id,
      price: "350000.00",
      bedrooms: 2,
      bathrooms: 1,
      maxGuests: 4,
      areaM2: 70,
    },
    {
      slug: "casa-familiar-ciudad-del-este",
      title: "Casa familiar en Ciudad del Este",
      propertyType: "casa" as const,
      ownerId: ownerB.id,
      locationId: cde.id,
      price: "500000.00",
      bedrooms: 3,
      bathrooms: 2,
      maxGuests: 6,
      areaM2: 180,
      status: "draft" as const,
    },
  ];

  const stayRows = [];
  for (const seed of staySeeds) {
    const listing = await upsertListing({
      slug: seed.slug,
      vertical: "stay",
      title: seed.title,
      description: `${seed.title}. Administrado por alquilar.com.py.`,
      price: seed.price,
      priceUnit: "per_night",
      ownerId: seed.ownerId,
      locationId: seed.locationId,
      status: seed.status ?? "published",
      commissionPct: seed.commissionPct ?? null,
    });
    await db
      .insert(stayDetails)
      .values({
        listingId: listing.id,
        propertyType: seed.propertyType,
        bedrooms: seed.bedrooms,
        bathrooms: seed.bathrooms,
        maxGuests: seed.maxGuests,
        areaM2: seed.areaM2,
        amenities: ["wifi", "aire_acondicionado", "cocina"],
      })
      .onDuplicateKeyUpdate({
        set: {
          propertyType: seed.propertyType,
          bedrooms: seed.bedrooms,
          bathrooms: seed.bathrooms,
          maxGuests: seed.maxGuests,
          areaM2: seed.areaM2,
        },
      });
    stayRows.push(listing);
  }

  const carSeeds = [
    {
      slug: "toyota-corolla-2021-asuncion",
      title: "Toyota Corolla 2021 — Asunción",
      vehicleType: "auto" as const,
      ownerId: ownerA.id,
      locationId: asuncion.id,
      price: "280000.00",
      make: "Toyota",
      model: "Corolla",
      year: 2021,
      transmission: "automatica",
      fuel: "nafta",
      seats: 5,
      plate: "ABC123",
    },
    {
      slug: "toyota-hilux-2020-asuncion",
      title: "Toyota Hilux 2020 — Asunción",
      vehicleType: "camioneta" as const,
      ownerId: ownerA.id,
      locationId: villaMorra.id,
      price: "450000.00",
      make: "Toyota",
      model: "Hilux",
      year: 2020,
      transmission: "manual",
      fuel: "diesel",
      seats: 5,
      plate: "BCD234",
    },
    {
      slug: "honda-cbr-150-asuncion",
      title: "Honda CBR 150 — Asunción",
      vehicleType: "moto" as const,
      ownerId: ownerA.id,
      locationId: carmelitas.id,
      price: "90000.00",
      make: "Honda",
      model: "CBR 150",
      year: 2022,
      transmission: "manual",
      fuel: "nafta",
      seats: 2,
      plate: "CDE345",
    },
    {
      slug: "chevrolet-onix-2022-encarnacion",
      title: "Chevrolet Onix 2022 — Encarnación",
      vehicleType: "auto" as const,
      ownerId: ownerB.id,
      locationId: encarnacion.id,
      price: "250000.00",
      make: "Chevrolet",
      model: "Onix",
      year: 2022,
      transmission: "manual",
      fuel: "nafta",
      seats: 5,
      plate: "DEF456",
    },
    {
      slug: "jeep-renegade-2021-cde",
      title: "Jeep Renegade 2021 — Ciudad del Este",
      vehicleType: "suv" as const,
      ownerId: ownerB.id,
      locationId: cde.id,
      price: "420000.00",
      make: "Jeep",
      model: "Renegade",
      year: 2021,
      transmission: "automatica",
      fuel: "nafta",
      seats: 5,
      plate: "EFG567",
    },
    {
      slug: "kia-sportage-2019-cde",
      title: "Kia Sportage 2019 — Ciudad del Este",
      vehicleType: "suv" as const,
      ownerId: ownerB.id,
      locationId: area1.id,
      price: "400000.00",
      make: "Kia",
      model: "Sportage",
      year: 2019,
      transmission: "automatica",
      fuel: "diesel",
      seats: 5,
      plate: "FGH678",
      status: "paused" as const,
    },
  ];

  const carRows = [];
  for (const seed of carSeeds) {
    const listing = await upsertListing({
      slug: seed.slug,
      vertical: "car",
      title: seed.title,
      description: `${seed.title}. Alquiler con seguro incluido.`,
      price: seed.price,
      priceUnit: "per_day",
      ownerId: seed.ownerId,
      locationId: seed.locationId,
      status: seed.status ?? "published",
      cancellationPolicy: "strict",
    });
    await db
      .insert(carDetails)
      .values({
        listingId: listing.id,
        vehicleType: seed.vehicleType,
        make: seed.make,
        model: seed.model,
        year: seed.year,
        transmission: seed.transmission,
        fuel: seed.fuel,
        seats: seed.seats,
        plate: seed.plate,
        dailyKmLimit: 250,
        insuranceTerms: "Seguro contra terceros incluido. Franquicia Gs. 2.000.000.",
      })
      .onDuplicateKeyUpdate({
        set: {
          vehicleType: seed.vehicleType,
          make: seed.make,
          model: seed.model,
          year: seed.year,
          transmission: seed.transmission,
          fuel: seed.fuel,
          seats: seed.seats,
          plate: seed.plate,
        },
      });
    carRows.push(listing);
  }

  /* ------------------------------------------------------ images + info base */
  for (const listing of [...stayRows, ...carRows]) {
    await db
      .insert(listingImages)
      .values({
        listingId: listing.id,
        url: `/images/placeholder-${listing.vertical}.jpg`,
        alt: listing.title,
        sortOrder: 0,
        isCover: true,
      })
      .onDuplicateKeyUpdate({ set: { alt: listing.title } });
  }

  for (const listing of stayRows.slice(0, 3)) {
    await db
      .insert(infoItems)
      .values([
        {
          listingId: listing.id,
          question: "¿A qué hora es el check-in?",
          answer: "El check-in es a partir de las 14:00 y el check-out hasta las 11:00.",
          sortOrder: 0,
        },
        {
          listingId: listing.id,
          question: "¿Hay wifi?",
          answer: "Sí, wifi de fibra óptica incluido sin costo adicional.",
          sortOrder: 1,
        },
      ])
      .onDuplicateKeyUpdate({ set: { sortOrder: sql`sort_order` } });
  }

  /* ---------------------------------------------------- extras + promo codes */
  const extraSeeds = [
    { name: "Check-out tardío", price: "100000.00", scope: "vertical" as const, vertical: "stay" as const, perUnit: false },
    { name: "Traslado aeropuerto", price: "180000.00", scope: "vertical" as const, vertical: "stay" as const, perUnit: false },
    { name: "Silla de bebé", price: "35000.00", scope: "vertical" as const, vertical: "car" as const, perUnit: true },
    { name: "GPS", price: "25000.00", scope: "vertical" as const, vertical: "car" as const, perUnit: true },
  ];
  for (const extra of extraSeeds) {
    const [existing] = await db
      .select()
      .from(extras)
      .where(eq(extras.name, extra.name))
      .limit(1);
    if (existing) {
      await db.update(extras).set(extra).where(eq(extras.id, existing.id));
    } else {
      await db.insert(extras).values(extra);
    }
  }

  await db
    .insert(promoCodes)
    .values([
      {
        code: "BIENVENIDA10",
        discountType: "percent",
        discountValue: "10.00",
        validFrom: day(-60),
        validUntil: day(180),
        maxUses: 100,
      },
      {
        code: "VERANO50K",
        discountType: "fixed",
        discountValue: "50000.00",
        validFrom: day(-30),
        validUntil: day(90),
        maxUses: 50,
        vertical: "stay",
      },
    ])
    .onDuplicateKeyUpdate({ set: { isActive: true } });

  /* -------------------------------------------------------------- bookings */
  const casa = stayRows[0]!;
  const depto = stayRows[1]!;
  const lago = stayRows[4]!;
  const corolla = carRows[0]!;
  const onix = carRows[3]!;

  /* ---------------------------------------------------- iCal source (#2) */
  // Inactive on purpose: a seeded feed URL would make `npm run sync:ical`
  // fail against the public internet on every demo run. Flip `is_active`
  // once a real Airbnb/Booking export URL is pasted in.
  const [existingIcalSource] = await db
    .select()
    .from(icalSources)
    .where(eq(icalSources.listingId, casa.id))
    .limit(1);
  if (!existingIcalSource) {
    await db.insert(icalSources).values({
      listingId: casa.id,
      url: "https://www.airbnb.com/calendar/ical/EXAMPLE.ics?s=REEMPLAZAR",
      label: "Airbnb (ejemplo)",
      isActive: false,
    });
  }


  const bookingSeeds = [
    {
      reference: "ALQ-SEED01",
      listing: casa,
      guestName: "Julián Rojas",
      guestPhone: "+595984000001",
      status: "completed" as const,
      start: day(-14),
      end: day(-11, 11),
      units: 3,
      unitPrice: casa.price,
    },
    {
      reference: "ALQ-SEED02",
      listing: casa,
      guestName: "Ana Villalba",
      guestPhone: "+595984000002",
      status: "confirmed" as const,
      start: day(10),
      end: day(14, 11),
      units: 4,
      unitPrice: casa.price,
    },
    {
      reference: "ALQ-SEED03",
      listing: depto,
      guestName: "Pedro Duarte",
      guestPhone: "+595984000003",
      status: "active" as const,
      start: day(-1),
      end: day(2, 11),
      units: 3,
      unitPrice: depto.price,
    },
    {
      reference: "ALQ-SEED04",
      listing: lago,
      guestName: "Carla Ramírez",
      guestPhone: "+595984000004",
      status: "inquiry" as const,
      start: day(20),
      end: day(25, 11),
      units: 5,
      unitPrice: lago.price,
    },
    {
      reference: "ALQ-SEED05",
      listing: depto,
      guestName: "Nicolás Franco",
      guestPhone: "+595984000005",
      status: "cancelled" as const,
      start: day(5),
      end: day(8, 11),
      units: 3,
      unitPrice: depto.price,
    },
    {
      reference: "ALQ-SEED06",
      listing: corolla,
      guestName: "Diego Espínola",
      guestPhone: "+595984000006",
      status: "confirmed" as const,
      start: day(3, 9),
      end: day(6, 9),
      units: 3,
      unitPrice: corolla.price,
    },
    {
      reference: "ALQ-SEED07",
      listing: onix,
      guestName: "Valeria Ortiz",
      guestPhone: "+595984000007",
      status: "completed" as const,
      start: day(-20, 9),
      end: day(-17, 9),
      units: 3,
      unitPrice: onix.price,
    },
  ];

  const bookingRows: Record<string, typeof bookings.$inferSelect> = {};
  const ownerDefaults = new Map<number, string>([
    [ownerA.id, "20.00"],
    [ownerB.id, "15.00"],
  ]);
  for (const seed of bookingSeeds) {
    const baseTotal = (Number(seed.unitPrice) * seed.units).toFixed(2);
    // Bookings the engine creates snapshot their commission at confirmation
    // (src/db/queries/bookings.ts); seeded rows carry the same snapshot so the
    // demo data matches what the app produces.
    const commissionPct = resolveCommissionPct(
      seed.listing.commissionPct,
      ownerDefaults.get(seed.listing.ownerId) ?? "20.00",
    );
    const { commissionAmount } = computeCommission(
      { baseTotal, discountTotal: "0.00", extrasTotal: "0.00" },
      commissionPct,
    );
    await db
      .insert(bookings)
      .values({
        reference: seed.reference,
        listingId: seed.listing.id,
        guestName: seed.guestName,
        guestPhone: seed.guestPhone,
        guestEmail: `${seed.reference.toLowerCase()}@example.com`,
        startAt: seed.start,
        endAt: seed.end,
        status: seed.status,
        unitPrice: seed.unitPrice,
        units: seed.units,
        baseTotal,
        extrasTotal: "0.00",
        discountTotal: "0.00",
        total: baseTotal,
        commissionPct,
        commissionAmount,
        source: "web",
        cancellationPolicy: seed.listing.cancellationPolicy,
        createdBy: admin.id,
      })
      .onDuplicateKeyUpdate({
        set: {
          listingId: seed.listing.id,
          guestName: seed.guestName,
          startAt: seed.start,
          endAt: seed.end,
          status: seed.status,
          unitPrice: seed.unitPrice,
          units: seed.units,
          baseTotal,
          total: baseTotal,
          commissionPct,
          commissionAmount,
        },
      });
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.reference, seed.reference))
      .limit(1);
    bookingRows[seed.reference] = row!;
  }

  // One booking carries an extra so the O-2 price engine has a fixture.
  const [gps] = await db.select().from(extras).where(eq(extras.name, "GPS")).limit(1);
  if (gps) {
    const carBooking = bookingRows["ALQ-SEED06"]!;
    const [existing] = await db
      .select()
      .from(bookingExtras)
      .where(eq(bookingExtras.bookingId, carBooking.id))
      .limit(1);
    if (!existing) {
      await db.insert(bookingExtras).values({
        bookingId: carBooking.id,
        extraId: gps.id,
        nameSnapshot: gps.name,
        unitPrice: gps.price,
        qty: 3,
        lineTotal: (Number(gps.price) * 3).toFixed(2),
      });
    }
  }

  /* ---------------------------------------------- blocks + owner-use dates */
  await db
    .insert(availabilityBlocks)
    .values({
      listingId: casa.id,
      startAt: day(40),
      endAt: day(45, 11),
      reason: "owner_use",
      sourceRef: "seed-owner-use-1",
      note: "Uso personal del propietario",
      createdBy: ownerAUser.id,
    })
    .onDuplicateKeyUpdate({ set: { note: "Uso personal del propietario" } });

  /* ------------------------------------------------------------ operations */
  const cleaningSeeds = [
    {
      token: "seedtoken-limpieza-0001",
      listing: casa,
      bookingRef: "ALQ-SEED01",
      status: "ready" as const,
      dueBy: day(-11, 12),
    },
    {
      token: "seedtoken-limpieza-0002",
      listing: depto,
      bookingRef: "ALQ-SEED03",
      status: "needed" as const,
      dueBy: day(2, 12),
    },
  ];
  for (const seed of cleaningSeeds) {
    await db
      .insert(cleaningTasks)
      .values({
        listingId: seed.listing.id,
        bookingId: bookingRows[seed.bookingRef]!.id,
        status: seed.status,
        assignedUserId: cleaner.id,
        dueBy: seed.dueBy,
        magicToken: seed.token,
        checklist: [
          { key: "sabanas", label: "Cambiar sábanas y toallas", done: seed.status === "ready" },
          { key: "bano", label: "Limpiar baño", done: seed.status === "ready" },
          { key: "cocina", label: "Limpiar cocina", done: seed.status === "ready" },
          { key: "fotos", label: "Sacar fotos del estado final", done: seed.status === "ready" },
        ],
        completedAt: seed.status === "ready" ? seed.dueBy : null,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: seed.status,
          assignedUserId: cleaner.id,
          dueBy: seed.dueBy,
        },
      });
  }

  const [ticketExisting] = await db
    .select()
    .from(maintenanceTickets)
    .where(eq(maintenanceTickets.title, "Aire acondicionado no enfría"))
    .limit(1);
  const ticketId =
    ticketExisting?.id ??
    (
      await db.insert(maintenanceTickets).values({
        listingId: depto.id,
        reportedBy: admin.id,
        title: "Aire acondicionado no enfría",
        description: "El split del dormitorio principal no enfría. Revisar carga de gas.",
        status: "open",
        cost: "350000.00",
      })
    )[0].insertId;

  await db
    .insert(expenses)
    .values({
      listingId: depto.id,
      category: "repair",
      amount: "350000.00",
      incurredOn: isoDate(day(-5)),
      description: "Carga de gas del aire acondicionado",
      maintenanceTicketId: ticketId,
      createdBy: admin.id,
    })
    .onDuplicateKeyUpdate({ set: { amount: "350000.00" } });

  const [cleaningExpense] = await db
    .select()
    .from(expenses)
    .where(eq(expenses.description, "Limpieza post check-out"))
    .limit(1);
  if (!cleaningExpense) {
    await db.insert(expenses).values({
      listingId: casa.id,
      category: "cleaning",
      amount: "120000.00",
      incurredOn: isoDate(day(-11)),
      description: "Limpieza post check-out",
      createdBy: admin.id,
    });
  }

  /* --------------------------------------------------------------- supplies */
  for (const supply of [
    { name: "Toallas", unit: "unidad", consumedPerCleaning: 2 },
    { name: "Papel higiénico", unit: "rollo", consumedPerCleaning: 4 },
    { name: "Detergente", unit: "litro", consumedPerCleaning: 1 },
  ]) {
    await db
      .insert(supplies)
      .values(supply)
      .onDuplicateKeyUpdate({ set: { consumedPerCleaning: supply.consumedPerCleaning } });
  }
  const supplyRows = await db.select().from(supplies);
  for (const supply of supplyRows) {
    for (const listing of stayRows.slice(0, 2)) {
      await db
        .insert(supplyLevels)
        .values({
          supplyId: supply.id,
          listingId: listing.id,
          qty: supply.name === "Toallas" ? 2 : 12,
          lowThreshold: 4,
        })
        .onDuplicateKeyUpdate({ set: { lowThreshold: 4 } });
    }
  }

  /* --------------------------------------------------- autos: cars protection */
  const carBooking = bookingRows["ALQ-SEED07"]!;
  await db
    .insert(inspections)
    .values([
      {
        bookingId: carBooking.id,
        type: "pickup",
        odometer: 45210,
        fuelLevel: 100,
        notes: "Sin daños visibles.",
        confirmedByGuest: true,
        performedBy: admin.id,
      },
      {
        bookingId: carBooking.id,
        type: "return",
        odometer: 45890,
        fuelLevel: 60,
        notes: "Rayón en puerta trasera derecha.",
        damageFlag: true,
        confirmedByGuest: true,
        performedBy: admin.id,
      },
    ])
    .onDuplicateKeyUpdate({ set: { confirmedByGuest: true } });

  await db
    .insert(deposits)
    .values({
      bookingId: carBooking.id,
      amount: "1000000.00",
      status: "deducted",
      deductionAmount: "250000.00",
      deductionReason: "Rayón en puerta trasera derecha (ver inspección de devolución).",
      settledBy: admin.id,
      settledAt: day(-16, 12),
    })
    .onDuplicateKeyUpdate({
      set: { status: "deducted", deductionAmount: "250000.00" },
    });

  for (const car of carRows.slice(0, 3)) {
    // vehicle_reminders has no natural unique key (a listing legitimately gets
    // many reminders of the same type over time), so guard by hand instead.
    const existing = await db
      .select({ type: vehicleReminders.type })
      .from(vehicleReminders)
      .where(eq(vehicleReminders.listingId, car.id));
    const have = new Set(existing.map((r) => r.type));
    const wanted = [
      {
        listingId: car.id,
        type: "insurance" as const,
        label: "Renovación de seguro",
        dueDate: isoDate(day(45)),
        status: "upcoming" as const,
      },
      {
        listingId: car.id,
        type: "service" as const,
        label: "Service cada 10.000 km",
        dueDate: isoDate(day(15)),
        dueKm: 50000,
        status: "due" as const,
      },
    ].filter((r) => !have.has(r.type));
    if (wanted.length) await db.insert(vehicleReminders).values(wanted);
  }

  /* ------------------------------------------------------------ money links */
  await db
    .insert(paymentLinks)
    .values({
      bookingId: bookingRows["ALQ-SEED02"]!.id,
      provider: "Bancard",
      url: "https://pagos.example.com/seed-link",
      reference: "SEED-PAY-01",
      amount: "500000.00",
      status: "pending",
      expiresAt: day(9, 23),
    })
    .onDuplicateKeyUpdate({ set: { status: "pending" } });

  /* -------------------------------------------------------- comms templates */
  await db
    .insert(messageTemplates)
    .values([
      {
        key: "booking_confirmed",
        locale: "es",
        label: "Reserva confirmada",
        body: "Hola {{guest_name}}, confirmamos tu reserva en {{listing_title}} del {{start_date}} al {{end_date}}. ¡Te esperamos!",
        triggerEvent: "booking_confirmed",
        offsetMinutes: 0,
      },
      {
        key: "pre_arrival",
        locale: "es",
        label: "Un día antes de la llegada",
        body: "Hola {{guest_name}}, mañana te esperamos en {{listing_title}}. El check-in es desde las {{check_in_time}}. Cualquier cosa escribinos por acá.",
        triggerEvent: "pre_arrival",
        offsetMinutes: -1440,
      },
      {
        key: "check_in_day",
        locale: "es",
        label: "Día del check-in",
        body: "¡Bienvenido {{guest_name}}! Ya podés ingresar a {{listing_title}}. Te paso las instrucciones de acceso.",
        triggerEvent: "check_in",
        offsetMinutes: 0,
      },
      {
        key: "check_out_day",
        locale: "es",
        label: "Día del check-out",
        body: "Hola {{guest_name}}, hoy es tu check-out hasta las {{check_out_time}}. ¡Gracias por elegirnos!",
        triggerEvent: "check_out",
        offsetMinutes: 0,
      },
      {
        key: "review_request",
        locale: "es",
        label: "Pedido de reseña en Google",
        body: "Hola {{guest_name}}, ¿nos dejás una reseña? Nos ayuda muchísimo: {{review_link}}",
        triggerEvent: "post_stay",
        offsetMinutes: 1440,
      },
    ])
    .onDuplicateKeyUpdate({ set: { isActive: true } });

  const [existingMessage] = await db
    .select()
    .from(messages)
    .where(eq(messages.bookingId, bookingRows["ALQ-SEED04"]!.id))
    .limit(1);
  if (!existingMessage) {
    await db.insert(messages).values([
      {
        bookingId: bookingRows["ALQ-SEED04"]!.id,
        listingId: lago.id,
        direction: "inbound",
        channel: "whatsapp",
        contactName: "Carla Ramírez",
        contactPhone: "+595984000004",
        body: "Hola, ¿la casa tiene aire acondicionado en todos los cuartos?",
      },
      {
        bookingId: bookingRows["ALQ-SEED04"]!.id,
        listingId: lago.id,
        direction: "outbound",
        channel: "whatsapp",
        contactName: "Carla Ramírez",
        contactPhone: "+595984000004",
        body: "¡Hola Carla! Sí, los cuatro dormitorios tienen aire acondicionado.",
        loggedBy: admin.id,
      },
    ]);
  }

  /* -------------------------------------------------------------- onboarding */
  for (const owner of [ownerA, ownerB]) {
    await db
      .insert(ownerOnboarding)
      .values({ ownerId: owner.id })
      .onDuplicateKeyUpdate({ set: { ownerId: owner.id } });
    const [onboarding] = await db
      .select()
      .from(ownerOnboarding)
      .where(eq(ownerOnboarding.ownerId, owner.id))
      .limit(1);
    const steps = [
      { stepKey: "contract", label: "Contrato firmado" },
      { stepKey: "photos", label: "Fotos profesionales cargadas" },
      { stepKey: "info_base", label: "Base de información completa" },
      { stepKey: "ical", label: "Calendario iCal conectado" },
      { stepKey: "first_listing_published", label: "Primera publicación publicada" },
    ];
    await db
      .insert(onboardingSteps)
      .values(
        steps.map((step, index) => ({
          onboardingId: onboarding!.id,
          stepKey: step.stepKey,
          label: step.label,
          sortOrder: index,
          status: index < 3 ? ("done" as const) : ("pending" as const),
        })),
      )
      .onDuplicateKeyUpdate({ set: { label: sql`label` } });
  }

  /* -------------------------------------------------------------------- leads */
  await db
    .insert(leads)
    .values({
      name: "Carla Ramírez",
      phone: "+595984000004",
      email: "alq-seed04@example.com",
      message: "Consulta por la casa frente al lago para el fin de semana largo.",
      vertical: "stay",
      listingId: lago.id,
      bookingId: bookingRows["ALQ-SEED04"]!.id,
      sourceUrl: "/alojamientos/casa-frente-al-lago-encarnacion",
      forwardStatus: "pending",
    })
    .onDuplicateKeyUpdate({ set: { forwardStatus: "pending" } });

  console.log("Seed complete:");
  console.log(`  super_admin  ${superAdmin.email}`);
  console.log(`  admin        ${admin.email}`);
  console.log(`  owner A      ${ownerAUser.email} (casa + auto — dual vertical)`);
  console.log(`  owner B      ${ownerBUser.email}`);
  console.log(`  cleaner      ${cleaner.email} (magic link only)`);
  console.log(`  listings     ${stayRows.length} stays + ${carRows.length} cars`);
  console.log(`  bookings     ${bookingSeeds.length} across all statuses`);
  console.log(`  password     ${DEFAULT_PASSWORD} (all logins except super_admin env override)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
