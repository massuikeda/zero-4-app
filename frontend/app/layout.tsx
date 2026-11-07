import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zero-4 マッチング",
  description: "地域企業とIT人材をつなぐマッチングアプリ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
