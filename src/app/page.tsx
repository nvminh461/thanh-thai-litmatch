import { getRuntimeConfig } from "@/server/runtime-config";
import HomeClient from "./home-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const runtimeConfig = await getRuntimeConfig();

  return (
    <HomeClient
      bankConfig={runtimeConfig.bank}
      bankRateConfig={runtimeConfig.bankRate}
      cardRateConfig={runtimeConfig.cardRate}
    />
  );
}
