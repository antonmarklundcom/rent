import { listOwnersWithCounts, listUsers } from "@/db/queries/users";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * User and owner directory (plan §5.O11).
 *
 * Read-only in v1: creating and editing accounts is `super_admin` work that
 * plan §2 defines but §5 does not scope, so it sits in §10 Backlog rather than
 * being half-built here. The seed provisions the accounts.
 */
export default async function AdminUsersPage() {
  await requireAdminPage();
  const [people, owners] = await Promise.all([listUsers(), listOwnersWithCounts()]);

  return (
    <section className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Activo</th>
              <th>Último ingreso</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-b">
                <td className="py-1">{person.name}</td>
                <td>{person.email}</td>
                <td>{person.role}</td>
                <td>{person.isActive ? "sí" : "no"}</td>
                <td>{person.lastLoginAt ? person.lastLoginAt.toISOString().slice(0, 16) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-neutral-500">
          Alta y edición de usuarios: pendiente en §10 Backlog. Los encargados de limpieza no
          inician sesión — usan su enlace mágico.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Propietarios</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Propietario</th>
              <th>Email</th>
              <th>RUC</th>
              <th>Comisión por defecto</th>
              <th>Publicaciones</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((owner) => (
              <tr key={owner.ownerId} className="border-b">
                <td className="py-1">{owner.displayName}</td>
                <td>{owner.email}</td>
                <td>{owner.ruc ?? "—"}</td>
                <td>{owner.defaultCommissionPct}%</td>
                <td>{Number(owner.listings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
