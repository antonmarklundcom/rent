import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { setListingStatusAction } from "@/app/actions/owner";
import { listListingsForUser } from "@/db/queries/listings";
import { LISTING_STATUSES } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Every listing, and the publish control (plan §5.O11).
 *
 * Publishing is admin-only by design — see `OWNER_SETTABLE_STATUSES` in
 * `src/db/queries/listings.ts`. Editing happens on the shared panel route so
 * there is exactly one listing form in the codebase.
 */
export default async function AdminListingsPage() {
  const user = await requireAdminPage();
  const rows = await listListingsForUser(user);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Publicaciones</h1>
        <p className="text-sm text-neutral-600">
          {rows.filter((r) => r.status === "published").length} publicada(s) de {rows.length}.{" "}
          <Link href="/panel/publicaciones" className="text-blue-700 underline">
            crear una nueva
          </Link>
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Título</th>
            <th>Vertical</th>
            <th>Precio</th>
            <th>Comisión</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b align-top">
              <td className="py-2">
                <Link href={`/panel/publicaciones/${row.id}`} className="text-blue-700 underline">
                  {row.title}
                </Link>
                <span className="block text-xs text-neutral-500">/{row.slug}</span>
              </td>
              <td>{row.vertical}</td>
              <td>{formatMoney(row.price, row.currency)}</td>
              <td>{row.commissionPct ? `${row.commissionPct}%` : "por defecto"}</td>
              <td>
                <ActionForm
                  action={setListingStatusAction}
                  submitLabel="Guardar"
                  className="flex items-center gap-1"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="listingId" value={row.id} />
                  <select
                    name="status"
                    defaultValue={row.status}
                    className="rounded border border-neutral-300 px-1 py-1 text-xs"
                  >
                    {LISTING_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
