import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountListings, type AccountListingsLocale } from "@/components/account-listings";

const locales = new Set<AccountListingsLocale>(["zh-Hans", "en-US"]);

export const metadata: Metadata = {
  title: "我的信息 / My Listings",
  robots: { index: false, follow: false },
};

export default async function AccountListingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as AccountListingsLocale)) notFound();
  const locale = rawLocale as AccountListingsLocale;
  const english = locale === "en-US";

  return (
    <main className="accountListingsPage pageShell" id="main-content" tabIndex={-1}>
      <nav aria-label={english ? "Breadcrumb" : "面包屑"}>
        <Link href={`/${locale}`}>{english ? "Home" : "首页"}</Link>
        <span aria-hidden="true">/</span>
        <span>{english ? "My listings" : "我的信息"}</span>
      </nav>
      <header className="accountListingsPageHeader">
        <div>
          <p>{english ? "Your account" : "账号中心"}</p>
          <h1>{english ? "My listings" : "我的信息"}</h1>
          <span>
            {english
              ? "Manage private drafts, review status, public listings, and archived content"
              : "管理私有草稿、审核状态、已发布信息和归档内容"}
          </span>
        </div>
        <div>
          <Link
            aria-label={english ? "切换到中文" : "Switch to English"}
            href={english ? "/zh-Hans/account/listings" : "/en-US/account/listings"}
          >
            {english ? "中文" : "English"}
          </Link>
          <Link className="accountListingsPrimary" href={`/${locale}/post/rental/new`}>
            {english ? "Post a listing" : "发布新信息"}
          </Link>
        </div>
      </header>
      <AccountListings locale={locale} />
    </main>
  );
}
