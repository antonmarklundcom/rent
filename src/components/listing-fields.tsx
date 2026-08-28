import type { carDetails, listings, locations, stayDetails } from "@/db/schema";
import {
  CANCELLATION_POLICIES,
  PRICE_UNITS,
  PROPERTY_TYPES,
  VEHICLE_TYPES,
  type Vertical,
} from "@/db/schema";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

/**
 * The listing form's fields, shared by "nueva publicación" and the edit page so
 * the two can never drift. Ugly by design — Sonnet restyles it in S-2.
 */
export function ListingFields({
  vertical,
  listing,
  stay,
  car,
  locationRows,
}: {
  vertical: Vertical;
  listing?: typeof listings.$inferSelect | null;
  stay?: typeof stayDetails.$inferSelect | null;
  car?: typeof carDetails.$inferSelect | null;
  locationRows: (typeof locations.$inferSelect)[];
}) {
  return (
    <>
      <label className="block space-y-1 text-sm">
        <span>Título</span>
        <input name="title" required defaultValue={listing?.title ?? ""} className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Descripción</span>
        <textarea
          name="description"
          rows={4}
          defaultValue={listing?.description ?? ""}
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <label className="space-y-1">
          <span>Precio</span>
          <input
            name="price"
            required
            inputMode="decimal"
            defaultValue={listing?.price ?? ""}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span>Unidad</span>
          <select name="priceUnit" defaultValue={listing?.priceUnit ?? "per_night"} className={inputClass}>
            {PRICE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span>Cancelación</span>
          <select
            name="cancellationPolicy"
            defaultValue={listing?.cancellationPolicy ?? "moderate"}
            className={inputClass}
          >
            {CANCELLATION_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {policy}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span>Ubicación</span>
        <select name="locationId" defaultValue={listing?.locationId ?? ""} className={inputClass}>
          <option value="">— sin ubicación —</option>
          {locationRows.map((location) => (
            <option key={location.id} value={location.id}>
              {location.parentId ? "· " : ""}
              {location.name}
            </option>
          ))}
        </select>
      </label>

      {vertical === "stay" ? (
        <div className="grid grid-cols-5 gap-2 text-sm">
          <label className="space-y-1">
            <span>Tipo</span>
            <select name="propertyType" defaultValue={stay?.propertyType ?? "casa"} className={inputClass}>
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span>Dorm.</span>
            <input type="number" name="bedrooms" min={0} defaultValue={stay?.bedrooms ?? ""} className={inputClass} />
          </label>
          <label className="space-y-1">
            <span>Baños</span>
            <input type="number" name="bathrooms" min={0} defaultValue={stay?.bathrooms ?? ""} className={inputClass} />
          </label>
          <label className="space-y-1">
            <span>Huésp.</span>
            <input type="number" name="maxGuests" min={0} defaultValue={stay?.maxGuests ?? ""} className={inputClass} />
          </label>
          <label className="space-y-1">
            <span>m²</span>
            <input type="number" name="areaM2" min={0} defaultValue={stay?.areaM2 ?? ""} className={inputClass} />
          </label>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <label className="space-y-1">
              <span>Tipo</span>
              <select name="vehicleType" defaultValue={car?.vehicleType ?? "auto"} className={inputClass}>
                {VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>Marca</span>
              <input name="make" defaultValue={car?.make ?? ""} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Modelo</span>
              <input name="model" defaultValue={car?.model ?? ""} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Año</span>
              <input type="number" name="year" defaultValue={car?.year ?? ""} className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-5 gap-2 text-sm">
            <label className="space-y-1">
              <span>Caja</span>
              <input name="transmission" defaultValue={car?.transmission ?? ""} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Combustible</span>
              <input name="fuel" defaultValue={car?.fuel ?? ""} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Asientos</span>
              <input type="number" name="seats" min={0} defaultValue={car?.seats ?? ""} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Chapa</span>
              <input name="plate" defaultValue={car?.plate ?? ""} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Km/día</span>
              <input type="number" name="dailyKmLimit" min={0} defaultValue={car?.dailyKmLimit ?? ""} className={inputClass} />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            La chapa es privada: no se muestra en las páginas públicas.
          </p>
        </>
      )}
    </>
  );
}
