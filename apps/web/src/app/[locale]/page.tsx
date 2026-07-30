import { notFound } from "next/navigation";
import { HomePage } from "@/components/home-page";
import type { Locale } from "@socal/contracts";
import { loadHomepage } from "@/lib/homepage";
import { homepageSeoMetadata, isSupportedLocale } from "@/lib/seo";

type HomepageRouteProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>;

export async function generateMetadata({ params, searchParams }: HomepageRouteProps) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  if (!isSupportedLocale(rawLocale)) notFound();
  return homepageSeoMetadata(
    rawLocale,
    Object.values(query).some((value) => value !== undefined),
  );
}

export default async function Page({ params }: HomepageRouteProps) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const model = await loadHomepage(locale);
  return <HomePage locale={locale} model={model} />;
}
