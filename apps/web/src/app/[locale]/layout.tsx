import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSupportedLocale, localeLayoutMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return [{ locale: "zh-Hans" }, { locale: "en-US" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return localeLayoutMetadata(locale);
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  return (
    <div data-locale={locale} lang={locale}>
      {children}
    </div>
  );
}
