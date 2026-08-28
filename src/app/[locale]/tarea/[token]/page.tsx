import { getTranslations } from "next-intl/server";
import {
  cleanerAdvanceAction,
  cleanerUpdateChecklistAction,
  cleanerUploadPhotoAction,
} from "@/app/actions/cleaner";
import { ActionForm } from "@/components/action-form";
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
    return <p className="text-lg text-red-600">{t("invalid")}</p>;
  }

  const { task, listingTitle, photos } = view;
  const checklist = task.checklist ?? [];
  const progress = checklistProgress(checklist);
  const next = nextCleaningStatus(task.status);
  const itemKeys = checklist.map((item) => item.key).join(",");

  return (
    <section className="mx-auto max-w-md space-y-5 text-base">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-lg">{listingTitle}</p>
        <p>
          {t("statusLabel")}: <strong>{tStatus(task.status)}</strong>
        </p>
        {task.dueBy && (
          <p className="text-neutral-600">
            {t("dueBy")}: {new Date(task.dueBy).toISOString().slice(0, 16).replace("T", " ")}
          </p>
        )}
        {task.notes && (
          <p className="rounded bg-neutral-100 p-2">
            {t("notes")}: {task.notes}
          </p>
        )}
      </header>

      {checklist.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">
            {t("checklist")} — {t("progress", progress)}
          </h2>
          <ActionForm action={cleanerUpdateChecklistAction} submitLabel={t("saveChecklist")}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="itemKeys" value={itemKeys} />
            <ul className="space-y-1">
              {checklist.map((item) => (
                <li key={item.key}>
                  <label className="flex items-center gap-3 rounded border border-neutral-200 p-3">
                    <input
                      type="checkbox"
                      name={`item:${item.key}`}
                      defaultChecked={item.done}
                      disabled={task.status === "ready"}
                      className="h-6 w-6"
                    />
                    <span>{item.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </ActionForm>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">{t("photos")}</h2>
        <ActionForm action={cleanerUploadPhotoAction} submitLabel={t("uploadPhoto")}>
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-neutral-600">{t("photoHint")}</p>
          <input
            type="file"
            name="photo"
            accept={ACCEPT_ATTRIBUTE}
            capture="environment"
            required
            className="w-full"
          />
          <input
            type="text"
            name="caption"
            placeholder={t("caption")}
            className="w-full rounded border border-neutral-300 px-2 py-2"
          />
        </ActionForm>
        {photos.length === 0 ? (
          <p className="text-sm text-neutral-500">{t("noPhotos")}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <li key={photo.id}>
                <img
                  src={photo.url}
                  alt={photo.caption ?? listingTitle}
                  className="aspect-square w-full rounded object-cover"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {next ? (
        <ActionForm
          action={cleanerAdvanceAction}
          submitLabel={next === "in_progress" ? t("start") : t("finish")}
          submitClassName="w-full rounded bg-neutral-900 px-4 py-4 text-lg font-medium text-white disabled:opacity-50"
        >
          <input type="hidden" name="token" value={token} />
        </ActionForm>
      ) : (
        <p className="rounded bg-green-50 p-4 text-center text-lg font-medium text-green-800">
          {t("done")}
        </p>
      )}
    </section>
  );
}
