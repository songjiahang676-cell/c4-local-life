import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountOverview } from "@/components/account-overview";
import type { AccountLocale } from "@/components/account-shell";

const locales = new Set<AccountLocale>(["zh-Hans", "en-US"]);

export const metadata: Metadata = {
  title: "账号中心 / Account Center",
  robots: { index: false, follow: false },
};

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as AccountLocale)) notFound();
  return <AccountOverview locale={rawLocale as AccountLocale} />;
}
