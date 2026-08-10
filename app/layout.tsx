import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "牌研所｜中国机动车号牌生成器",
  description: "按公开规则随机或指定生成中国机动车号牌样式，并导出高清 PNG。",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "牌研所｜中国机动车号牌生成器",
    description: "随机生成 · 指定生成 · 高清导出",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "牌研所分享封面" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
