import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Section, TableWrap, EmptyState, table, th, td } from "@/components/ui/page-header";
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
    <div className="space-y-4">
      <PageHeader title="Publicaciones" />
      <Section>
        {listings.length === 0 ? (
          <EmptyState>Sin publicaciones.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Título</th>
                  <th className={th}>Vertical</th>
                  <th className={th}>Ubicación</th>
                  <th className={th}>Precio</th>
                  <th className={th}>Fotos</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Público</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((row) => (
                  <tr key={row.id}>
                    <td className={`${td} font-medium`}>
                      <Link href={`/panel/publicaciones/${row.id}`} className="text-accent hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className={td}>{row.vertical === "stay" ? "Alojamiento" : "Auto"}</td>
                    <td className={td}>{row.locationName ?? "—"}</td>
                    <td className={`${td} tabular-nums`}>{formatMoney(row.price, row.currency)}</td>
                    <td className={td}>{row.imageCount}</td>
                    <td className={td}>
                      <ActionForm
                        action={updateListingAction}
                        submitLabel="Cambiar"
                        className="flex items-center gap-1"
                        submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                      >
                        <input type="hidden" name="listingId" value={row.id} />
                        <select name="status" defaultValue={row.status} className="rounded-sm border border-ink/15 px-1 py-1 text-xs">
                          {LISTING_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </ActionForm>
                    </td>
                    <td className={td}>
                      {row.status === "published" ? (
                        <Link href={`/publicacion/${row.slug}`} className="text-accent hover:underline">
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
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
