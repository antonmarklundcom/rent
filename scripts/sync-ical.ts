/**
 * iCal import (#2, plan §5.O5) — cron-ready, idempotent.
 *
 *   npm run sync:ical            # every active source
 *   npm run sync:ical -- 12      # only ical_sources.id = 12
 *
 * Hourly on Hostinger's cron. Each source is fetched independently: one dead
 * feed never stops the others, and its failure is recorded on the row
 * (`last_status`) so the admin panel can show it.
 *
 * Conflict policy: OUR bookings win. An imported event that overlaps a
 * confirmed booking is skipped and reported, never written — see
 * `syncIcalBlocks` in `src/db/queries/blocks.ts`.
 */
import "dotenv/config";
import { closePool, db } from "../src/db";
import {
  listIcalSources,
  recordIcalSyncResult,
  syncIcalBlocks,
} from "../src/db/queries/blocks";
import { blockingEvents, parseIcal } from "../src/lib/ical";

const FETCH_TIMEOUT_MS = 20_000;

export async function fetchIcalText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const onlyId = process.argv[2] ? Number.parseInt(process.argv[2], 10) : undefined;
  const sources = await listIcalSources({ activeOnly: true });
  const targets = onlyId ? sources.filter((source) => source.id === onlyId) : sources;

  if (targets.length === 0) {
    console.log("No hay fuentes iCal activas para sincronizar.");
    return;
  }
  console.log(`Sincronizando ${targets.length} fuente(s) iCal…`);

  let failures = 0;
  for (const source of targets) {
    const label = `#${source.id} ${source.label ?? source.url}`;
    try {
      const text = await fetchIcalText(source.url);
      const events = blockingEvents(parseIcal(text));
      const outcome = await syncIcalBlocks(
        { id: source.id, listingId: source.listingId, label: source.label },
        events.map((event) => ({
          sourceRef: event.uid,
          startAt: event.startAt,
          endAt: event.endAt,
          note: event.summary ?? source.label ?? "iCal",
        })),
        db,
      );
      const status =
        `ok: ${events.length} evento(s) — +${outcome.created} ~${outcome.updated} ` +
        `-${outcome.removed}${outcome.skipped.length ? ` !${outcome.skipped.length}` : ""}`;
      await recordIcalSyncResult(source.id, status);
      console.log(`  ${label}: ${status}`);
      for (const skip of outcome.skipped) {
        console.log(`      omitido ${skip.sourceRef}: ${skip.reason}`);
      }
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      await recordIcalSyncResult(source.id, `error: ${message}`).catch(() => {});
      console.error(`  ${label}: ERROR — ${message}`);
    }
  }

  if (failures > 0) {
    console.error(`${failures} fuente(s) fallaron.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
