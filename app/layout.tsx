import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "I2AI 報連相トレーナー",
  description: "AIとの会話から報告・連絡・相談の質をスコア化してフィードバックします",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
