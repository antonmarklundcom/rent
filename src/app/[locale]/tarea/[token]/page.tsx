import { getTranslations } from "next-intl/server";
import { resolveMagicToken } from "@/lib/magic-link";

/**
 * Cleaner task page (#1). Reached only through a tokenized URL — no login,
 * no session, no role check: the token IS the credential (plan §2).
 */
export default async function CleanerTaskPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("cleaner");
  const tStatus = await getTranslations("cleaningStatus");
  const row = await resolveMagicToken(token);

  if (!row) {
    return <p className="text-red-600">{t("invalid")}</p>;
  }

  const { task, listingTitle } = row;
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>
        {t("property")}: {listingTitle}
      </p>
      <p>
        {t("statusLabel")}: {tStatus(task.status)}
      </p>
      {task.dueBy && (
        <p>
          {t("dueBy")}: {new Date(task.dueBy).toISOString().slice(0, 16).replace("T", " ")}
        </p>
      )}
      {task.checklist && task.checklist.length > 0 && (
        <>
          <h2 className="font-medium">{t("checklist")}</h2>
          <ul className="list-disc pl-5 text-sm">
            {task.checklist.map((item) => (
              <li key={item.key}>
                {item.done ? "✓" : "○"} {item.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
