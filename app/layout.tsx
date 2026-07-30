import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tablature Lens — TAB譜をMusicXMLへ",
  description:
    "ギターの五線譜＋TAB譜画像をTuxGuitar対応MusicXMLへ変換します。",
  openGraph: {
    title: "Tablature Lens",
    description: "TAB譜を、MusicXMLへ。",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tablature Lens",
    description: "TAB譜を、MusicXMLへ。",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
