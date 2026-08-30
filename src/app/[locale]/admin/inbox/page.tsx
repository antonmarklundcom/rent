import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Bandeja unificada"
        subtitle={
          <>
            {threads.filter((thread) => thread.awaitingReply).length} conversación(es) esperando
            respuesta.
            {!isDraftingConfigured() && (
              <span className="mt-1 block text-amber-700">
                El borrador automático está desactivado: falta ANTHROPIC_API_KEY.
              </span>
            )}
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-[20rem_1fr]">
        <section className="card--raised card--hair max-h-[70vh] overflow-y-auto rounded-lg">
          {threads.length === 0 && (
            <p className="p-4 text-sm text-ink/50">Todavía no hay mensajes registrados.</p>
          )}
          <ul className="divide-y divide-ink/8 text-sm">
            {threads.map((thread) => (
              <li key={thread.key} className={thread.key === openKey ? "bg-accent/[0.06]" : ""}>
                <a href={`?hilo=${encodeURIComponent(thread.key)}`} className="block px-4 py-3">
                  <span className="flex items-center gap-1.5 font-medium">
                    {thread.awaitingReply && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    {thread.contactName ?? "Sin nombre"}
                  </span>
                  <span className="block text-xs text-ink/50">
                    {thread.reference ? `${thread.reference} · ` : ""}
                    {thread.listingTitle ?? "Sin publicación"} · {when(thread.lastAt)}
                  </span>
                  <span className="mt-0.5 block truncate text-ink/70">{thread.lastBody}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          {!open ? (
            <p className="text-sm text-ink/50">Elegí una conversación.</p>
          ) : (
            <>
              <h2 className="text-lg font-medium">
                {open.contactName ?? "Conversación"}
                {open.bookingId && (
                  <>
                    {" · "}
                    <Link href={`/admin/reservas/${open.bookingId}`} className="text-accent hover:underline">
                      {open.reference}
                    </Link>
                  </>
                )}
              </h2>
              <ul className="max-h-[45vh] space-y-2 overflow-y-auto text-sm">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={`max-w-[85%] rounded-md p-3 ${
                      message.direction === "inbound"
                        ? "bg-ink/[0.04]"
                        : "ml-auto bg-accent/10"
                    }`}
                  >
                    <p className="text-xs text-ink/50">
                      {message.direction === "inbound" ? "Huésped" : "Nosotros"} · {when(message.createdAt)}
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
    </div>
  );
}
