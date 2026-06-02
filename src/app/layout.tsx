import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import { getRuntimeConfig } from "@/server/runtime-config";
import "./globals.css";

const siteUrl = getSiteUrl();
const defaultDealerName = "Đại lý Thành Thái";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function buildMetadata(dealerName: string): Metadata {
  const normalizedDealerName = dealerName.trim() || defaultDealerName;
  const description =
    "Nạp kim cương và xu sao Litmatch bằng chuyển khoản QR hoặc thẻ cào, xác minh ID trước khi thanh toán.";
  const ogImage = {
    url: "/og-image.jpg",
    width: 1536,
    height: 1024,
    alt: `${normalizedDealerName} - nạp Litmatch`,
  };

  return {
    metadataBase: siteUrl,
    applicationName: `${normalizedDealerName} Litmatch`,
    title: {
      default: normalizedDealerName,
      template: `%s | ${normalizedDealerName}`,
    },
    description,
    keywords: [
      "nạp Litmatch",
      "nạp kim cương Litmatch",
      "nạp xu sao Litmatch",
      "top up Litmatch",
      "nạp Litmatch bằng QR",
      "nạp Litmatch bằng thẻ cào",
    ],
    authors: [{ name: normalizedDealerName }],
    creator: normalizedDealerName,
    publisher: normalizedDealerName,
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      locale: "vi_VN",
      url: "/",
      siteName: `${normalizedDealerName} Litmatch`,
      title: normalizedDealerName,
      description,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: normalizedDealerName,
      description,
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
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const runtimeConfig = await getRuntimeConfig();

    return buildMetadata(runtimeConfig.site.dealerName);
  } catch {
    return buildMetadata(defaultDealerName);
  }
}

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
