import { getTranslations } from "next-intl/server";
import {
  cleanerAdvanceAction,
  cleanerUpdateChecklistAction,
  cleanerUploadPhotoAction,
} from "@/app/actions/cleaner";
import { ActionForm } from "@/components/action-form";
import { Badge, cleaningStatusTone } from "@/components/ui/badge";
import { checklistProgress, nextCleaningStatus } from "@/lib/cleaning";
import { resolveMagicTaskView } from "@/lib/magic-link";
import { ACCEPT_ATTRIBUTE } from "@/lib/uploads";

/**
 * Cleaner task page (#1). Reached only through a tokenized URL — no login, no
 * session, no role check: the token IS the credential (plan §2).
 *
 * Mobile-first and deliberately chunky: this is used one-handed, standing in a
 * flat, on a cheap Android in patchy signal. Every control is a plain form
 * post, so it works with JavaScript still loading.
 */
export default async function CleanerTaskPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("cleaner");
  const tStatus = await getTranslations("cleaningStatus");
  const view = await resolveMagicTaskView(token);

  if (!view) {
    return (
      <section className="mx-auto max-w-md py-10 text-center">
        <p className="rounded-lg border border-red-200 bg-red-50 p-6 text-lg font-medium text-red-700">
          {t("invalid")}
        </p>
      </section>
    );
  }

  const { task, listingTitle, photos } = view;
  const checklist = task.checklist ?? [];
  const progress = checklistProgress(checklist);
  const next = nextCleaningStatus(task.status);
  const itemKeys = checklist.map((item) => item.key).join(",");

  return (
    <section className="mx-auto max-w-md space-y-6 pb-16">
      <header className="card--raised card--hair space-y-2 rounded-lg p-5">
        <p className="eyebrow">{t("title")}</p>
        <h1 className="font-display text-3xl italic leading-tight">{listingTitle}</h1>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge tone={cleaningStatusTone(task.status)} className="text-sm">
            {tStatus(task.status)}
          </Badge>
          {task.dueBy && (
            <span className="text-sm text-ink/60">
              {t("dueBy")}: {new Date(task.dueBy).toISOString().slice(0, 16).replace("T", " ")}
            </span>
          )}
        </div>
        {task.notes && (
          <p className="rounded-md bg-ink/[0.04] p-3 text-sm">
            {t("notes")}: {task.notes}
          </p>
        )}
      </header>

      {checklist.length > 0 && (
        <section className="card--raised card--hair space-y-3 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{t("checklist")}</h2>
            <span className="text-sm font-medium text-ink/60">{t("progress", progress)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/[0.08]">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <ActionForm action={cleanerUpdateChecklistAction} submitLabel={t("saveChecklist")}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="itemKeys" value={itemKeys} />
            <ul className="space-y-2">
              {checklist.map((item) => (
                <li key={item.key}>
                  <label className="flex min-h-14 items-center gap-4 rounded-md border border-ink/12 px-4 py-3 text-lg active:bg-ink/[0.04]">
                    <input
                      type="checkbox"
                      name={`item:${item.key}`}
                      defaultChecked={item.done}
                      disabled={task.status === "ready"}
                      className="h-7 w-7 shrink-0 accent-accent"
                    />
                    <span>{item.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </ActionForm>
        </section>
      )}

      <section className="card--raised card--hair space-y-3 rounded-lg p-5">
        <h2 className="text-lg font-medium">{t("photos")}</h2>
        <ActionForm action={cleanerUploadPhotoAction} submitLabel={t("uploadPhoto")}>
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-ink/60">{t("photoHint")}</p>
          <label className="flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-accent/40 bg-accent/5 px-4 font-medium text-accent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {t("uploadPhoto")}
            <input
              type="file"
              name="photo"
              accept={ACCEPT_ATTRIBUTE}
              capture="environment"
              required
              className="sr-only"
            />
          </label>
          <input
            type="text"
            name="caption"
            placeholder={t("caption")}
            className="w-full rounded-sm border border-ink/15 bg-surface px-3 py-3 focus:border-accent focus:outline-none"
          />
        </ActionForm>
        {photos.length === 0 ? (
          <p className="text-sm text-ink/45">{t("noPhotos")}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <li key={photo.id}>
                <img
                  src={photo.url}
                  alt={photo.caption ?? listingTitle}
                  className="aspect-square w-full rounded-md object-cover"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {next ? (
        <div className="sticky bottom-0 -mx-4 border-t border-ink/10 bg-base/95 p-4 backdrop-blur">
          <ActionForm
            action={cleanerAdvanceAction}
            submitLabel={next === "in_progress" ? t("start") : t("finish")}
            submitClassName="min-h-16 w-full rounded-md bg-ink px-4 text-xl font-medium text-base transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            <input type="hidden" name="token" value={token} />
          </ActionForm>
        </div>
      ) : (
        <p className="rounded-lg bg-emerald-50 p-5 text-center text-xl font-medium text-emerald-800">
          {t("done")}
        </p>
      )}
    </section>
  );
}
