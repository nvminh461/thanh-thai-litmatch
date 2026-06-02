import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

const siteUrl = getSiteUrl();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ogImage = {
  url: "/og-image.jpg",
  width: 1536,
  height: 1024,
  alt: "Đại lý Thành Thái - nạp Litmatch",
};

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Thanh Thái Litmatch",
  title: {
    default: "Đại lý Thành Thái",
    template: "%s | Đại lý Thành Thái",
  },
  description:
    "Nạp kim cương và xu sao Litmatch bằng chuyển khoản QR hoặc thẻ cào, xác minh ID trước khi thanh toán.",
  keywords: [
    "nạp Litmatch",
    "nạp kim cương Litmatch",
    "nạp xu sao Litmatch",
    "top up Litmatch",
    "nạp Litmatch bằng QR",
    "nạp Litmatch bằng thẻ cào",
  ],
  authors: [{ name: "Đại lý Thành Thái" }],
  creator: "Đại lý Thành Thái",
  publisher: "Đại lý Thành Thái",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    url: "/",
    siteName: "Thanh Thái Litmatch",
    title: "Đại lý Thành Thái",
    description:
      "Nạp kim cương và xu sao Litmatch bằng chuyển khoản QR hoặc thẻ cào, xác minh ID trước khi thanh toán.",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Đại lý Thành Thái",
    description:
      "Nạp kim cương và xu sao Litmatch bằng chuyển khoản QR hoặc thẻ cào, xác minh ID trước khi thanh toán.",
    images: [ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
