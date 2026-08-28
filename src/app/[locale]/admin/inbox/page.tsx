import { Link } from "@/i18n/navigation";
import { listInboxThreads, listThreadMessages } from "@/db/queries/messages";
import { isDraftingConfigured } from "@/lib/ai-draft";
import { requireAdminPage } from "@/lib/page-guards";
import { ThreadReply } from "./thread-reply";

/**
 * Unified inbox (plan §5.O9, feature #20).
 *
 * One row per thread across every listing and booking, newest first, with the
 * AI-draft button inline. v1 has no WhatsApp API (plan §1.5), so what shows up
 * here is what operators log — the value is that it is ONE place, searchable,
 * attached to the booking, instead of five phones.
 */
function when(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const query = await searchParams;
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const threads = await listInboxThreads({ limit: 100 });
  const openKey = one("hilo") ?? threads[0]?.key ?? null;
  const open = threads.find((thread) => thread.key === openKey) ?? null;
  const messages = open
    ? await listThreadMessages({ bookingId: open.bookingId, listingId: open.listingId })
    : [];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Bandeja unificada</h1>
        <p className="text-sm text-neutral-600">
          {threads.filter((thread) => thread.awaitingReply).length} conversación(es) esperando
          respuesta.
        </p>
        {!isDraftingConfigured() && (
          <p className="text-sm text-amber-700">
            El borrador automático está desactivado: falta ANTHROPIC_API_KEY.
          </p>
        )}
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <section className="space-y-1">
          <h2 className="font-medium">Conversaciones</h2>
          <ul className="text-sm">
            {threads.length === 0 && (
              <li className="text-neutral-600">Todavía no hay mensajes registrados.</li>
            )}
            {threads.map((thread) => (
              <li
                key={thread.key}
                className={`border-b py-2 ${thread.key === openKey ? "bg-neutral-100" : ""}`}
              >
                <a href={`?hilo=${encodeURIComponent(thread.key)}`} className="block">
                  <span className="font-medium">
                    {thread.awaitingReply ? "● " : ""}
                    {thread.contactName ?? "Sin nombre"}
                  </span>
                  <span className="block text-xs text-neutral-500">
                    {thread.reference ? `${thread.reference} · ` : ""}
                    {thread.listingTitle ?? "Sin publicación"} · {when(thread.lastAt)} ·{" "}
                    {thread.total} mensaje(s)
                  </span>
                  <span className="block truncate text-neutral-700">{thread.lastBody}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          {!open ? (
            <p className="text-sm text-neutral-600">Elegí una conversación.</p>
          ) : (
            <>
              <h2 className="font-medium">
                {open.contactName ?? "Conversación"}
                {open.bookingId && (
                  <>
                    {" · "}
                    <Link
                      href={`/admin/reservas/${open.bookingId}`}
                      className="text-blue-700 underline"
                    >
                      {open.reference}
                    </Link>
                  </>
                )}
              </h2>
              <ul className="space-y-2 text-sm">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={`border p-2 ${
                      message.direction === "inbound" ? "bg-neutral-50" : "bg-white"
                    }`}
                  >
                    <p className="text-xs text-neutral-500">
                      {message.direction === "inbound" ? "Huésped" : "Nosotros"} ·{" "}
                      {when(message.createdAt)}
                      {message.aiDrafted ? " · borrador IA aprobado" : ""}
                    </p>
                    <p className="whitespace-pre-wrap">{message.body}</p>
                  </li>
                ))}
              </ul>

              <ThreadReply
                bookingId={open.bookingId}
                listingId={open.listingId}
                contactName={open.contactName}
                contactPhone={open.contactPhone}
                draftingEnabled={isDraftingConfigured()}
              />
            </>
          )}
        </section>
      </div>
    </section>
  );
}
