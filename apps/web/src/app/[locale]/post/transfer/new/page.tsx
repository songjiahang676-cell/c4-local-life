import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RentalDraftForm } from "@/components/rental-draft-form";
import type { SupportedLocale } from "@/lib/rental-draft";

const locales = new Set<SupportedLocale>(["zh-Hans", "en-US"]);

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NewTransferDraftPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as SupportedLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const english = locale === "en-US";

  return (
    <main className="draftPage pageShell" id="main-content" tabIndex={-1}>
      <nav aria-label={english ? "Breadcrumb" : "面包屑"}>
        <Link href={`/${locale}`}>{english ? "Home" : "首页"}</Link>
        <span aria-hidden="true">/</span>
        <span>{english ? "Post a business transfer" : "发布生意转让"}</span>
      </nav>
      <header className="draftPageHeader">
        <div>
          <p>{english ? "Private draft" : "私有草稿"}</p>
          <h1>{english ? "Post a business transfer" : "发布生意转让"}</h1>
          <span>
            {english
              ? "Autosave, seller-reported business figures, policy acknowledgement, and human review"
              : "自动保存、发布者声明的经营数据、政策确认与人工审核"}
          </span>
        </div>
        <Link
          aria-label={english ? "Switch to Chinese" : "切换到英文"}
          href={english ? "/zh-Hans/post/transfer/new" : "/en-US/post/transfer/new"}
        >
          {english ? "中文" : "English"}
        </Link>
      </header>
      <RentalDraftForm listingType="TRANSFER" locale={locale} />
    </main>
  );
}
