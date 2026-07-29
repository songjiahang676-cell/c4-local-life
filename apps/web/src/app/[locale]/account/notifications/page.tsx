import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotificationCenter, type NotificationLocale } from "@/components/notification-center";

const locales = new Set<NotificationLocale>(["zh-Hans", "en-US"]);

export const metadata: Metadata = {
  title: "通知 / Notifications",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!locales.has(rawLocale as NotificationLocale)) notFound();
  const locale = rawLocale as NotificationLocale;
  const english = locale === "en-US";

  return (
    <main className="notificationPage pageShell">
      <nav aria-label={english ? "Breadcrumb" : "面包屑"}>
        <Link href={`/${locale}`}>{english ? "Home" : "首页"}</Link>
        <span aria-hidden="true">/</span>
        <span>{english ? "Notifications" : "通知"}</span>
      </nav>
      <header className="notificationPageHeader">
        <div>
          <p>{english ? "Your account" : "账号中心"}</p>
          <h1>{english ? "Notifications" : "站内通知"}</h1>
          <span>
            {english
              ? "Private listing status updates, newest first"
              : "仅当前账号可见的信息状态更新，按时间倒序排列"}
          </span>
        </div>
        <Link
          aria-label={english ? "切换到中文" : "Switch to English"}
          href={english ? "/zh-Hans/account/notifications" : "/en-US/account/notifications"}
        >
          {english ? "中文" : "English"}
        </Link>
      </header>
      <NotificationCenter locale={locale} />
    </main>
  );
}
