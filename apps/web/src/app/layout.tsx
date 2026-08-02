import type { Metadata } from "next";
import { headers } from "next/headers";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { localeFromRequestHeader, ROUTE_LOCALE_HEADER } from "@/lib/i18n";
import { publicWebOrigin } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: publicWebOrigin(),
  applicationName: "南加生活网 / SoCal Life",
  title: "南加生活网 | SoCal Life",
  description: "服务南加州华人的本地分类信息、商家、师傅、社区与生活服务平台。",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  // New templates fail closed until their page-level SEO policy is explicit.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = localeFromRequestHeader(requestHeaders.get(ROUTE_LOCALE_HEADER));
  return (
    <html lang={locale}>
      <body>
        {children}
        <WebVitalsReporter />
      </body>
    </html>
  );
}
