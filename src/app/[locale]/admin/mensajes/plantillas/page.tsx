import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { saveTemplateAction } from "@/app/actions/messages";
import { listTemplates } from "@/db/queries/messages";
import { MESSAGE_ANCHORS, TEMPLATE_PLACEHOLDERS, placeholdersUsed } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

const ANCHOR_LABEL: Record<string, string> = {
  confirmed: "al confirmar",
  start_at: "respecto de la llegada",
  end_at: "respecto de la salida",
};

function offsetLabel(minutes: number): string {
  if (minutes === 0) return "en el momento";
  const abs = Math.abs(minutes);
  const unit = abs % 1440 === 0 ? `${abs / 1440} día(s)` : `${abs / 60} h`;
  return minutes < 0 ? `${unit} antes` : `${unit} después`;
}

/** Message templates (#4, #11 — plan §5.O9). Seeded by `npm run seed`. */
export default async function TemplatesPage() {
  await requireAdminPage();
  const templates = await listTemplates();

  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/mensajes" className="text-sm text-blue-700 underline">
          ← Mensajes
        </Link>
        <h1 className="text-2xl font-semibold">Plantillas de mensajes</h1>
        <p className="text-sm text-neutral-600">
          Se encolan solas cuando una reserva se confirma. Variables disponibles:{" "}
          {TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")}
        </p>
      </div>

      <ul className="space-y-3">
        {templates.map((template) => (
          <li key={template.id} className="space-y-2 rounded border border-neutral-300 p-3">
            <div className="text-sm">
              <strong>{template.label}</strong>{" "}
              <code className="text-xs text-neutral-500">{template.key}</code>
              <span className="block text-xs text-neutral-500">
                {ANCHOR_LABEL[template.triggerEvent ?? ""] ?? template.triggerEvent} ·{" "}
                {offsetLabel(template.offsetMinutes)} ·{" "}
                {template.vertical ? `sólo ${template.vertical}` : "ambos verticales"} ·{" "}
                {template.isActive ? "activa" : "inactiva"}
              </span>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">Ver y editar</summary>
              <ActionForm action={saveTemplateAction} submitLabel="Guardar plantilla">
                <input type="hidden" name="key" value={template.key} />
                <label className="block space-y-1 text-sm">
                  <span>Nombre</span>
                  <input
                    name="label"
                    defaultValue={template.label}
                    required
                    className="w-full rounded border border-neutral-300 px-2 py-1"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Texto</span>
                  <textarea
                    name="body"
                    rows={8}
                    defaultValue={template.body}
                    required
                    className="w-full rounded border border-neutral-300 px-2 py-1 font-mono text-xs"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <label className="space-y-1">
                    <span>Referencia</span>
                    <select
                      name="anchor"
                      defaultValue={template.triggerEvent ?? "confirmed"}
                      className="w-full rounded border border-neutral-300 px-2 py-1"
                    >
                      {MESSAGE_ANCHORS.map((anchor) => (
                        <option key={anchor} value={anchor}>
                          {ANCHOR_LABEL[anchor]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span>Minutos</span>
                    <input
                      type="number"
                      name="offsetMinutes"
                      defaultValue={template.offsetMinutes}
                      className="w-full rounded border border-neutral-300 px-2 py-1"
                    />
                  </label>
                  <label className="space-y-1">
                    <span>Vertical</span>
                    <select
                      name="vertical"
                      defaultValue={template.vertical ?? ""}
                      className="w-full rounded border border-neutral-300 px-2 py-1"
                    >
                      <option value="">ambos</option>
                      <option value="stay">alojamientos</option>
                      <option value="car">autos</option>
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={template.isActive}
                  />
                  <span>Activa</span>
                </label>
                <p className="text-xs text-neutral-500">
                  Usa: {placeholdersUsed(template.body).map((p) => `{{${p}}}`).join(" ") || "—"}
                </p>
              </ActionForm>
            </details>
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="font-medium">Nueva plantilla</h2>
        <ActionForm action={saveTemplateAction} submitLabel="Crear plantilla">
          <label className="block space-y-1 text-sm">
            <span>Clave (minúsculas y guión bajo)</span>
            <input
              name="key"
              required
              placeholder="mid_stay_check"
              className="w-full rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Nombre</span>
            <input name="label" required className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Texto</span>
            <textarea
              name="body"
              rows={6}
              required
              className="w-full rounded border border-neutral-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span>Referencia</span>
              <select name="anchor" className="w-full rounded border border-neutral-300 px-2 py-1">
                {MESSAGE_ANCHORS.map((anchor) => (
                  <option key={anchor} value={anchor}>
                    {ANCHOR_LABEL[anchor]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>Minutos</span>
              <input
                type="number"
                name="offsetMinutes"
                defaultValue={0}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="space-y-1">
              <span>Vertical</span>
              <select name="vertical" className="w-full rounded border border-neutral-300 px-2 py-1">
                <option value="">ambos</option>
                <option value="stay">alojamientos</option>
                <option value="car">autos</option>
              </select>
            </label>
          </div>
        </ActionForm>
      </section>
    </section>
  );
}
