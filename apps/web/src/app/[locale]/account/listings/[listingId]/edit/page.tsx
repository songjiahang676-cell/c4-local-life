import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RentalDraftForm } from "@/components/rental-draft-form";
import type { DraftListingType, SupportedLocale } from "@/lib/rental-draft";

const locales = new Set<SupportedLocale>(["zh-Hans", "en-US"]);
const listingTypes = new Set<DraftListingType>([
  "RENTAL",
  "JOB",
  "TRANSFER",
  "SECONDHAND",
  "SERVICE",
]);
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "编辑信息 / Edit Listing",
  robots: { index: false, follow: false },
};

export default async function EditAccountListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; listingId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ locale: rawLocale, listingId }, { type: rawType }] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !locales.has(rawLocale as SupportedLocale) ||
    !uuidV4.test(listingId) ||
    !listingTypes.has(rawType as DraftListingType)
  ) {
    notFound();
  }
  const locale = rawLocale as SupportedLocale;
  const listingType = rawType as DraftListingType;
  const english = locale === "en-US";

  return (
    <main className="draftPage pageShell">
      <nav aria-label={english ? "Breadcrumb" : "面包屑"}>
        <Link href={`/${locale}`}>{english ? "Home" : "首页"}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/${locale}/account/listings`}>{english ? "My listings" : "我的信息"}</Link>
        <span aria-hidden="true">/</span>
        <span>{english ? "Edit draft" : "编辑草稿"}</span>
      </nav>
      <header className="draftPageHeader">
        <div>
          <p>{english ? "Private draft" : "私有草稿"}</p>
          <h1>{english ? "Edit listing" : "编辑信息"}</h1>
          <span>
            {english
              ? "Autosave uses the latest server version and keeps scanned media private"
              : "自动保存使用服务器最新版本，并保持已扫描媒体为私有状态"}
          </span>
        </div>
      </header>
      <RentalDraftForm initialListingId={listingId} listingType={listingType} locale={locale} />
    </main>
  );
}
