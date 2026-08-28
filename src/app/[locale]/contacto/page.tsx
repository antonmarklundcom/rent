import { setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/action-form";
import { submitLeadForm } from "@/app/actions/public";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

/** Contact form (plan §5.O11) — stored locally, then forwarded to VenderCRM. */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Contacto</h1>
      <p className="text-neutral-600">
        Administramos alojamientos y autos en alquiler en Paraguay. Contanos qué necesitás y
        te respondemos por WhatsApp.
      </p>

      <ActionForm action={submitLeadForm} submitLabel="Enviar">
        <input type="hidden" name="sourceUrl" value="/contacto" />
        <label className="block space-y-1 text-sm">
          <span>Nombre</span>
          <input name="name" required className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="space-y-1">
            <span>WhatsApp</span>
            <input name="phone" type="tel" placeholder="0981 123 456" className={inputClass} />
          </label>
          <label className="space-y-1">
            <span>Correo</span>
            <input name="email" type="email" className={inputClass} />
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span>¿En qué te ayudamos?</span>
          <select name="vertical" className={inputClass}>
            <option value="">consulta general</option>
            <option value="stay">alojamientos</option>
            <option value="car">autos</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Mensaje</span>
          <textarea name="message" rows={4} className={inputClass} />
        </label>
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px]"
        />
      </ActionForm>
    </section>
  );
}
