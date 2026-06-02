import { getRuntimeConfig } from "@/server/runtime-config";
import type { LitmatchAgentRuntimeConfig } from "@/lib/payment-config";

export type LitmatchAgentConfig = LitmatchAgentRuntimeConfig;

export async function getLitmatchAgentConfig(): Promise<LitmatchAgentConfig> {
  const runtimeConfig = await getRuntimeConfig();
  const { baseUrl, phone, zone } = runtimeConfig.litmatchAgent;

  if (!baseUrl || !phone || !zone) {
    throw new Error(
      "Missing Litmatch agent config: LIT_AGENT_BASE_URL, LIT_AGENT_PHONE, LIT_AGENT_ZONE",
    );
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), phone, zone };
}
