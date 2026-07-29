import { notFound } from "next/navigation";
import {
  type AccountLocale,
  AccountSessionProvider,
  AccountShell,
} from "@/components/account-shell";

const locales = new Set<AccountLocale>(["zh-Hans", "en-US"]);

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccountLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as AccountLocale)) notFound();
  const locale = rawLocale as AccountLocale;
  return (
    <AccountSessionProvider>
      <AccountShell locale={locale}>{children}</AccountShell>
    </AccountSessionProvider>
  );
}
