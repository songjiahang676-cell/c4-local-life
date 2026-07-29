import { notFound } from "next/navigation";

const locales = new Set(["zh-Hans", "en-US"]);

export function generateStaticParams() {
  return [{ locale: "zh-Hans" }, { locale: "en-US" }];
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!locales.has(locale)) notFound();

  return (
    <div data-locale={locale} lang={locale}>
      {children}
    </div>
  );
}
