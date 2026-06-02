const fallbackSiteUrl = "http://localhost:3000";

export function getSiteUrl() {
  const rawSiteUrl = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    fallbackSiteUrl,
  ].find((value) => value?.trim());

  const siteUrl =
    rawSiteUrl?.startsWith("http://") || rawSiteUrl?.startsWith("https://")
      ? rawSiteUrl
      : `https://${rawSiteUrl}`;

  let url: URL;

  try {
    url = new URL(siteUrl ?? fallbackSiteUrl);
  } catch {
    url = new URL(fallbackSiteUrl);
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url;
}
