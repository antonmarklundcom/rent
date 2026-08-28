import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { ListingFields } from "@/components/listing-fields";
import { createListingAction } from "@/app/actions/owner";
import { listListingsForUser, listLocations } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";
import { requirePanelPage } from "@/lib/page-guards";

/** Own-listing CRUD (plan §5.O10). New listings always start as `draft`. */
export default async function PanelListingsPage() {
  const user = await requirePanelPage();
  const [rows, locationRows] = await Promise.all([
    listListingsForUser(user),
    listLocations(),
  ]);

  return (
    <section className="space-y-8">
      <div>
        <Link href="/panel" className="text-sm text-blue-700 underline">
          ← Panel
        </Link>
        <h1 className="text-2xl font-semibold">Publicaciones</h1>
      </div>

      <ul className="space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-neutral-200 pb-1">
            <Link href={`/panel/publicaciones/${row.id}`} className="text-blue-700 underline">
              {row.title}
            </Link>{" "}
            — {row.vertical} · {row.status} · {formatMoney(row.price, row.currency)}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-neutral-500">Todavía no tenés publicaciones.</li>
        )}
      </ul>

      <section className="space-y-2">
        <h2 className="font-medium">Nuevo alojamiento</h2>
        <ActionForm action={createListingAction} submitLabel="Crear alojamiento">
          <input type="hidden" name="vertical" value="stay" />
          {user.role !== "owner" && (
            <label className="block space-y-1 text-sm">
              <span>ID del propietario</span>
              <input
                name="ownerId"
                required
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          )}
          <ListingFields vertical="stay" locationRows={locationRows} />
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Nuevo auto</h2>
        <ActionForm action={createListingAction} submitLabel="Crear auto">
          <input type="hidden" name="vertical" value="car" />
          {user.role !== "owner" && (
            <label className="block space-y-1 text-sm">
              <span>ID del propietario</span>
              <input
                name="ownerId"
                required
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          )}
          <ListingFields vertical="car" locationRows={locationRows} />
        </ActionForm>
      </section>
    </section>
  );
}
