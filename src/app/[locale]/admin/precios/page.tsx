import { ActionForm } from "@/components/action-form";
import {
  savePromoAction,
  saveExtraAction,
  toggleExtraAction,
  togglePromoAction,
} from "@/app/actions/pricing";
import { listAllExtras, listPromoCodes } from "@/db/queries/extras";
import { listListingsForUser } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";
import { formatLocalDate } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

/**
 * Extras (#10) and promo codes (#18) — plan §5.O11.
 *
 * Both feed the ONE price calculation in `src/lib/pricing.ts`: an extra is
 * never commissioned and a percentage code never discounts an extra (plan §9,
 * O-2 judgment calls 2 and 3).
 */
export default async function AdminPricingPage() {
  const user = await requireAdminPage();
  const [extras, promos, listings] = await Promise.all([
    listAllExtras(),
    listPromoCodes(),
    listListingsForUser(user),
  ]);

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Adicionales y códigos</h1>

      <section className="space-y-2">
        <h2 className="font-medium">Adicionales ({extras.length})</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Nombre</th>
              <th>Precio</th>
              <th>Alcance</th>
              <th>Por día</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody>
            {extras.map(({ extra, listingTitle }) => (
              <tr key={extra.id} className="border-b align-top">
                <td className="py-1">
                  {extra.name}
                  {extra.description && (
                    <span className="block text-xs text-neutral-500">{extra.description}</span>
                  )}
                </td>
                <td>{formatMoney(extra.price)}</td>
                <td>
                  {extra.scope === "listing"
                    ? (listingTitle ?? "publicación")
                    : (extra.vertical ?? "ambos")}
                </td>
                <td>{extra.perUnit ? "sí" : "no"}</td>
                <td>
                  <ActionForm
                    action={toggleExtraAction}
                    submitLabel={extra.isActive ? "Desactivar" : "Activar"}
                    className="inline"
                    submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <input type="hidden" name="extraId" value={extra.id} />
                    <input
                      type="hidden"
                      name="isActive"
                      value={extra.isActive ? "off" : "on"}
                    />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <details>
          <summary className="cursor-pointer text-sm">Nuevo adicional</summary>
          <ActionForm action={saveExtraAction} submitLabel="Guardar adicional">
            <label className="block space-y-1 text-sm">
              <span>Nombre</span>
              <input name="name" required className={inputClass} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Descripción</span>
              <input name="description" className={inputClass} />
            </label>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <label className="space-y-1">
                <span>Precio</span>
                <input name="price" required inputMode="decimal" className={inputClass} />
              </label>
              <label className="space-y-1">
                <span>Alcance</span>
                <select name="scope" defaultValue="vertical" className={inputClass}>
                  <option value="vertical">todo un vertical</option>
                  <option value="listing">una publicación</option>
                </select>
              </label>
              <label className="space-y-1">
                <span>Vertical</span>
                <select name="vertical" defaultValue="stay" className={inputClass}>
                  <option value="stay">alojamientos</option>
                  <option value="car">autos</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span>Publicación (sólo si el alcance es una publicación)</span>
              <select name="listingId" defaultValue="" className={inputClass}>
                <option value="">—</option>
                {listings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="perUnit" />
              <span>Se cobra por noche/día (si no, es un cargo único)</span>
            </label>
          </ActionForm>
        </details>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Códigos promocionales ({promos.length})</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Código</th>
              <th>Descuento</th>
              <th>Vigencia</th>
              <th>Usos</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody>
            {promos.map((promo) => (
              <tr key={promo.id} className="border-b">
                <td className="py-1">{promo.code}</td>
                <td>
                  {promo.discountType === "percent"
                    ? `${promo.discountValue}%`
                    : formatMoney(promo.discountValue)}
                </td>
                <td>
                  {promo.validFrom ? formatLocalDate(promo.validFrom) : "—"} →{" "}
                  {promo.validUntil ? formatLocalDate(promo.validUntil) : "—"}
                </td>
                <td>
                  {promo.usedCount}
                  {promo.maxUses ? ` / ${promo.maxUses}` : ""}
                </td>
                <td>
                  <ActionForm
                    action={togglePromoAction}
                    submitLabel={promo.isActive ? "Desactivar" : "Activar"}
                    className="inline"
                    submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <input type="hidden" name="promoId" value={promo.id} />
                    <input type="hidden" name="isActive" value={promo.isActive ? "off" : "on"} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <details>
          <summary className="cursor-pointer text-sm">Nuevo código</summary>
          <ActionForm action={savePromoAction} submitLabel="Guardar código">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <label className="space-y-1">
                <span>Código</span>
                <input name="code" required placeholder="VERANO26" className={inputClass} />
              </label>
              <label className="space-y-1">
                <span>Tipo</span>
                <select name="discountType" defaultValue="percent" className={inputClass}>
                  <option value="percent">porcentaje</option>
                  <option value="fixed">monto fijo</option>
                </select>
              </label>
              <label className="space-y-1">
                <span>Valor</span>
                <input name="discountValue" required inputMode="decimal" className={inputClass} />
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <label className="space-y-1">
                <span>Desde</span>
                <input type="date" name="validFrom" className={inputClass} />
              </label>
              <label className="space-y-1">
                <span>Hasta</span>
                <input type="date" name="validUntil" className={inputClass} />
              </label>
              <label className="space-y-1">
                <span>Usos máx.</span>
                <input type="number" name="maxUses" min={1} className={inputClass} />
              </label>
              <label className="space-y-1">
                <span>Vertical</span>
                <select name="vertical" defaultValue="" className={inputClass}>
                  <option value="">ambos</option>
                  <option value="stay">alojamientos</option>
                  <option value="car">autos</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-neutral-500">
              El descuento se aplica sólo sobre la base, nunca sobre los adicionales.
            </p>
          </ActionForm>
        </details>
      </section>
    </section>
  );
}
