import { notFound } from "next/navigation";
import { HomePage } from "@/components/home-page";
import type { Locale } from "@socal/contracts";
import { loadHomepage } from "@/lib/homepage";
import { hasTrustedPublicOrigin, homepageSeoMetadata, isSupportedLocale } from "@/lib/seo";

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

export default async function Page({ params, searchParams }: HomepageRouteProps) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const model = await loadHomepage(locale);
  const includeStructuredData =
    model.kind === "ready" &&
    hasTrustedPublicOrigin() &&
    !Object.values(query).some((value) => value !== undefined);
  return <HomePage includeStructuredData={includeStructuredData} locale={locale} model={model} />;
}
