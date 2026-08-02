import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RentalDraftForm } from "@/components/rental-draft-form";
import { messageCatalogs } from "@/i18n/messages";
import { switchLocalePath } from "@/lib/i18n";
import type { SupportedLocale } from "@/lib/rental-draft";

const locales = new Set<SupportedLocale>(["zh-Hans", "en-US"]);

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NewSecondhandDraftPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as SupportedLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const english = locale === "en-US";
  const messages = messageCatalogs[locale].common;

  return (
    <main className="draftPage pageShell" id="main-content" tabIndex={-1}>
      <nav aria-label={english ? "Breadcrumb" : "面包屑"}>
        <Link href={`/${locale}`}>{english ? "Home" : "首页"}</Link>
        <span aria-hidden="true">/</span>
        <span>{english ? "Post a secondhand item" : "发布二手物品"}</span>
      </nav>
      <header className="draftPageHeader">
        <div>
          <p>{english ? "Private draft" : "私有草稿"}</p>
          <h1>{english ? "Post a secondhand item" : "发布二手物品"}</h1>
          <span>
            {english
              ? "Autosave, truthful condition, prohibited-goods policy, and scanned media"
              : "自动保存、真实成色、禁售品政策与图片安全扫描"}
          </span>
        </div>
        <Link
          aria-label={english ? messages.switchToChinese : messages.switchToEnglish}
          href={switchLocalePath(locale, `/${locale}/post/secondhand/new`)}
        >
          {english ? "中文" : "English"}
        </Link>
      </header>
      <RentalDraftForm listingType="SECONDHAND" locale={locale} />
    </main>
  );
}
