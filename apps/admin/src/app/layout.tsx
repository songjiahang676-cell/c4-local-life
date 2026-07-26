import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "管理后台 | 南加生活网",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
