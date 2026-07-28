import type { Metadata } from "next";
import { headers } from "next/headers";
import "./styles.css";

export const metadata: Metadata = {
  title: "管理后台 | 南加生活网",
  description: "南加生活网授权运营人员工作台",
  robots: { index: false, follow: false },
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading request headers keeps Admin rendering dynamic so Next can attach the
  // per-request CSP nonce supplied by proxy.ts to every framework script.
  await headers();
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
