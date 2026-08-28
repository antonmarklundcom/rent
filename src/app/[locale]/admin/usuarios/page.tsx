import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import {
  createUserAction,
  setUserActiveAction,
  setUserPasswordAction,
  setUserRoleAction,
} from "@/app/actions/users";
import { listUsers } from "@/db/queries/users";
import { USER_ROLES } from "@/db/schema";
import { formatLocalDateTime } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

/** User management (plan §2) — `super_admin` only, in the route and the action. */
export default async function AdminUsersPage() {
  const user = await requireAdminPage();
  if (user.role !== "super_admin") redirect("/admin");
  const rows = await listUsers();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <p className="text-sm text-neutral-600">
          Los encargados de limpieza no tienen contraseña: trabajan desde el enlace de su
          tarea.
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Nombre</th>
            <th>Rol</th>
            <th>Último ingreso</th>
            <th>Estado</th>
            <th>Contraseña</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b align-top">
              <td className="py-2">
                {row.name}
                <span className="block text-xs text-neutral-500">{row.email}</span>
                {row.ownerId && (
                  <span className="block text-xs text-neutral-500">
                    propietario #{row.ownerId} · {row.listingCount} publicación(es)
                  </span>
                )}
              </td>
              <td>
                <ActionForm
                  action={setUserRoleAction}
                  submitLabel="Cambiar"
                  className="flex items-center gap-1"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="userId" value={row.id} />
                  <select
                    name="role"
                    defaultValue={row.role}
                    className="rounded border border-neutral-300 px-1 py-1 text-xs"
                  >
                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              </td>
              <td>{row.lastLoginAt ? formatLocalDateTime(row.lastLoginAt) : "nunca"}</td>
              <td>
                <ActionForm
                  action={setUserActiveAction}
                  submitLabel={row.isActive ? "Desactivar" : "Activar"}
                  className="inline"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="userId" value={row.id} />
                  <input type="hidden" name="isActive" value={row.isActive ? "off" : "on"} />
                </ActionForm>
              </td>
              <td>
                {row.role === "cleaner" ? (
                  <span className="text-xs text-neutral-500">sin cuenta</span>
                ) : (
                  <ActionForm
                    action={setUserPasswordAction}
                    submitLabel="Cambiar"
                    className="flex items-center gap-1"
                    submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <input type="hidden" name="userId" value={row.id} />
                    <input
                      type="password"
                      name="password"
                      placeholder="nueva"
                      className="w-32 rounded border border-neutral-300 px-1 py-1 text-xs"
                    />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="space-y-2">
        <h2 className="font-medium">Nuevo usuario</h2>
        <ActionForm action={createUserAction} submitLabel="Crear usuario">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>Nombre</span>
              <input name="name" required className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Correo</span>
              <input name="email" type="email" required className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span>Rol</span>
              <select name="role" defaultValue="owner" className={inputClass}>
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>Teléfono</span>
              <input name="phone" className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Contraseña</span>
              <input type="password" name="password" className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>Nombre comercial (propietarios)</span>
              <input name="displayName" className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Comisión por defecto %</span>
              <input name="defaultCommissionPct" placeholder="20.00" className={inputClass} />
            </label>
          </div>
        </ActionForm>
      </section>
    </section>
  );
}
