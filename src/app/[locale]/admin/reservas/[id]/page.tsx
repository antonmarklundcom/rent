import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  attachDocumentAction,
  confirmInspectionAction,
  confirmWithDocumentOverrideAction,
  recordInspectionAction,
  reviewDocumentAction,
  uploadInspectionPhotoAction,
} from "@/app/actions/autos";
import {
  createPaymentLinkFormAction,
  markPaymentLinkPaidFormAction,
} from "@/app/actions/money";
import { enqueueForBookingAction } from "@/app/actions/comms";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  bookingStatusTone,
  depositStatusTone,
  documentStatusTone,
  messageStatusTone,
  paymentStatusTone,
} from "@/components/ui/badge";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
import { getBookingById } from "@/db/queries/bookings";
import { getDepositForBooking, refundedAmount } from "@/db/queries/deposits";
import { documentGateForBooking, listDocumentsForBooking } from "@/db/queries/documents";
import { listInspectionsForBooking } from "@/db/queries/inspections";
import { listPaymentLinksForBooking, paidTotal } from "@/db/queries/payments";
import { listOutbox, listThreadMessages } from "@/db/queries/messages";
import { DOCUMENT_TYPES, INSPECTION_TYPES } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";
import { ACCEPT_ATTRIBUTE } from "@/lib/uploads";

/**
 * Per-booking autos protection (#5, #9, #16 — plan §5.O8).
 *
 * Handover inspections, renter documents and the deposit for ONE booking, plus
 * the document gate's current verdict and — for a car whose papers are not in
 * order — the logged admin override.
 *
 * Phase O-4 builds the general booking admin (§5.O11); it should EXTEND this
 * route rather than open a second one for the same entity.
 */
export default async function AdminBookingOpsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) notFound();

  const row = await getBookingById(bookingId);
  if (!row) notFound();

  const tDocType = await getTranslations("documentType");
  const tDocStatus = await getTranslations("documentStatus");
  const tInspection = await getTranslations("inspectionType");

  const [documents, gate, inspections, deposit, payments, queued, thread] =
    await Promise.all([
      listDocumentsForBooking(bookingId),
      documentGateForBooking({ id: bookingId, vertical: row.vertical }),
      listInspectionsForBooking(bookingId),
      getDepositForBooking(bookingId),
      listPaymentLinksForBooking(bookingId),
      listOutbox({ statuses: ["scheduled", "due", "sent", "cancelled"], bookingId }),
      listThreadMessages({ bookingId }),
    ]);

  const recorded = new Set(inspections.map((i) => i.inspection.type));
  const missing = INSPECTION_TYPES.filter((type) => !recorded.has(type));

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Reserva ${row.booking.reference}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {row.listingTitle} · {row.vertical === "car" ? "auto" : "alojamiento"} ·{" "}
            {row.booking.guestName}
            <Badge tone={bookingStatusTone(row.booking.status)}>{row.booking.status}</Badge>
            <span className="text-ink/50">
              {row.booking.startAt.toISOString().slice(0, 16).replace("T", " ")} →{" "}
              {row.booking.endAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
              {formatMoney(row.booking.total, row.booking.currency)}
            </span>
          </span>
        }
      />

      <Section title="Documentos del conductor (#16)">
        {!gate.applies ? (
          <p className="text-sm text-ink/50">
            La verificación de documentos aplica sólo a reservas de autos.
          </p>
        ) : gate.ok ? (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            Documentos en regla: la reserva puede confirmarse.
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{gate.message}</p>
        )}

        {documents.length > 0 && (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Archivo</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Revisar</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td className={td}>{document.id}</td>
                    <td className={td}>{tDocType(document.type)}</td>
                    <td className={td}>
                      <a href={document.fileUrl} className="text-accent hover:underline">
                        ver
                      </a>
                    </td>
                    <td className={td}>
                      <Badge tone={documentStatusTone(document.status)}>{tDocStatus(document.status)}</Badge>
                      {document.rejectionReason && (
                        <span className="mt-1 block text-xs text-ink/50">{document.rejectionReason}</span>
                      )}
                    </td>
                    <td className={td}>
                      {document.status === "pending" ? (
                        <div className="flex flex-wrap items-start gap-2">
                          <ActionForm
                            action={reviewDocumentAction}
                            submitLabel="Verificar"
                            className="shrink-0"
                            submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
                          >
                            <input type="hidden" name="documentId" value={document.id} />
                            <input type="hidden" name="bookingId" value={bookingId} />
                            <input type="hidden" name="status" value="verified" />
                          </ActionForm>
                          <ActionForm
                            action={reviewDocumentAction}
                            submitLabel="Rechazar"
                            className="flex flex-wrap items-center gap-1"
                            submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                          >
                            <input type="hidden" name="documentId" value={document.id} />
                            <input type="hidden" name="bookingId" value={bookingId} />
                            <input type="hidden" name="status" value="rejected" />
                            <input
                              name="rejectionReason"
                              placeholder="motivo"
                              required
                              className="w-32 rounded-sm border border-ink/15 px-1.5 py-1 text-xs"
                            />
                          </ActionForm>
                        </div>
                      ) : (
                        <span className="text-xs text-ink/45">revisado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        <ActionForm action={attachDocumentAction} submitLabel="Cargar documento">
          <input type="hidden" name="bookingId" value={bookingId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className="text-ink/70">Tipo</span>
              <select name="type" className={fieldClass}>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tDocType(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Archivo</span>
              <input type="file" name="file" accept={ACCEPT_ATTRIBUTE} required className={fieldClass} />
            </label>
          </div>
        </ActionForm>

        {row.booking.status === "inquiry" && !gate.ok && gate.applies && (
          <details className="rounded-md border border-amber-300 bg-amber-50/40 p-3">
            <summary className="cursor-pointer text-sm font-medium text-amber-900">
              Confirmar sin verificación (override de administrador — queda registrado)
            </summary>
            <div className="mt-3">
              <ActionForm action={confirmWithDocumentOverrideAction} submitLabel="Confirmar igual">
                <input type="hidden" name="bookingId" value={bookingId} />
                <label className={labelClass}>
                  <span className="text-ink/70">Motivo</span>
                  <input name="reason" required minLength={5} className={fieldClass} />
                </label>
              </ActionForm>
            </div>
          </details>
        )}
      </Section>

      <Section title="Inspecciones (#5)">
        {inspections.length === 0 && <p className="text-sm text-ink/50">Todavía no hay inspecciones.</p>}
        {inspections.map(({ inspection, photos }) => (
          <div key={inspection.id} className="rounded-md border border-ink/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {tInspection(inspection.type)} #{inspection.id}
              {inspection.damageFlag && <Badge tone="critical">daño</Badge>}
            </p>
            <p className="text-ink/60">
              odómetro: {inspection.odometer ?? "—"} · combustible: {inspection.fuelLevel ?? "—"}%
              {" · "}
              conformidad del huésped: {inspection.confirmedByGuest ? "sí" : "no"}
            </p>
            {inspection.notes && <p className="mt-1">{inspection.notes}</p>}
            {photos.length > 0 && (
              <ul className="mt-2 grid grid-cols-4 gap-2">
                {photos.map((photo) => (
                  <li key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={photo.caption ?? tInspection(inspection.type)}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <ActionForm
                action={uploadInspectionPhotoAction}
                submitLabel="Subir foto"
                className="flex flex-wrap items-center gap-2"
                submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
              >
                <input type="hidden" name="inspectionId" value={inspection.id} />
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="file" name="photo" accept={ACCEPT_ATTRIBUTE} required className="text-xs" />
              </ActionForm>
              {!inspection.confirmedByGuest && (
                <ActionForm
                  action={confirmInspectionAction}
                  submitLabel="Registrar conformidad"
                  className="shrink-0"
                  submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                >
                  <input type="hidden" name="inspectionId" value={inspection.id} />
                  <input type="hidden" name="bookingId" value={bookingId} />
                </ActionForm>
              )}
            </div>
          </div>
        ))}

        {missing.map((type) => (
          <details key={type} className="rounded-md border border-ink/10 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Registrar inspección de {tInspection(type).toLowerCase()}
            </summary>
            <div className="mt-3">
              <ActionForm action={recordInspectionAction} submitLabel="Guardar inspección">
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="type" value={type} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    <span className="text-ink/70">Odómetro</span>
                    <input type="number" name="odometer" min={0} className={fieldClass} />
                  </label>
                  <label className={labelClass}>
                    <span className="text-ink/70">Combustible %</span>
                    <input type="number" name="fuelLevel" min={0} max={100} className={fieldClass} />
                  </label>
                </div>
                <label className={labelClass}>
                  <span className="text-ink/70">Notas</span>
                  <textarea name="notes" rows={2} className={fieldClass} />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="damageFlag" className="h-4 w-4 accent-accent" />
                  <span>Hay daño</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="confirmedByGuest" className="h-4 w-4 accent-accent" />
                  <span>El huésped firmó conformidad</span>
                </label>
                <fieldset className="space-y-2 rounded-md border border-ink/10 p-3 text-sm">
                  <legend className="px-1 text-xs text-ink/50">
                    Sólo con daño: abre el ticket (#6) y deduce el depósito (#9) en la misma
                    transacción
                  </legend>
                  <input name="ticketTitle" placeholder="título del ticket" className={fieldClass} />
                  <input name="ticketCost" placeholder="costo estimado" inputMode="decimal" className={fieldClass} />
                  <input name="deductionAmount" placeholder="monto a deducir del depósito" inputMode="decimal" className={fieldClass} />
                  <input name="deductionReason" placeholder="motivo de la deducción" className={fieldClass} />
                </fieldset>
              </ActionForm>
            </div>
          </details>
        ))}
      </Section>

      <Section title="Depósito (#9)">
        {deposit ? (
          <p className="text-sm">
            <span className="font-medium">{formatMoney(deposit.amount, deposit.currency)}</span>{" "}
            <Badge tone={depositStatusTone(deposit.status)}>{deposit.status}</Badge>
            {deposit.status !== "held" && (
              <span className="block text-ink/60">
                deducido {formatMoney(deposit.deductionAmount ?? 0, deposit.currency)} · devuelto{" "}
                {formatMoney(refundedAmount(deposit), deposit.currency)}
              </span>
            )}
            {deposit.deductionReason && (
              <span className="block text-xs text-ink/50">{deposit.deductionReason}</span>
            )}
            {deposit.inspectionId && (
              <span className="block text-xs text-ink/50">
                inspección #{deposit.inspectionId}
                {deposit.maintenanceTicketId ? ` · ticket #${deposit.maintenanceTicketId}` : ""}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-ink/50">Esta reserva no tiene depósito registrado.</p>
        )}
      </Section>

      <Section
        title="Links de pago (#8)"
        description={`Cobrado hasta ahora: ${formatMoney(paidTotal(payments), row.booking.currency)} de ${formatMoney(row.booking.total, row.booking.currency)}`}
      >
        {payments.length > 0 && (
          <ul className="divide-y divide-ink/8 text-sm">
            {payments.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {link.provider} · {formatMoney(link.amount, link.currency)} ·{" "}
                  <Badge tone={paymentStatusTone(link.status)}>{link.status}</Badge>
                  {link.expiresAt ? ` · vence ${link.expiresAt.toISOString().slice(0, 10)}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  {link.url && (
                    <a href={link.url} rel="noopener" className="text-accent hover:underline">
                      abrir
                    </a>
                  )}
                  {link.status === "pending" && (
                    <ActionForm
                      action={markPaymentLinkPaidFormAction}
                      submitLabel="Marcar pagado"
                      className="inline"
                      submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
                    >
                      <input type="hidden" name="paymentLinkId" value={link.id} />
                    </ActionForm>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createPaymentLinkFormAction} submitLabel="Registrar link">
          <input type="hidden" name="bookingId" value={bookingId} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <input
              name="provider"
              required
              placeholder="Bancard / transferencia"
              className={fieldClass}
            />
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="monto"
              className={fieldClass}
            />
            <input name="url" placeholder="https://... (opcional)" className={fieldClass} />
            <input name="reference" placeholder="referencia (opcional)" className={fieldClass} />
            <input type="datetime-local" name="expiresAt" className={fieldClass} />
          </div>
          <p className="text-xs text-ink/50">
            v1 no integra la pasarela: se guarda el link y su estado, y se marca pagado a mano.
            Las fechas se interpretan en UTC.
          </p>
        </ActionForm>
      </Section>

      <Section title="Mensajes (#4)">
        {queued.length === 0 ? (
          <EmptyState>
            Esta reserva todavía no tiene mensajes agendados. Se agendan al confirmarla.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {queued.map((message) => (
              <li key={message.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {message.sendAfter.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                  {message.label ?? message.templateKey}
                </span>
                <Badge tone={messageStatusTone(message.status)}>{message.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        <ActionForm
          action={enqueueForBookingAction}
          submitLabel="Reagendar la secuencia"
          submitClassName="rounded-sm border border-ink/20 px-3 py-1.5 text-sm hover:border-ink/40 disabled:opacity-50"
        >
          <input type="hidden" name="bookingId" value={bookingId} />
          <p className="text-xs text-ink/50">
            Completa lo que falte; nunca duplica lo que ya está agendado.
          </p>
        </ActionForm>
        {thread.length > 0 && (
          <p className="text-sm">
            {thread.length} mensaje(s) registrados en la conversación —{" "}
            <a href={`/admin/inbox?hilo=booking:${bookingId}`} className="font-medium text-accent hover:underline">
              abrir en la bandeja →
            </a>
          </p>
        )}
      </Section>
    </div>
  );
}
