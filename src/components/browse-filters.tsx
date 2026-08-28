import { getTranslations } from "next-intl/server";
import { PROPERTY_TYPES, VEHICLE_TYPES, type Vertical } from "@/db/schema";

/**
 * The browse filter form (plan §5.O11 → §6.S2 restyle).
 *
 * A plain GET `<form>` on purpose: it works with JavaScript off, every filtered
 * view has a real URL Sonnet can add a canonical tag to (plan §6.S5), and the
 * back button behaves.
 */
export async function BrowseFilters({
  vertical,
  action,
  locations,
  values,
  lockedLocationLabel,
}: {
  vertical: Vertical;
  action: string;
  locations: { slug: string; name: string; listings: number }[];
  values: Record<string, string | undefined>;
  /** Set on a location landing page: the ubicación field is hidden, not shown as a dropdown. */
  lockedLocationLabel?: string;
}) {
  const t = await getTranslations("filters");
  const inputClass =
    "rounded-sm border border-ink/15 bg-surface px-3 py-2.5 text-sm focus:border-accent focus:outline-none";
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-ink/60";

  return (
    <form
      action={action}
      method="get"
      className="card--raised card--hair flex flex-wrap items-end gap-3 rounded-md p-4"
    >
      {lockedLocationLabel ? (
        <input type="hidden" name="ubicacion" value={values.ubicacion ?? ""} />
      ) : (
        <label className={labelClass}>
          {t("location")}
          <select name="ubicacion" defaultValue={values.ubicacion ?? ""} className={inputClass}>
            <option value="">{t("allLocations")}</option>
            {locations.map((location) => (
              <option key={location.slug} value={location.slug}>
                {location.name} ({location.listings})
              </option>
            ))}
          </select>
        </label>
      )}

      {vertical === "stay" ? (
        <>
          <label className={labelClass}>
            {t("type")}
            <select name="tipo" defaultValue={values.tipo ?? ""} className={inputClass}>
              <option value="">{t("allTypes")}</option>
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`propertyType.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("guestsMin")}
            <input
              type="number"
              min={1}
              max={30}
              name="huespedes"
              defaultValue={values.huespedes ?? ""}
              className={`w-24 ${inputClass}`}
            />
          </label>
          <label className={labelClass}>
            {t("bedroomsMin")}
            <input
              type="number"
              min={1}
              max={15}
              name="dormitorios"
              defaultValue={values.dormitorios ?? ""}
              className={`w-24 ${inputClass}`}
            />
          </label>
        </>
      ) : (
        <>
          <label className={labelClass}>
            {t("type")}
            <select name="tipo" defaultValue={values.tipo ?? ""} className={inputClass}>
              <option value="">{t("allTypes")}</option>
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`vehicleType.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("seatsMin")}
            <input
              type="number"
              min={1}
              max={20}
              name="asientos"
              defaultValue={values.asientos ?? ""}
              className={`w-24 ${inputClass}`}
            />
          </label>
        </>
      )}

      <label className={labelClass}>
        {t("priceMin")}
        <input
          type="number"
          min={0}
          name="min"
          defaultValue={values.min ?? ""}
          className={`w-28 ${inputClass}`}
        />
      </label>
      <label className={labelClass}>
        {t("priceMax")}
        <input
          type="number"
          min={0}
          name="max"
          defaultValue={values.max ?? ""}
          className={`w-28 ${inputClass}`}
        />
      </label>
      <label className={labelClass}>
        {t("sort")}
        <select name="orden" defaultValue={values.orden ?? "recent"} className={inputClass}>
          <option value="recent">{t("sortRecent")}</option>
          <option value="price_asc">{t("sortPriceAsc")}</option>
          <option value="price_desc">{t("sortPriceDesc")}</option>
        </select>
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-sm bg-ink px-5 text-sm font-medium text-base transition-transform hover:-translate-y-0.5"
        >
          {t("apply")}
        </button>
        <a
          href={action}
          className="flex min-h-11 items-center rounded-sm border border-ink/15 px-4 text-sm hover:border-ink/30"
        >
          {t("clear")}
        </a>
      </div>
    </form>
  );
}
