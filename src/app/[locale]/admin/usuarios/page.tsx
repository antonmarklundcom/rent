import { PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
import { listOwnersWithCounts, listUsers } from "@/db/queries/users";
import { requireAdminPage } from "@/lib/page-guards";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  owner: "Propietario",
  cleaner: "Limpieza",
};

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
    <div className="space-y-8">
      <PageHeader title="Usuarios" />

      <Section
        description="Alta y edición de usuarios: pendiente en §10 Backlog. Los encargados de limpieza no inician sesión — usan su enlace mágico."
      >
        <TableWrap>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Nombre</th>
                <th className={th}>Email</th>
                <th className={th}>Rol</th>
                <th className={th}>Activo</th>
                <th className={th}>Último ingreso</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td className={`${td} font-medium`}>{person.name}</td>
                  <td className={td}>{person.email}</td>
                  <td className={td}>{ROLE_LABEL[person.role] ?? person.role}</td>
                  <td className={td}>{person.isActive ? "sí" : "no"}</td>
                  <td className={td}>{person.lastLoginAt ? person.lastLoginAt.toISOString().slice(0, 16) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Propietarios">
        <TableWrap>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Propietario</th>
                <th className={th}>Email</th>
                <th className={th}>RUC</th>
                <th className={th}>Comisión por defecto</th>
                <th className={th}>Publicaciones</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((owner) => (
                <tr key={owner.ownerId}>
                  <td className={`${td} font-medium`}>{owner.displayName}</td>
                  <td className={td}>{owner.email}</td>
                  <td className={td}>{owner.ruc ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{owner.defaultCommissionPct}%</td>
                  <td className={`${td} tabular-nums`}>{Number(owner.listings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>
    </div>
  );
}
