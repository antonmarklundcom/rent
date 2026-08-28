import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { updateListingAction } from "@/app/actions/panel";
import { listPanelListings } from "@/db/queries/panel";
import { LISTING_STATUSES } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * All listings (plan §5.O11). An admin gets the same edit action the owner
 * does — `updatePanelListing` scopes by role, so one code path serves both and
 * there is no admin-only copy of the rules to drift.
 */
export default async function AdminListingsPage() {
  const user = await requireAdminPage();
  const listings = await listPanelListings(user);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Publicaciones</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Título</th>
            <th>Vertical</th>
            <th>Ubicación</th>
            <th>Precio</th>
            <th>Fotos</th>
            <th>Estado</th>
            <th>Público</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((row) => (
            <tr key={row.id} className="border-b align-top">
              <td className="py-1">
                <Link href={`/panel/publicaciones/${row.id}`} className="text-blue-700 underline">
                  {row.title}
                </Link>
              </td>
              <td>{row.vertical}</td>
              <td>{row.locationName ?? "—"}</td>
              <td>{formatMoney(row.price, row.currency)}</td>
              <td>{row.imageCount}</td>
              <td>
                <ActionForm
                  action={updateListingAction}
                  submitLabel="Cambiar"
                  className="flex items-center gap-1"
                  submitClassName="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="listingId" value={row.id} />
                  <select name="status" defaultValue={row.status} className="border p-0.5 text-xs">
                    {LISTING_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              </td>
              <td>
                {row.status === "published" ? (
                  <Link href={`/publicacion/${row.slug}`} className="text-blue-700 underline">
                    ver
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {listings.length === 0 && <p className="text-sm text-neutral-600">Sin publicaciones.</p>}
    </section>
  );
}
