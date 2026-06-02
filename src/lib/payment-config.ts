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
  facebookUrl: string;
  phoneNumber: string;
  announcementEnabled: boolean;
  announcementText: string;
};

export type RuntimeConfig = {
  bank: BankConfig;
  bankRate: RateConfig;
  cardRate: RateConfig;
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
