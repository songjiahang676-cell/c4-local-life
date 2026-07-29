import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RentalDraftForm } from "@/components/rental-draft-form";
import type { SupportedLocale } from "@/lib/rental-draft";

const locales = new Set<SupportedLocale>(["zh-Hans", "en-US"]);

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NewRentalDraftPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as SupportedLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const english = locale === "en-US";

  return (
    <main className="draftPage pageShell">
      <nav aria-label={english ? "Breadcrumb" : "面包屑"}>
        <Link href={`/${locale}`}>{english ? "Home" : "首页"}</Link>
        <span aria-hidden="true">/</span>
        <span>{english ? "Post a rental" : "发布房源"}</span>
      </nav>
      <header className="draftPageHeader">
        <div>
          <p>{english ? "Private draft" : "私有草稿"}</p>
          <h1>{english ? "Post a rental" : "发布出租房源"}</h1>
          <span>
            {english
              ? "Autosave, account-scoped recovery and scanned media"
              : "自动保存、账号隔离恢复与图片安全扫描"}
          </span>
        </div>
        <Link
          aria-label={english ? "切换到中文" : "Switch to English"}
          href={english ? "/zh-Hans/post/rental/new" : "/en-US/post/rental/new"}
        >
          {english ? "中文" : "English"}
        </Link>
      </header>
      <RentalDraftForm locale={locale} />
    </main>
  );
}
