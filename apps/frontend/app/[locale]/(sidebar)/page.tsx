import { redirect } from "next/navigation";

import { SUPPORTED_LOCALES, SupportedLocale } from "@/lib/i18n";

export default async function RootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const safeLocale = SUPPORTED_LOCALES.includes(locale as SupportedLocale)
    ? locale
    : "en";

  redirect(`/${safeLocale}/my-ai-tools`);
}
