import { getRuntimeConfig } from "@/server/runtime-config";
import { resolveCtvRefSnapshot } from "@/server/ctv-repository";
import HomeClient from "./home-client";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ctv?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctvParam = Array.isArray(params.ctv) ? params.ctv[0] : params.ctv;
  const [runtimeConfig, ctvRef] = await Promise.all([
    getRuntimeConfig(),
    resolveCtvRefSnapshot(ctvParam),
  ]);

  return (
    <HomeClient
      bankConfig={runtimeConfig.bank}
      bankRateConfig={runtimeConfig.bankRate}
      cardRateConfig={runtimeConfig.cardRate}
      siteConfig={runtimeConfig.site}
      ctvRef={ctvRef ? { code: ctvRef.code, name: ctvRef.name } : null}
    />
  );
}
