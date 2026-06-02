import type {
  BankConfig,
  RateConfig,
  RuntimeConfig,
} from "@/lib/payment-config";
import {
  defaultBankRate,
  defaultCardRate,
  normalizePaymentCodePrefix,
} from "@/lib/payment-config";
import { getCollection } from "./mongo";

const RUNTIME_CONFIG_KEY = "runtimeConfig";
const DEFAULT_PAYMENT_CODE_PREFIX = "LM";
const DEFAULT_BANK_CONFIG: BankConfig = {
  bankId: "",
  bankName: "",
  accountNo: "",
  accountName: "",
  template: "qr_only",
};

type AppSettingDocument<TValue> = {
  key: string;
  value: TValue;
  createdAt: Date;
  updatedAt: Date;
};

type PersistedRuntimeConfig = Pick<
  RuntimeConfig,
  "bank" | "bankRate" | "cardRate" | "paymentCodePrefix"
>;

function nonEmptyString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function getEnvOnlyConfig() {
  return {
    totp: {
      secret: process.env.TOTP_SECRET ?? "",
      issuer: process.env.TOTP_ISSUER ?? null,
      label: process.env.TOTP_LABEL ?? "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    },
    litmatchAgent: {
      phone: process.env.LIT_AGENT_PHONE ?? "",
      zone: process.env.LIT_AGENT_ZONE ?? "",
      baseUrl: process.env.LIT_AGENT_BASE_URL ?? "https://agent.litatom.com",
    },
  };
}

export function getDefaultRuntimeConfig(): RuntimeConfig {
  const envOnlyConfig = getEnvOnlyConfig();

  return {
    bank: DEFAULT_BANK_CONFIG,
    bankRate: defaultBankRate,
    cardRate: defaultCardRate,
    ...envOnlyConfig,
    paymentCodePrefix:
      normalizePaymentCodePrefix(process.env.PAYMENT_CODE_PREFIX ?? "") ||
      DEFAULT_PAYMENT_CODE_PREFIX,
  };
}

export function normalizeRuntimeConfig(
  value: Partial<RuntimeConfig> | null | undefined,
  fallback: RuntimeConfig = getDefaultRuntimeConfig(),
): RuntimeConfig {
  const envOnlyConfig = getEnvOnlyConfig();
  const bank = value?.bank ?? ({} as Partial<BankConfig>);
  const bankRate = value?.bankRate ?? ({} as Partial<RateConfig>);
  const cardRate = value?.cardRate ?? ({} as Partial<RateConfig>);
  const prefix =
    normalizePaymentCodePrefix(value?.paymentCodePrefix ?? "") ||
    fallback.paymentCodePrefix ||
    DEFAULT_PAYMENT_CODE_PREFIX;

  return {
    bank: {
      bankId: nonEmptyString(bank.bankId, fallback.bank.bankId),
      bankName: nonEmptyString(bank.bankName, fallback.bank.bankName),
      accountNo: nonEmptyString(bank.accountNo, fallback.bank.accountNo),
      accountName: nonEmptyString(bank.accountName, fallback.bank.accountName),
      template: nonEmptyString(bank.template, fallback.bank.template),
    },
    bankRate: {
      baseAmount: positiveNumber(
        bankRate.baseAmount,
        fallback.bankRate.baseAmount,
      ),
      diamond: positiveNumber(bankRate.diamond, fallback.bankRate.diamond),
      star: positiveNumber(bankRate.star, fallback.bankRate.star),
    },
    cardRate: {
      baseAmount: positiveNumber(
        cardRate.baseAmount,
        fallback.cardRate.baseAmount,
      ),
      diamond: positiveNumber(cardRate.diamond, fallback.cardRate.diamond),
      star: positiveNumber(cardRate.star, fallback.cardRate.star),
    },
    totp: envOnlyConfig.totp,
    litmatchAgent: {
      ...envOnlyConfig.litmatchAgent,
      baseUrl: envOnlyConfig.litmatchAgent.baseUrl.replace(/\/$/, ""),
    },
    paymentCodePrefix: prefix,
  };
}

function toPersistedRuntimeConfig(config: RuntimeConfig): PersistedRuntimeConfig {
  return {
    bank: config.bank,
    bankRate: config.bankRate,
    cardRate: config.cardRate,
    paymentCodePrefix: config.paymentCodePrefix,
  };
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const collection =
    await getCollection<AppSettingDocument<Partial<RuntimeConfig>>>(
      "app_settings",
    );
  const existingConfig = await collection.findOne({ key: RUNTIME_CONFIG_KEY });

  if (existingConfig?.value) {
    const normalizedConfig = normalizeRuntimeConfig(existingConfig.value);
    const rawConfig = existingConfig.value as Partial<RuntimeConfig> &
      Record<string, unknown>;

    if (
      !rawConfig.bankRate ||
      !rawConfig.cardRate ||
      rawConfig.totp ||
      rawConfig.litmatchAgent
    ) {
      await collection.updateOne(
        { key: RUNTIME_CONFIG_KEY },
        {
          $set: {
            value: toPersistedRuntimeConfig(normalizedConfig),
            updatedAt: new Date(),
          },
        },
      );
    }

    return normalizedConfig;
  }

  const now = new Date();
  const defaultConfig = getDefaultRuntimeConfig();

  await collection.updateOne(
    { key: RUNTIME_CONFIG_KEY },
    {
      $setOnInsert: {
        key: RUNTIME_CONFIG_KEY,
        value: toPersistedRuntimeConfig(defaultConfig),
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  const insertedConfig = await collection.findOne({ key: RUNTIME_CONFIG_KEY });
  return normalizeRuntimeConfig(insertedConfig?.value ?? defaultConfig);
}

export async function saveRuntimeConfig(value: RuntimeConfig) {
  const collection =
    await getCollection<AppSettingDocument<Partial<RuntimeConfig>>>(
      "app_settings",
    );
  const currentConfig = await getRuntimeConfig();
  const nextConfig = normalizeRuntimeConfig(value, currentConfig);
  const now = new Date();

  await collection.updateOne(
    { key: RUNTIME_CONFIG_KEY },
    {
      $set: {
        value: toPersistedRuntimeConfig(nextConfig),
        updatedAt: now,
      },
      $setOnInsert: {
        key: RUNTIME_CONFIG_KEY,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  return nextConfig;
}
