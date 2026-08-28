import { ActionForm } from "@/components/action-form";
import { updateTemplateAction } from "@/app/actions/comms";
import { listTemplates } from "@/db/queries/messages";
import { anchorFor, isMessageEvent, placeholdersIn, TEMPLATE_PLACEHOLDERS } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Message templates (plan §5.O9, feature #4/#11).
 *
 * Editing a template changes what FUTURE bookings get queued. Messages already
 * in the outbox keep the body they were rendered with — `rendered_body` is a
 * snapshot on purpose, so what an operator reviewed is what the guest gets.
 */
const ANCHOR_LABEL: Record<string, string> = {
  confirmed_at: "la confirmación",
  start_at: "el check-in",
  end_at: "el check-out",
};

function offsetLabel(minutes: number): string {
  if (minutes === 0) return "en el momento";
  const hours = Math.round(Math.abs(minutes) / 60);
  const unit = hours % 24 === 0 ? `${hours / 24} día(s)` : `${hours} hora(s)`;
  return minutes < 0 ? `${unit} antes` : `${unit} después`;
}

export default async function AdminTemplatesPage() {
  await requireAdminPage();
  const templates = await listTemplates({ locale: "es" });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Plantillas de mensajes</h1>
        <p className="text-sm text-neutral-600">
          Variables disponibles:{" "}
          {TEMPLATE_PLACEHOLDERS.map((key) => `{{${key}}}`).join(" · ")}
        </p>
      </header>

      {templates.map((template) => {
        const used = placeholdersIn(template.body);
        const unknown = used.filter(
          (key) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key),
        );
        return (
          <article key={template.id} className="space-y-2 border border-neutral-300 p-3">
            <h2 className="font-medium">
              {template.label}{" "}
              <span className="text-xs text-neutral-500">({template.key})</span>
            </h2>
            <p className="text-xs text-neutral-500">
              {isMessageEvent(template.triggerEvent)
                ? `Se agenda ${offsetLabel(template.offsetMinutes)} de ${
                    ANCHOR_LABEL[anchorFor(template.triggerEvent)]
                  }`
                : "Sin evento: no se agenda sola, es un texto para copiar"}
              {template.vertical ? ` · sólo ${template.vertical}` : " · ambas verticales"}
            </p>
            {unknown.length > 0 && (
              <p className="text-xs text-red-600">
                Variables desconocidas (se van a renderizar vacías): {unknown.join(", ")}
              </p>
            )}
            <ActionForm action={updateTemplateAction} submitLabel="Guardar plantilla">
              <input type="hidden" name="templateId" value={template.id} />
              <label className="flex flex-col text-sm">
                Nombre
                <input name="label" defaultValue={template.label} className="border p-1" />
              </label>
              <label className="flex flex-col text-sm">
                Texto
                <textarea
                  name="body"
                  rows={5}
                  defaultValue={template.body}
                  className="border p-1 font-mono"
                />
              </label>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex flex-col">
                  Desfase (minutos)
                  <input
                    type="number"
                    name="offsetMinutes"
                    defaultValue={template.offsetMinutes}
                    className="w-32 border p-1"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="isActive"
                    value="1"
                    defaultChecked={template.isActive}
                  />
                  Activa
                </label>
              </div>
            </ActionForm>
          </article>
        );
      })}
    </section>
  );
}
