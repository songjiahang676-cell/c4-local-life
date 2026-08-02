import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { messageCatalogs } from "@/i18n/messages";
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
  const messages = messageCatalogs[locale].common;

  return (
    <div data-locale={locale} lang={locale}>
      <a className="publicSkipLink" href="#main-content">
        {messages.skipToMainContent}
      </a>
      {children}
    </div>
  );
}
