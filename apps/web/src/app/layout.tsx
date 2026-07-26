import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "南加生活网 | SoCal Life",
    template: "%s | 南加生活网",
  },
  description: "服务南加州华人的本地分类信息、商家、师傅、社区与生活服务平台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
