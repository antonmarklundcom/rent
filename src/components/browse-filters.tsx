import { PROPERTY_TYPES, VEHICLE_TYPES, type Vertical } from "@/db/schema";

/**
 * The browse filter form (plan §5.O11).
 *
 * A plain GET `<form>` on purpose: it works with JavaScript off, every filtered
 * view has a real URL Sonnet can add a canonical tag to (plan §6.S5), and the
 * back button behaves. Ugly by design — Window 2 restyles it.
 */
export function BrowseFilters({
  vertical,
  action,
  locations,
  values,
}: {
  vertical: Vertical;
  action: string;
  locations: { slug: string; name: string; listings: number }[];
  values: Record<string, string | undefined>;
}) {
  return (
    <form action={action} method="get" className="space-y-2 border border-neutral-300 p-3 text-sm">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          Ubicación
          <select name="ubicacion" defaultValue={values.ubicacion ?? ""} className="border p-1">
            <option value="">Todas</option>
            {locations.map((location) => (
              <option key={location.slug} value={location.slug}>
                {location.name} ({location.listings})
              </option>
            ))}
          </select>
        </label>

        {vertical === "stay" ? (
          <>
            <label className="flex flex-col">
              Tipo
              <select name="tipo" defaultValue={values.tipo ?? ""} className="border p-1">
                <option value="">Todos</option>
                {PROPERTY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              Huéspedes (mín.)
              <input
                type="number"
                min={1}
                max={30}
                name="huespedes"
                defaultValue={values.huespedes ?? ""}
                className="w-24 border p-1"
              />
            </label>
            <label className="flex flex-col">
              Dormitorios (mín.)
              <input
                type="number"
                min={1}
                max={15}
                name="dormitorios"
                defaultValue={values.dormitorios ?? ""}
                className="w-24 border p-1"
              />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col">
              Tipo
              <select name="tipo" defaultValue={values.tipo ?? ""} className="border p-1">
                <option value="">Todos</option>
                {VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              Asientos (mín.)
              <input
                type="number"
                min={1}
                max={20}
                name="asientos"
                defaultValue={values.asientos ?? ""}
                className="w-24 border p-1"
              />
            </label>
          </>
        )}

        <label className="flex flex-col">
          Precio mín.
          <input
            type="number"
            min={0}
            name="min"
            defaultValue={values.min ?? ""}
            className="w-32 border p-1"
          />
        </label>
        <label className="flex flex-col">
          Precio máx.
          <input
            type="number"
            min={0}
            name="max"
            defaultValue={values.max ?? ""}
            className="w-32 border p-1"
          />
        </label>
        <label className="flex flex-col">
          Orden
          <select name="orden" defaultValue={values.orden ?? "recent"} className="border p-1">
            <option value="recent">Más recientes</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">
          Filtrar
        </button>
        <a href={action} className="rounded border px-3 py-1">
          Limpiar
        </a>
      </div>
    </form>
  );
}
