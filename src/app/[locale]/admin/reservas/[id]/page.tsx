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
  createDepositForm,
  createPaymentLinkForm,
  deductDepositForm,
  markPaymentPaidForm,
  returnDepositForm,
  transitionBookingForm,
} from "@/app/actions/money-forms";
import { ActionForm } from "@/components/action-form";
import { Link } from "@/i18n/navigation";
import { getBookingById, listBookingExtras } from "@/db/queries/bookings";
import { getDepositForBooking, refundedAmount } from "@/db/queries/deposits";
import { documentGateForBooking, listDocumentsForBooking } from "@/db/queries/documents";
import { listInspectionsForBooking } from "@/db/queries/inspections";
import { listScheduledForBooking } from "@/db/queries/messages";
import { listPaymentLinksForBooking, paidTotal } from "@/db/queries/payments";
import { DOCUMENT_TYPES, INSPECTION_TYPES } from "@/db/schema";
import { BOOKING_TRANSITIONS } from "@/lib/booking-state";
import { formatLocalDateTime, waLink } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";
import { ACCEPT_ATTRIBUTE } from "@/lib/uploads";

/**
 * THE booking page (plan §5.O8 + §5.O11).
 *
 * One booking, one route. Phase O-3 opened it for autos protection —
 * inspections, renter documents, the deposit — and phase O-4 extended the same
 * route with the state machine, extras, payment links, the deposit lifecycle
 * and the message sequence, rather than opening a second admin page for the
 * same entity.
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

  const [documents, gate, inspections, deposit, extras, payments, scheduled] =
    await Promise.all([
      listDocumentsForBooking(bookingId),
      documentGateForBooking({ id: bookingId, vertical: row.vertical }),
      listInspectionsForBooking(bookingId),
      getDepositForBooking(bookingId),
      listBookingExtras(bookingId),
      listPaymentLinksForBooking(bookingId),
      listScheduledForBooking(bookingId),
    ]);
  const allowedTransitions = BOOKING_TRANSITIONS[row.booking.status];
  const collected = paidTotal(payments);
  const recorded = new Set(inspections.map((i) => i.inspection.type));
  const missing = INSPECTION_TYPES.filter((type) => !recorded.has(type));

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Reserva {row.booking.reference}</h1>
        <p>
          {row.listingTitle} · {row.vertical === "car" ? "auto" : "alojamiento"} ·{" "}
          {row.booking.guestName}
        </p>
        <p className="text-sm text-neutral-600">
          {row.booking.status} · {formatLocalDateTime(row.booking.startAt)} →{" "}
          {formatLocalDateTime(row.booking.endAt)} ·{" "}
          {formatMoney(row.booking.total, row.booking.currency)}
        </p>
        <p className="text-sm">
          <Link href={`/admin/mensajes/b${bookingId}`} className="text-blue-700 underline">
            conversación
          </Link>
          {row.booking.guestPhone && (
            <>
              {" · "}
              <a
                href={waLink(row.booking.guestPhone, "") ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                WhatsApp {row.booking.guestPhone}
              </a>
            </>
          )}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-medium">Estado de la reserva</h2>
        <p className="text-sm text-neutral-600">
          Precio: {formatMoney(row.booking.baseTotal, row.booking.currency)} base ·{" "}
          {formatMoney(row.booking.extrasTotal, row.booking.currency)} adicionales · −
          {formatMoney(row.booking.discountTotal, row.booking.currency)} descuento ={" "}
          <strong>{formatMoney(row.booking.total, row.booking.currency)}</strong>
          {row.booking.commissionAmount && (
            <>
              {" "}
              · comisión {row.booking.commissionPct}% ={" "}
              {formatMoney(row.booking.commissionAmount, row.booking.currency)}
            </>
          )}
        </p>
        {extras.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-neutral-700">
            {extras.map((extra) => (
              <li key={extra.id}>
                {extra.nameSnapshot} × {extra.qty} ={" "}
                {formatMoney(extra.lineTotal, row.booking.currency)}
              </li>
            ))}
          </ul>
        )}
        {allowedTransitions.length === 0 ? (
          <p className="text-sm text-neutral-500">
            La reserva está en un estado final: no se puede mover.
          </p>
        ) : (
          <ActionForm action={transitionBookingForm} submitLabel="Cambiar estado">
            <input type="hidden" name="bookingId" value={bookingId} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="space-y-1">
                <span>Nuevo estado</span>
                <select
                  name="to"
                  className="w-full rounded border border-neutral-300 px-2 py-1"
                >
                  {allowedTransitions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span>Motivo (opcional)</span>
                <input
                  name="reason"
                  className="w-full rounded border border-neutral-300 px-2 py-1"
                />
              </label>
            </div>
            <p className="text-xs text-neutral-500">
              Confirmar revisa la disponibilidad bajo llave y encola los mensajes; terminar
              crea la tarea de limpieza; cancelar libera el código promocional y retira los
              mensajes que no salieron.
            </p>
          </ActionForm>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Cobros (#8)</h2>
        <p className="text-sm text-neutral-600">
          Cobrado: {formatMoney(collected, row.booking.currency)} de{" "}
          {formatMoney(row.booking.total, row.booking.currency)}
        </p>
        {payments.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Proveedor</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>Link</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((link) => (
                <tr key={link.id} className="border-b">
                  <td className="py-1">{link.provider}</td>
                  <td>{formatMoney(link.amount, link.currency)}</td>
                  <td>{link.status}</td>
                  <td>
                    {link.url ? (
                      <a href={link.url} className="text-blue-700 underline">
                        abrir
                      </a>
                    ) : (
                      (link.reference ?? "—")
                    )}
                  </td>
                  <td>
                    {link.status === "pending" && (
                      <ActionForm
                        action={markPaymentPaidForm}
                        submitLabel="Marcar pagado"
                        className="inline"
                        submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <input type="hidden" name="paymentLinkId" value={link.id} />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details>
          <summary className="cursor-pointer text-sm">Nuevo link de pago</summary>
          <ActionForm action={createPaymentLinkForm} submitLabel="Guardar link">
            <input type="hidden" name="bookingId" value={bookingId} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="space-y-1">
                <span>Proveedor</span>
                <input
                  name="provider"
                  required
                  placeholder="Bancard"
                  className="w-full rounded border border-neutral-300 px-2 py-1"
                />
              </label>
              <label className="space-y-1">
                <span>Monto</span>
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  className="w-full rounded border border-neutral-300 px-2 py-1"
                />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span>URL o referencia</span>
              <input name="url" className="w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Vence</span>
              <input
                type="datetime-local"
                name="expiresAt"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </ActionForm>
        </details>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Documentos del conductor (#16)</h2>
        {!gate.applies ? (
          <p className="text-sm text-neutral-500">
            La verificación de documentos aplica sólo a reservas de autos.
          </p>
        ) : gate.ok ? (
          <p className="rounded bg-green-50 p-2 text-sm text-green-800">
            Documentos en regla: la reserva puede confirmarse.
          </p>
        ) : (
          <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">{gate.message}</p>
        )}

        {documents.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">#</th>
                <th>Tipo</th>
                <th>Archivo</th>
                <th>Estado</th>
                <th>Revisar</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className="border-b align-top">
                  <td className="py-2">{document.id}</td>
                  <td>{tDocType(document.type)}</td>
                  <td>
                    <a href={document.fileUrl} className="text-blue-700 underline">
                      ver
                    </a>
                  </td>
                  <td>
                    {tDocStatus(document.status)}
                    {document.rejectionReason && (
                      <span className="block text-xs text-neutral-500">
                        {document.rejectionReason}
                      </span>
                    )}
                  </td>
                  <td>
                    {document.status === "pending" ? (
                      <div className="space-y-1">
                        <ActionForm
                          action={reviewDocumentAction}
                          submitLabel="Verificar"
                          className="space-y-1"
                          submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                        >
                          <input type="hidden" name="documentId" value={document.id} />
                          <input type="hidden" name="bookingId" value={bookingId} />
                          <input type="hidden" name="status" value="verified" />
                        </ActionForm>
                        <ActionForm
                          action={reviewDocumentAction}
                          submitLabel="Rechazar"
                          className="space-y-1"
                          submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                        >
                          <input type="hidden" name="documentId" value={document.id} />
                          <input type="hidden" name="bookingId" value={bookingId} />
                          <input type="hidden" name="status" value="rejected" />
                          <input
                            name="rejectionReason"
                            placeholder="motivo"
                            required
                            className="w-full rounded border border-neutral-300 px-1 py-1"
                          />
                        </ActionForm>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500">revisado</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <ActionForm action={attachDocumentAction} submitLabel="Cargar documento">
          <input type="hidden" name="bookingId" value={bookingId} />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>Tipo</span>
              <select name="type" className="w-full rounded border border-neutral-300 px-2 py-1">
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tDocType(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>Archivo</span>
              <input type="file" name="file" accept={ACCEPT_ATTRIBUTE} required className="w-full" />
            </label>
          </div>
        </ActionForm>

        {row.booking.status === "inquiry" && !gate.ok && gate.applies && (
          <details className="rounded border border-amber-300 p-2">
            <summary className="cursor-pointer text-sm text-amber-900">
              Confirmar sin verificación (override de administrador — queda registrado)
            </summary>
            <ActionForm action={confirmWithDocumentOverrideAction} submitLabel="Confirmar igual">
              <input type="hidden" name="bookingId" value={bookingId} />
              <label className="block space-y-1 text-sm">
                <span>Motivo</span>
                <input name="reason" required minLength={5} className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
            </ActionForm>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Inspecciones (#5)</h2>
        {inspections.length === 0 && (
          <p className="text-sm text-neutral-500">Todavía no hay inspecciones.</p>
        )}
        {inspections.map(({ inspection, photos }) => (
          <div key={inspection.id} className="rounded border border-neutral-200 p-3 text-sm">
            <p className="font-medium">
              {tInspection(inspection.type)} #{inspection.id}
              {inspection.damageFlag && <span className="ml-2 text-red-600">daño</span>}
            </p>
            <p className="text-neutral-600">
              odómetro: {inspection.odometer ?? "—"} · combustible: {inspection.fuelLevel ?? "—"}%
              {" · "}
              conformidad del huésped: {inspection.confirmedByGuest ? "sí" : "no"}
            </p>
            {inspection.notes && <p>{inspection.notes}</p>}
            {photos.length > 0 && (
              <ul className="mt-2 grid grid-cols-4 gap-2">
                {photos.map((photo) => (
                  <li key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={photo.caption ?? tInspection(inspection.type)}
                      className="aspect-square w-full rounded object-cover"
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-3">
              <ActionForm
                action={uploadInspectionPhotoAction}
                submitLabel="Subir foto"
                className="space-y-1"
                submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
              >
                <input type="hidden" name="inspectionId" value={inspection.id} />
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="file" name="photo" accept={ACCEPT_ATTRIBUTE} required className="text-xs" />
              </ActionForm>
              {!inspection.confirmedByGuest && (
                <ActionForm
                  action={confirmInspectionAction}
                  submitLabel="Registrar conformidad"
                  className="space-y-1"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="inspectionId" value={inspection.id} />
                  <input type="hidden" name="bookingId" value={bookingId} />
                </ActionForm>
              )}
            </div>
          </div>
        ))}

        {missing.map((type) => (
          <details key={type} className="rounded border border-neutral-200 p-2">
            <summary className="cursor-pointer text-sm">
              Registrar inspección de {tInspection(type).toLowerCase()}
            </summary>
            <ActionForm action={recordInspectionAction} submitLabel="Guardar inspección">
              <input type="hidden" name="bookingId" value={bookingId} />
              <input type="hidden" name="type" value={type} />
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="space-y-1">
                  <span>Odómetro</span>
                  <input type="number" name="odometer" min={0} className="w-full rounded border border-neutral-300 px-2 py-1" />
                </label>
                <label className="space-y-1">
                  <span>Combustible %</span>
                  <input type="number" name="fuelLevel" min={0} max={100} className="w-full rounded border border-neutral-300 px-2 py-1" />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span>Notas</span>
                <textarea name="notes" rows={2} className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="damageFlag" className="h-4 w-4" />
                <span>Hay daño</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirmedByGuest" className="h-4 w-4" />
                <span>El huésped firmó conformidad</span>
              </label>
              <fieldset className="space-y-1 rounded border border-neutral-200 p-2 text-sm">
                <legend className="text-xs text-neutral-500">
                  Sólo con daño: abre el ticket (#6) y deduce el depósito (#9) en la misma
                  transacción
                </legend>
                <input name="ticketTitle" placeholder="título del ticket" className="w-full rounded border border-neutral-300 px-2 py-1" />
                <input name="ticketCost" placeholder="costo estimado" inputMode="decimal" className="w-full rounded border border-neutral-300 px-2 py-1" />
                <input name="deductionAmount" placeholder="monto a deducir del depósito" inputMode="decimal" className="w-full rounded border border-neutral-300 px-2 py-1" />
                <input name="deductionReason" placeholder="motivo de la deducción" className="w-full rounded border border-neutral-300 px-2 py-1" />
              </fieldset>
            </ActionForm>
          </details>
        ))}
      </section>

      <section className="space-y-1">
        <h2 className="font-medium">Depósito (#9)</h2>
        {deposit ? (
          <p className="text-sm">
            {formatMoney(deposit.amount, deposit.currency)} · {deposit.status}
            {deposit.status !== "held" && (
              <>
                {" · "}deducido {formatMoney(deposit.deductionAmount ?? 0, deposit.currency)} ·
                devuelto {formatMoney(refundedAmount(deposit), deposit.currency)}
              </>
            )}
            {deposit.deductionReason && (
              <span className="block text-xs text-neutral-500">{deposit.deductionReason}</span>
            )}
            {deposit.inspectionId && (
              <span className="block text-xs text-neutral-500">
                inspección #{deposit.inspectionId}
                {deposit.maintenanceTicketId ? ` · ticket #${deposit.maintenanceTicketId}` : ""}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-neutral-500">Esta reserva no tiene depósito registrado.</p>
        )}

        {!deposit ? (
          <ActionForm action={createDepositForm} submitLabel="Registrar depósito retenido">
            <input type="hidden" name="bookingId" value={bookingId} />
            <label className="block space-y-1 text-sm">
              <span>Monto</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                className="w-40 rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </ActionForm>
        ) : deposit.status === "held" ? (
          <div className="space-y-2">
            <ActionForm
              action={returnDepositForm}
              submitLabel="Devolver el depósito completo"
              className="inline"
              submitClassName="rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50"
            >
              <input type="hidden" name="depositId" value={deposit.id} />
            </ActionForm>
            <details>
              <summary className="cursor-pointer text-sm">Deducir una parte</summary>
              <ActionForm action={deductDepositForm} submitLabel="Aplicar deducción">
                <input type="hidden" name="depositId" value={deposit.id} />
                <label className="block space-y-1 text-sm">
                  <span>Monto a deducir</span>
                  <input
                    name="deductionAmount"
                    required
                    inputMode="decimal"
                    className="w-40 rounded border border-neutral-300 px-2 py-1"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Motivo</span>
                  <input
                    name="reason"
                    required
                    className="w-full rounded border border-neutral-300 px-2 py-1"
                  />
                </label>
                <p className="text-xs text-neutral-500">
                  Una deducción por daño se hace mejor desde la inspección de devolución: ahí
                  el ticket, el gasto y la deducción se graban juntos.
                </p>
              </ActionForm>
            </details>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">
            El depósito ya está liquidado. Una corrección se hace con un registro nuevo, no
            reescribiendo este.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <h2 className="font-medium">Secuencia de mensajes (#4)</h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Sin mensajes encolados. Se encolan solos cuando la reserva se confirma.
          </p>
        ) : (
          <ul className="space-y-0.5 text-sm text-neutral-700">
            {scheduled.map((message) => (
              <li key={message.id}>
                {message.templateKey} · {message.status} ·{" "}
                {formatLocalDateTime(message.sendAfter)}
                {message.sentAt ? ` · enviado ${formatLocalDateTime(message.sentAt)}` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          <Link href="/admin/mensajes" className="text-blue-700 underline">
            ir al outbox
          </Link>
        </p>
      </section>
    </section>
  );
}
