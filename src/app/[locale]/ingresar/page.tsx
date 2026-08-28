import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LoginForm
        labels={{
          email: t("email"),
          password: t("password"),
          submit: t("submit"),
          invalid: t("invalid"),
          required: t("required"),
        }}
      />
      <p className="text-sm text-neutral-500">{t("forCleaners")}</p>
    </section>
  );
}
