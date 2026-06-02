import type { AdminRuntimeConfigForm } from "@/lib/admin-types";
import type { RuntimeConfig } from "@/lib/payment-config";

export function toAdminRuntimeConfigForm(
  config: RuntimeConfig,
): AdminRuntimeConfigForm {
  return {
    bankId: config.bank.bankId,
    bankName: config.bank.bankName,
    accountNo: config.bank.accountNo,
    accountName: config.bank.accountName,
    template: config.bank.template,
    bankBaseAmount: config.bankRate.baseAmount,
    bankDiamond: config.bankRate.diamond,
    bankStar: config.bankRate.star,
    cardBaseAmount: config.cardRate.baseAmount,
    cardDiamond: config.cardRate.diamond,
    cardStar: config.cardRate.star,
    paymentCodePrefix: config.paymentCodePrefix,
  };
}
