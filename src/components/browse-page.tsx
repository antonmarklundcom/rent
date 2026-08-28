import { Link } from "@/i18n/navigation";
import {
  listLocationsWithListings,
  listPublishedListings,
  type BrowseFilters,
} from "@/db/queries/listings";
import { PROPERTY_TYPES, VEHICLE_TYPES, type Vertical } from "@/db/schema";
import { formatMoney } from "@/lib/money";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

function intOrNull(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

/**
 * The public browse page for one vertical (plan §5.O11) — filters plus a list.
 *
 * Filters are plain GET query parameters on a plain `<form>`, so the page works
 * with JavaScript off and every filtered view has its own shareable URL (which
 * is also what phase S-2 needs for canonicals, plan §6.S5).
 */
export async function BrowsePage({
  vertical,
  title,
  detailBase,
  searchParams,
}: {
  vertical: Vertical;
  title: string;
  /** `/alojamiento` or `/auto` — the singular detail route. */
  detailBase: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const single = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  /** A query value is only a filter if it is one of the enum's own members. */
  const oneOf = <T extends string>(options: readonly T[], value: string | undefined): T | null =>
    options.find((option) => option === value) ?? null;

  const type = single("tipo");
  const filters: BrowseFilters = {
    locationId: intOrNull(single("ubicacion")),
    minPrice: intOrNull(single("precioMin")),
    maxPrice: intOrNull(single("precioMax")),
    guests: vertical === "stay" ? intOrNull(single("huespedes")) : null,
    bedrooms: vertical === "stay" ? intOrNull(single("dormitorios")) : null,
    propertyType: vertical === "stay" ? oneOf(PROPERTY_TYPES, type) : null,
    vehicleType: vertical === "car" ? oneOf(VEHICLE_TYPES, type) : null,
    seats: vertical === "car" ? intOrNull(single("asientos")) : null,
  };

  const [rows, locationRows] = await Promise.all([
    listPublishedListings(vertical, filters),
    listLocationsWithListings(vertical),
  ]);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>

      <form className="space-y-2 rounded border border-neutral-200 p-3 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="space-y-1">
            <span className="block">Ubicación</span>
            <select name="ubicacion" defaultValue={single("ubicacion") ?? ""} className={inputClass}>
              <option value="">todas</option>
              {locationRows.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.parentId ? "· " : ""}
                  {location.name} ({location.listingCount})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block">Tipo</span>
            <select name="tipo" defaultValue={single("tipo") ?? ""} className={inputClass}>
              <option value="">todos</option>
              {(vertical === "stay" ? PROPERTY_TYPES : VEHICLE_TYPES).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block">Precio mínimo</span>
            <input
              type="number"
              name="precioMin"
              min={0}
              defaultValue={single("precioMin") ?? ""}
              className={inputClass}
            />
          </label>
          <label className="space-y-1">
            <span className="block">Precio máximo</span>
            <input
              type="number"
              name="precioMax"
              min={0}
              defaultValue={single("precioMax") ?? ""}
              className={inputClass}
            />
          </label>
          {vertical === "stay" ? (
            <>
              <label className="space-y-1">
                <span className="block">Huéspedes</span>
                <input
                  type="number"
                  name="huespedes"
                  min={1}
                  defaultValue={single("huespedes") ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1">
                <span className="block">Dormitorios</span>
                <input
                  type="number"
                  name="dormitorios"
                  min={1}
                  defaultValue={single("dormitorios") ?? ""}
                  className={inputClass}
                />
              </label>
            </>
          ) : (
            <label className="space-y-1">
              <span className="block">Asientos</span>
              <input
                type="number"
                name="asientos"
                min={1}
                defaultValue={single("asientos") ?? ""}
                className={inputClass}
              />
            </label>
          )}
        </div>
        <button type="submit" className="rounded border border-neutral-400 px-3 py-1">
          Filtrar
        </button>
      </form>

      <p className="text-sm text-neutral-600">{rows.length} resultado(s)</p>

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-neutral-200 pb-3">
            <Link href={`${detailBase}/${row.slug}`} className="text-blue-700 underline">
              <strong>{row.title}</strong>
            </Link>
            <span className="block text-sm text-neutral-600">
              {row.locationName ?? "Sin ubicación"} ·{" "}
              {vertical === "stay"
                ? [
                    row.propertyType,
                    row.bedrooms ? `${row.bedrooms} dorm.` : null,
                    row.bathrooms ? `${row.bathrooms} baños` : null,
                    row.maxGuests ? `${row.maxGuests} huéspedes` : null,
                    row.areaM2 ? `${row.areaM2} m²` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : [
                    row.vehicleType,
                    [row.make, row.model].filter(Boolean).join(" ") || null,
                    row.year,
                    row.transmission,
                    row.seats ? `${row.seats} asientos` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
            <span className="block text-sm">
              {formatMoney(row.price, row.currency)} / {row.priceUnit}
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-sm text-neutral-500">
            No encontramos nada con esos filtros. Probá ampliarlos.
          </li>
        )}
      </ul>
    </section>
  );
}
