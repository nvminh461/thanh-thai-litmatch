export type RewardType = "diamond" | "star";

export type BankConfig = {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  template: string;
};

export type RateConfig = {
  baseAmount: number;
  diamond: number;
  star: number;
};

export type DiamondSaleRateTier = {
  minAmount: number;
  diamond: number;
};

export type DiamondSaleRateConfig = {
  baseAmount: number;
  tiers: DiamondSaleRateTier[];
};

export type TotpRuntimeConfig = {
  secret: string;
  issuer: string | null;
  label: string;
  algorithm: string;
  digits: number;
  period: number;
};

export type LitmatchAgentRuntimeConfig = {
  baseUrl: string;
  phone: string;
  zone: string;
};

export type SiteConfig = {
  dealerName: string;
  zaloPhone: string;
  supportGroupUrl: string;
  facebookUrl: string;
  phoneNumber: string;
  announcementEnabled: boolean;
  announcementText: string;
};

export type RuntimeConfig = {
  bank: BankConfig;
  bankRate: RateConfig;
  cardRate: RateConfig;
  diamondSaleRate: DiamondSaleRateConfig;
  site: SiteConfig;
  totp: TotpRuntimeConfig;
  litmatchAgent: LitmatchAgentRuntimeConfig;
  paymentCodePrefix: string;
};

export const defaultBankRate: RateConfig = {
  baseAmount: 1000,
  diamond: 27,
  star: 270,
};

export const defaultCardRate: RateConfig = {
  baseAmount: 1000,
  diamond: 22,
  star: 220,
};

export const defaultDiamondSaleRate: DiamondSaleRateConfig = {
  baseAmount: 1000,
  tiers: [
    {
      minAmount: 0,
      diamond: 38,
    },
    {
      minAmount: 1000000,
      diamond: 40,
    },
  ],
};

export const packagePrices = [
  10000, 50000, 100000, 200000, 300000, 400000, 500000, 1000000, 2000000,
  3000000, 5000000, 10000000,
];
export const cardDenominations = [
  10000, 20000, 30000, 50000, 100000, 200000, 300000, 500000, 1000000,
];
export const cardProviders = ["VIETTEL", "MOBIFONE", "VINAPHONE"];

export function getCurrencyRate(
  rateConfig: RateConfig,
  rewardType: RewardType,
) {
  return rewardType === "diamond" ? rateConfig.diamond : rateConfig.star;
}

export function calculateReceiveAmount(
  price: number,
  rewardType: RewardType,
  rateConfig: RateConfig,
) {
  return Math.floor(
    (price / rateConfig.baseAmount) * getCurrencyRate(rateConfig, rewardType),
  );
}

export function normalizeDiamondSaleRateConfig(
  value: Partial<DiamondSaleRateConfig> | null | undefined,
  fallback: DiamondSaleRateConfig = defaultDiamondSaleRate,
): DiamondSaleRateConfig {
  const baseAmount =
    typeof value?.baseAmount === "number" &&
    Number.isFinite(value.baseAmount) &&
    value.baseAmount > 0
      ? value.baseAmount
      : fallback.baseAmount;
  const rawTiers = Array.isArray(value?.tiers) ? value.tiers : fallback.tiers;
  const tiers = rawTiers
    .map((tier) => ({
      minAmount:
        typeof tier?.minAmount === "number" &&
        Number.isFinite(tier.minAmount) &&
        tier.minAmount >= 0
          ? Math.floor(tier.minAmount)
          : -1,
      diamond:
        typeof tier?.diamond === "number" &&
        Number.isFinite(tier.diamond) &&
        tier.diamond > 0
          ? tier.diamond
          : 0,
    }))
    .filter((tier) => tier.minAmount >= 0 && tier.diamond > 0)
    .sort((left, right) => left.minAmount - right.minAmount)
    .filter(
      (tier, index, sorted) =>
        sorted.findIndex((item) => item.minAmount === tier.minAmount) === index,
    );

  return {
    baseAmount,
    tiers: tiers.length ? tiers : fallback.tiers,
  };
}

export function getDiamondSaleRateTier(
  amount: number,
  rateConfig: DiamondSaleRateConfig,
) {
  const normalizedRate = normalizeDiamondSaleRateConfig(rateConfig);
  let selectedTier = normalizedRate.tiers[0];

  for (const tier of normalizedRate.tiers) {
    if (amount >= tier.minAmount) {
      selectedTier = tier;
    }
  }

  return selectedTier;
}

export function calculateDiamondSaleAmount(
  price: number,
  rateConfig: DiamondSaleRateConfig,
) {
  const normalizedRate = normalizeDiamondSaleRateConfig(rateConfig);
  const tier = getDiamondSaleRateTier(price, normalizedRate);

  return Math.floor((price / normalizedRate.baseAmount) * tier.diamond);
}

export function normalizeLitmatchId(value: string) {
  return value.trim().replace(/\D/g, "");
}

export function normalizePaymentCodePrefix(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

export function buildVietQrUrl(
  bankConfig: BankConfig,
  amount: number | null,
  content: string,
) {
  const bankId = encodeURIComponent(bankConfig.bankId.trim());
  const accountNo = encodeURIComponent(bankConfig.accountNo.trim());
  const template = encodeURIComponent(bankConfig.template.trim() || "qr_only");
  const params = new URLSearchParams({
    addInfo: content,
    accountName: bankConfig.accountName.trim(),
  });

  if (amount !== null) {
    params.set("amount", String(amount));
  }

  return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?${params.toString()}`;
}
