import { ActionForm } from "@/components/action-form";
import { fieldClass, labelClass } from "@/components/ui/field";
import { PageHeader, Section } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Plantillas de mensajes"
        subtitle={`Variables disponibles: ${TEMPLATE_PLACEHOLDERS.map((key) => `{{${key}}}`).join(" · ")}`}
      />

      <div className="space-y-4">
        {templates.map((template) => {
          const used = placeholdersIn(template.body);
          const unknown = used.filter(
            (key) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key),
          );
          return (
            <Section
              key={template.id}
              title={template.label}
              eyebrow={template.key}
              description={
                <>
                  {isMessageEvent(template.triggerEvent)
                    ? `Se agenda ${offsetLabel(template.offsetMinutes)} de ${
                        ANCHOR_LABEL[anchorFor(template.triggerEvent)]
                      }`
                    : "Sin evento: no se agenda sola, es un texto para copiar"}
                  {template.vertical ? ` · sólo ${template.vertical}` : " · ambas verticales"}
                </>
              }
            >
              {unknown.length > 0 && (
                <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">
                  Variables desconocidas (se van a renderizar vacías): {unknown.join(", ")}
                </p>
              )}
              <ActionForm action={updateTemplateAction} submitLabel="Guardar plantilla">
                <input type="hidden" name="templateId" value={template.id} />
                <label className={labelClass}>
                  <span className="text-ink/70">Nombre</span>
                  <input name="label" defaultValue={template.label} className={fieldClass} />
                </label>
                <label className={labelClass}>
                  <span className="text-ink/70">Texto</span>
                  <textarea
                    name="body"
                    rows={5}
                    defaultValue={template.body}
                    className={`${fieldClass} font-mono`}
                  />
                </label>
                <div className="flex flex-wrap items-end gap-4">
                  <label className={labelClass}>
                    <span className="text-ink/70">Desfase (minutos)</span>
                    <input
                      type="number"
                      name="offsetMinutes"
                      defaultValue={template.offsetMinutes}
                      className={`${fieldClass} w-32`}
                    />
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      name="isActive"
                      value="1"
                      defaultChecked={template.isActive}
                      className="h-4 w-4 accent-accent"
                    />
                    Activa
                  </label>
                </div>
              </ActionForm>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
