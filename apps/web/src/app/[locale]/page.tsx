import { HomePage } from "@/components/home-page";
import type { Locale } from "@socal/contracts";
import { loadHomepage } from "@/lib/homepage";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale as Locale;
  const model = await loadHomepage(locale);
  return <HomePage locale={locale} model={model} />;
}
