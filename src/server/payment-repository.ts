import { randomInt } from "node:crypto";
import { ObjectId, type Filter, type UpdateFilter } from "mongodb";
import type {
  AdminBankPaymentMode,
  AdminBankQrBlacklistRow,
  AdminBankQrBlacklistStatus,
  AdminBankPaymentRow,
  AdminBankPaymentSummary,
  AdminCardPaymentRow,
  AdminCardPaymentSummary,
  AdminDiamondSalePaymentRow,
  AdminDiamondSalePaymentSource,
  AdminDiamondSalePaymentStatus,
  AdminDiamondSalePaymentSummary,
  AdminPaginatedDiamondSalePayments,
  AdminPaginatedBankPayments,
  AdminPaginatedBankQrBlacklist,
  AdminPaginatedCardPayments,
  AdminDirectRechargeRow,
  AdminDirectRechargeSummary,
  AdminLifetimeQrExportResult,
  AdminLifetimeQrReport,
  AdminLifetimeQrReportRow,
  AdminPaginatedDirectRecharges,
  AdminPaymentStatus,
  AdminPaginatedPayments,
  AdminRechargePreview,
  AdminRechargeResult,
} from "@/lib/admin-types";
import {
  buildVietQrUrl,
  calculateDiamondSaleAmount,
  calculateReceiveAmount,
  cardDenominations,
  cardProviders,
  normalizeLitmatchId,
  type BankConfig,
  type DiamondSaleRateConfig,
  type RateConfig,
  type RewardType,
  type RuntimeConfig,
} from "@/lib/payment-config";
import {
  litmatchAgent,
  LitmatchAgentError,
  type TargetUserInfo,
  toTransferAssetType,
  type TransferAccountResponse,
  type TransferAssetType,
} from "@/server/litmatch-agent";
import {
  chargePay1sCard,
  Pay1sClientError,
  type Pay1sCallbackPayload,
  type Pay1sChargingRequest,
  type Pay1sChargingResponse,
} from "@/server/pay1s/client";
import { getCollection } from "./mongo";
import { getRuntimeConfig } from "./runtime-config";

const PAYMENT_CODE_SUFFIX_LENGTH = 10;
const PAYMENT_CODE_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CARD_REQUEST_ID_MIN = 100000000;
const CARD_REQUEST_ID_MAX = 1000000000;
const LIFETIME_QR_DIAMOND_PREFIX = "LMKC";
const LIFETIME_QR_STAR_PREFIX = "LMSAO";
const DIAMOND_SALE_PREFIX = "LMXA";
const DIAMOND_SALE_ORDER_CODE_LENGTH = 8;
const PAYMENT_BLACKLIST_LIMIT = 5;
const BANK_QR_BLACKLIST_REASON =
  "Có 5 giao dịch chuyển khoản chưa thanh toán liên tiếp.";
const CARD_PAYMENT_BLACKLIST_REASON =
  "Có 5 giao dịch nạp thẻ không thành công liên tiếp.";
const PAYMENT_BLACKLIST_ERROR =
  "ID Litmatch này đang bị chặn tạo QR hoặc nạp thẻ do có nhiều giao dịch chưa hoàn tất. Vui lòng liên hệ admin.";
export const ADMIN_PAYMENT_PAGE_SIZE = 20;

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentValidationError";
  }
}

export type PublicLifetimeBankQr = {
  id: string;
  litmatchId: string;
  rewardType: RewardType;
  transferContent: string;
  qrUrl: string;
};

export class DuplicateLifetimeBankQrError extends PaymentValidationError {
  existingLifetimeQr: PublicLifetimeBankQr;

  constructor(message: string, existingLifetimeQr: PublicLifetimeBankQr) {
    super(message);
    this.name = "DuplicateLifetimeBankQrError";
    this.existingLifetimeQr = existingLifetimeQr;
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("Payment not found");
    this.name = "PaymentNotFoundError";
  }
}

export type PaymentStatus = AdminPaymentStatus;
export type BankPaymentMode = AdminBankPaymentMode;

type ConfigSnapshot = {
  bank?: BankConfig;
  bankRate?: RateConfig;
  cardRate?: RateConfig;
  diamondSaleRate?: DiamondSaleRateConfig;
  paymentCodePrefix: string;
};

type DiamondSalePaymentStatus = AdminDiamondSalePaymentStatus;
type DiamondSalePaymentSource = AdminDiamondSalePaymentSource;

type DiamondSaleProviderState = {
  status: "pending" | "accepted" | "failed" | "completed";
  externalRequestId?: string;
  request?: DiamondSaleProviderRequestBody;
  response?: unknown;
  message?: string;
  error?: string;
  retryCount?: number;
  requestedAt?: Date;
  acceptedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  webhookPayload?: DiamondSaleProviderWebhookPayload;
};

export type DiamondSalePaymentDocument = {
  _id?: ObjectId;
  source: DiamondSalePaymentSource;
  status: DiamondSalePaymentStatus;
  litmatchId: string;
  password: string;
  amount: number;
  diamondAmount: number;
  orderCode: string;
  transferContent: string;
  configSnapshot: ConfigSnapshot;
  sepay?: {
    id: number;
    gateway: string;
    transactionDate: string;
    accountNumber: string;
    content: string;
    transferAmount: number;
    referenceCode: string;
    payload: SePayWebhookPayload;
  };
  paidAt?: Date;
  provider?: DiamondSaleProviderState;
  createdAt: Date;
  updatedAt: Date;
};

export type BankPaymentDocument = {
  _id?: ObjectId;
  mode?: BankPaymentMode;
  status: PaymentStatus;
  litmatchId: string;
  verifiedUser?: TargetUserInfo & {
    verifiedAt: Date;
  };
  amount: number;
  rewardType: RewardType;
  rewardAmount: number;
  transferContent: string;
  lifetimeQrId?: ObjectId;
  commissionExport?: {
    status: "exported";
    exportedAt: Date;
  };
  configSnapshot: ConfigSnapshot;
  sepay?: {
    id: number;
    gateway: string;
    transactionDate: string;
    accountNumber: string;
    content: string;
    transferAmount: number;
    referenceCode: string;
    payload: SePayWebhookPayload;
  };
  paidAt?: Date;
  recharge?: {
    targetUid: string;
    transferType: TransferAssetType;
    transferNum: number;
    status: "pending" | "completed" | "failed";
    response?: TransferAccountResponse;
    error?: string;
    requestedAt: Date;
    completedAt?: Date;
    failedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type LifetimeBankQrDocument = {
  _id?: ObjectId;
  status: "active";
  litmatchId: string;
  verifiedUser?: TargetUserInfo & {
    verifiedAt: Date;
  };
  rewardType: RewardType;
  transferContent: string;
  configSnapshot: ConfigSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

export type BankQrBlacklistDocument = {
  _id?: ObjectId;
  litmatchId: string;
  status: AdminBankQrBlacklistStatus;
  reason: string;
  triggeredByPaymentIds: ObjectId[];
  blockedAt: Date;
  unblockedAt?: Date;
  unblockedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CardPaymentDocument = {
  _id?: ObjectId;
  status: PaymentStatus;
  litmatchId: string;
  verifiedUser?: TargetUserInfo & {
    verifiedAt: Date;
  };
  rewardType: RewardType;
  requestId?: string;
  cardProvider: string;
  cardDenomination: number;
  discountPercent?: number;
  discountedAmount?: number;
  rewardAmount: number;
  cardCode: string;
  cardSerial: string;
  providerStatus?: number;
  providerMessage?: string;
  providerTransId?: string;
  declaredValue?: number;
  actualValue?: number;
  providerAmount?: number;
  providerDiscountPercent?: number;
  providerRequest?: Pay1sChargingRequest;
  providerResponse?: Pay1sChargingResponse;
  providerCallback?: Pay1sCallbackPayload;
  note?: string;
  recharge?: {
    targetUid: string;
    transferType: TransferAssetType;
    transferNum: number;
    status: "pending" | "completed" | "failed";
    response?: TransferAccountResponse;
    error?: string;
    requestedAt: Date;
    completedAt?: Date;
    failedAt?: Date;
  };
  configSnapshot: ConfigSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminDirectRechargeDocument = {
  _id?: ObjectId;
  status: "pending" | "completed" | "failed";
  adminUsername: string;
  litmatchId: string;
  verifiedUser?: TargetUserInfo & {
    verifiedAt: Date;
  };
  rewardType: RewardType;
  rewardAmount: number;
  note?: string;
  recharge: {
    targetUid: string;
    transferType: TransferAssetType;
    transferNum: number;
    status: "pending" | "completed" | "failed";
    response?: TransferAccountResponse;
    error?: string;
    requestedAt: Date;
    completedAt?: Date;
    failedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type SePayWebhookPayload = {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string;
  code: string | null;
  content: string;
  transferType: "in" | "out" | string;
  description?: string;
  transferAmount: number;
  accumulated?: number;
  referenceCode: string;
};

type SePayWebhookEventDocument = {
  _id?: ObjectId;
  sepayId: number;
  status:
    | "received"
    | "duplicate"
    | "processed"
    | "ignored"
    | "unmatched"
    | "amount_mismatch"
    | "already_paid"
    | "provider_pending"
    | "recharge_completed"
    | "recharge_failed";
  payload: SePayWebhookPayload;
  rawBody: string;
  paymentId?: ObjectId;
  message?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SePayWebhookProcessResult = {
  sepayId: number;
  status: SePayWebhookEventDocument["status"];
  message?: string;
  paymentId?: string;
};

const SEPAY_WEBHOOK_SUCCESS_STATUSES = new Set<
  SePayWebhookProcessResult["status"]
>(["ignored", "provider_pending", "recharge_completed", "already_paid", "duplicate"]);

const SEPAY_WEBHOOK_RETRIABLE_STATUSES = new Set<
  SePayWebhookProcessResult["status"]
>(["unmatched", "amount_mismatch", "recharge_failed"]);

export function isSePayWebhookProcessSuccess(
  result: SePayWebhookProcessResult,
) {
  return SEPAY_WEBHOOK_SUCCESS_STATUSES.has(result.status);
}

export function getSePayWebhookHttpStatus(result: SePayWebhookProcessResult) {
  if (isSePayWebhookProcessSuccess(result)) {
    return 200;
  }

  if (result.status === "unmatched" || result.status === "amount_mismatch") {
    return 422;
  }

  return 500;
}

type CardWebhookEventDocument = {
  _id?: ObjectId;
  eventKey: string;
  requestId: string;
  status: "received" | "duplicate" | "processed" | "unmatched" | "failed";
  payload: Pay1sCallbackPayload;
  rawBody: string;
  paymentId?: ObjectId;
  message?: string;
  createdAt: Date;
  updatedAt: Date;
};

type DiamondSaleProviderRequestBody = {
  paymentId: string;
  orderCode: string;
  source: DiamondSalePaymentSource;
  litmatchId: string;
  password: string;
  diamondAmount: number;
  amount: number;
  transferContent: string;
  callbackUrl?: string;
};

export type DiamondSaleProviderWebhookPayload = {
  paymentId?: string;
  orderCode?: string;
  externalRequestId?: string;
  status?: "success" | "failed" | string;
  message?: string;
};

type DiamondSaleWebhookEventDocument = {
  _id?: ObjectId;
  eventKey: string;
  status: "received" | "duplicate" | "processed" | "unmatched" | "failed";
  payload: DiamondSaleProviderWebhookPayload;
  rawBody: string;
  paymentId?: ObjectId;
  message?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentListInput = {
  page?: number;
  pageSize?: number;
  status?: PaymentStatus | "all";
  litmatchId?: string;
  transferContent?: string;
  note?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type LifetimeQrReportInput = {
  status?: PaymentStatus | "all";
  litmatchId?: string;
  transferContent?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type DirectRechargeListInput = {
  page?: number;
  pageSize?: number;
  status?: AdminDirectRechargeDocument["status"] | "all";
  litmatchId?: string;
  note?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type DiamondSalePaymentListInput = {
  page?: number;
  pageSize?: number;
  status?: DiamondSalePaymentStatus | "all";
  source?: DiamondSalePaymentSource | "all";
  litmatchId?: string;
  query?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type BankQrBlacklistListInput = {
  page?: number;
  pageSize?: number;
  status?: AdminBankQrBlacklistStatus | "all";
  litmatchId?: string;
};

export type DeleteIncompletePaymentsResult = {
  deletedCount: number;
};

export type PublicPaymentStatus = {
  id: string;
  type: "bank" | "card" | "diamond-sale";
  bankMode?: BankPaymentMode;
  status: PaymentStatus | DiamondSalePaymentStatus;
  litmatchId: string;
  rewardType: RewardType;
  rewardAmount: number;
  transferContent?: string;
  amount?: number;
  cardProvider?: string;
  cardDenomination?: number;
  providerStatus?: number | null;
  providerMessage?: string | null;
  actualValue?: number | null;
  providerAmount?: number | null;
  rechargeStatus?: "pending" | "completed" | "failed" | null;
  rechargeError?: string | null;
  updatedAt: string;
  createdAt: string;
};

function assertRewardType(value: unknown): asserts value is RewardType {
  if (value !== "diamond" && value !== "star") {
    throw new PaymentValidationError("Loại nhận không hợp lệ.");
  }
}

function normalizeAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new PaymentValidationError("Số tiền thanh toán không hợp lệ.");
  }

  return amount;
}

function normalizeCardDenomination(value: unknown) {
  const denomination = normalizeAmount(value);

  if (!cardDenominations.includes(denomination)) {
    throw new PaymentValidationError("Mệnh giá thẻ không hợp lệ.");
  }

  return denomination;
}

function normalizeCardProvider(value: unknown) {
  const provider = typeof value === "string" ? value.trim().toUpperCase() : "";

  if (!cardProviders.includes(provider)) {
    throw new PaymentValidationError("Loại thẻ không hợp lệ.");
  }

  return provider;
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new PaymentValidationError(`Vui lòng nhập ${fieldName}.`);
  }

  return normalized;
}

function normalizePaymentLitmatchId(value: unknown) {
  const litmatchId = normalizeLitmatchId(typeof value === "string" ? value : "");

  if (!/^\d{5,20}$/.test(litmatchId)) {
    throw new PaymentValidationError("ID Litmatch không hợp lệ.");
  }

  return litmatchId;
}

function normalizeDiamondSalePassword(value: unknown) {
  const password = typeof value === "string" ? value.trim() : "";

  if (
    !password ||
    password.length > 64 ||
    /\s/.test(password) ||
    /[\u0000-\u001F\u007F]/.test(password)
  ) {
    throw new PaymentValidationError(
      "Mật khẩu kim cương xả không hợp lệ. Vui lòng nhập một chuỗi không có khoảng trắng, tối đa 64 ký tự.",
    );
  }

  return password;
}

function maskDiamondSalePassword(password: string) {
  if (!password) {
    return "******";
  }

  if (password.length <= 2) {
    return "******";
  }

  return `${password.slice(0, 1)}${"*".repeat(Math.min(password.length - 2, 6))}${password.slice(-1)}`;
}

function maskDiamondSaleTransferContent(transferContent: string) {
  const parts = transferContent.trim().replace(/\s+/g, " ").split(" ");

  if (parts.length >= 3 && parts[0].toUpperCase() === DIAMOND_SALE_PREFIX) {
    parts[2] = "******";
    return parts.join(" ");
  }

  return transferContent;
}

function normalizeLifetimeQrTransferContent(value: unknown) {
  const normalized =
    typeof value === "string"
      ? value.trim().replace(/\s+/g, " ").toUpperCase()
      : "";
  const parts = normalized.split(" ");
  const rewardType: RewardType | null =
    parts[0] === LIFETIME_QR_DIAMOND_PREFIX
      ? "diamond"
      : parts[0] === LIFETIME_QR_STAR_PREFIX
        ? "star"
        : null;
  const litmatchId =
    parts.length === 2 ? parts[1] : parts.length === 3 ? parts[2] : "";
  const hasValidCtvCode =
    parts.length === 2 || (parts.length === 3 && /^[A-Z0-9]+$/.test(parts[1]));

  if (
    (parts.length !== 2 && parts.length !== 3) ||
    !rewardType ||
    !hasValidCtvCode ||
    !/^\d{5,20}$/.test(litmatchId)
  ) {
    throw new PaymentValidationError(
      "Nội dung QR trọn đời phải có dạng LMKC IDLITMATCH, LMSAO IDLITMATCH hoặc thêm TENCTV ở giữa. ID Litmatch cần 5-20 số, tên CTV chỉ gồm chữ/số không dấu.",
    );
  }

  return {
    transferContent: normalized,
    litmatchId: normalizePaymentLitmatchId(litmatchId),
    rewardType,
  };
}

function assertBankConfig(config: RuntimeConfig) {
  if (
    !config.bank.bankId.trim() ||
    !config.bank.accountNo.trim() ||
    !config.bank.accountName.trim()
  ) {
    throw new PaymentValidationError("Thiếu cấu hình VietQR.");
  }
}

function serializePublicLifetimeBankQr(
  lifetimeQr: LifetimeBankQrDocument,
  config: RuntimeConfig,
): PublicLifetimeBankQr {
  if (!lifetimeQr._id) {
    throw new Error("Lifetime QR document is missing _id");
  }

  const bank = lifetimeQr.configSnapshot.bank ?? config.bank;

  return {
    id: lifetimeQr._id.toString(),
    litmatchId: lifetimeQr.litmatchId,
    rewardType: lifetimeQr.rewardType,
    transferContent: lifetimeQr.transferContent,
    qrUrl: buildVietQrUrl(bank, null, lifetimeQr.transferContent),
  };
}

function serializePublicLifetimeBankQrFromBankPayment(
  payment: BankPaymentDocument,
  config: RuntimeConfig,
): PublicLifetimeBankQr {
  if (!payment._id) {
    throw new Error("Bank payment document is missing _id");
  }

  const bank = payment.configSnapshot.bank ?? config.bank;

  return {
    id: payment._id.toString(),
    litmatchId: payment.litmatchId,
    rewardType: payment.rewardType,
    transferContent: payment.transferContent,
    qrUrl: buildVietQrUrl(bank, null, payment.transferContent),
  };
}

function generateTransferContent(prefix: string) {
  let suffix = "";

  for (let index = 0; index < PAYMENT_CODE_SUFFIX_LENGTH; index += 1) {
    suffix += PAYMENT_CODE_CHARACTERS[randomInt(PAYMENT_CODE_CHARACTERS.length)];
  }

  return `${prefix}${suffix}`;
}

function generateDiamondSaleOrderCode() {
  let suffix = "";

  for (let index = 0; index < DIAMOND_SALE_ORDER_CODE_LENGTH; index += 1) {
    suffix += PAYMENT_CODE_CHARACTERS[randomInt(PAYMENT_CODE_CHARACTERS.length)];
  }

  return `${DIAMOND_SALE_PREFIX}${suffix}`;
}

function serializeDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function serializeBankQrBlacklist(
  item: BankQrBlacklistDocument,
): AdminBankQrBlacklistRow {
  return {
    id: item._id?.toString() ?? "",
    litmatchId: item.litmatchId,
    status: item.status,
    reason: item.reason,
    triggeredByPaymentIds: item.triggeredByPaymentIds.map((id) =>
      id.toString(),
    ),
    blockedAt: item.blockedAt.toISOString(),
    unblockedAt: serializeDate(item.unblockedAt),
    unblockedBy: item.unblockedBy ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function canRetryBankRecharge(payment: BankPaymentDocument) {
  return (
    payment.status === "recharge_failed" &&
    payment.recharge?.status === "failed" &&
    Boolean(payment.paidAt || payment.sepay)
  );
}

function canRetryCardRecharge(payment: CardPaymentDocument) {
  return (
    payment.status === "recharge_failed" &&
    payment.recharge?.status === "failed" &&
    payment.providerStatus === 1
  );
}

function canRetryDiamondSalePayment(payment: DiamondSalePaymentDocument) {
  return payment.status === "failed" && Boolean(payment.paidAt || payment.sepay);
}

function serializeDiamondSalePayment(
  payment: DiamondSalePaymentDocument,
): AdminDiamondSalePaymentRow {
  return {
    id: payment._id?.toString() ?? "",
    source: payment.source,
    status: payment.status,
    litmatchId: payment.litmatchId,
    passwordMasked: maskDiamondSalePassword(payment.password),
    amount: payment.amount,
    diamondAmount: payment.diamondAmount,
    orderCode: payment.orderCode,
    transferContent: maskDiamondSaleTransferContent(payment.transferContent),
    sepayId: payment.sepay?.id ?? null,
    sepayAmount: payment.sepay?.transferAmount ?? null,
    providerExternalRequestId: payment.provider?.externalRequestId ?? null,
    providerMessage: payment.provider?.message ?? null,
    providerError: payment.provider?.error ?? null,
    providerRetryCount: payment.provider?.retryCount ?? 0,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    paidAt: serializeDate(payment.paidAt),
    canRetry: canRetryDiamondSalePayment(payment),
  };
}

function serializePublicDiamondSalePayment(
  payment: DiamondSalePaymentDocument,
  fallbackId: string,
): PublicPaymentStatus {
  return {
    id: payment._id?.toString() ?? fallbackId,
    type: "diamond-sale",
    status: payment.status,
    litmatchId: payment.litmatchId,
    rewardType: "diamond",
    rewardAmount: payment.diamondAmount,
    transferContent: maskDiamondSaleTransferContent(payment.transferContent),
    amount: payment.amount,
    providerMessage: payment.provider?.message ?? null,
    rechargeStatus:
      payment.status === "completed"
        ? "completed"
        : payment.status === "failed"
          ? "failed"
          : payment.status === "provider_pending"
            ? "pending"
            : null,
    rechargeError: payment.provider?.error ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function serializeBankPayment(payment: BankPaymentDocument): AdminBankPaymentRow {
  return {
    id: payment._id?.toString() ?? "",
    bankMode: payment.mode ?? "fixed",
    status: payment.status,
    litmatchId: payment.litmatchId,
    amount: payment.amount,
    rewardType: payment.rewardType,
    rewardAmount: payment.rewardAmount,
    transferContent: payment.transferContent,
    sepayId: payment.sepay?.id ?? null,
    sepayAmount: payment.sepay?.transferAmount ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    paidAt: serializeDate(payment.paidAt),
    rechargeStatus: payment.recharge?.status ?? null,
    rechargeTransferType: payment.recharge?.transferType ?? null,
    rechargeTransferNum: payment.recharge?.transferNum ?? null,
    rechargeError: payment.recharge?.error ?? null,
    rechargeCompletedAt: serializeDate(payment.recharge?.completedAt),
    canRetryRecharge: canRetryBankRecharge(payment),
  };
}

function serializePublicBankPayment(
  payment: BankPaymentDocument,
  fallbackId: string,
): PublicPaymentStatus {
  return {
    id: payment._id?.toString() ?? fallbackId,
    type: "bank",
    bankMode: payment.mode ?? "fixed",
    status: payment.status,
    litmatchId: payment.litmatchId,
    rewardType: payment.rewardType,
    rewardAmount: payment.rewardAmount,
    transferContent: payment.transferContent,
    amount: payment.amount,
    rechargeStatus: payment.recharge?.status ?? null,
    rechargeError: payment.recharge?.error ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function serializeCardPayment(payment: CardPaymentDocument): AdminCardPaymentRow {
  return {
    id: payment._id?.toString() ?? "",
    status: payment.status,
    litmatchId: payment.litmatchId,
    rewardType: payment.rewardType,
    requestId: payment.requestId ?? null,
    cardProvider: payment.cardProvider,
    cardDenomination: payment.cardDenomination,
    rewardAmount: payment.rewardAmount,
    cardCode: payment.cardCode,
    cardSerial: payment.cardSerial,
    providerStatus: payment.providerStatus ?? null,
    providerMessage: payment.providerMessage ?? null,
    providerTransId: payment.providerTransId ?? null,
    declaredValue: payment.declaredValue ?? payment.cardDenomination ?? null,
    actualValue: payment.actualValue ?? null,
    providerAmount: payment.providerAmount ?? null,
    providerDiscountPercent: payment.providerDiscountPercent ?? null,
    rechargeStatus: payment.recharge?.status ?? null,
    rechargeTransferType: payment.recharge?.transferType ?? null,
    rechargeTransferNum: payment.recharge?.transferNum ?? null,
    rechargeError: payment.recharge?.error ?? null,
    rechargeCompletedAt: serializeDate(payment.recharge?.completedAt),
    canRetryRecharge: canRetryCardRecharge(payment),
    note: payment.note ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function normalizePaymentObjectId(value: string) {
  if (!ObjectId.isValid(value)) {
    throw new PaymentNotFoundError();
  }

  return new ObjectId(value);
}

function extractTransferContentCandidates(content: string) {
  const candidates = content.toUpperCase().match(/[A-Z0-9]{12,15}/g) ?? [];

  return [...new Set(candidates)];
}

function getSePayTransferContentCandidates(payload: SePayWebhookPayload) {
  const candidates: string[] = [];
  const payloadCode =
    typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";

  if (payloadCode) {
    candidates.push(payloadCode);
  }

  for (const candidate of extractTransferContentCandidates(
    payload.content ?? "",
  )) {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function extractLifetimeQrContentCandidate(content: string) {
  const normalized = content.trim().replace(/\s+/g, " ").toUpperCase();
  // Bank notify text often glues sub-account digits directly before LMSAO/LMKC,
  // so a leading word boundary would miss valid lifetime QR content.
  const match = normalized.match(
    /(?:LMKC|LMSAO)(?:\s+[A-Z0-9]+)?\s+\d{5,20}(?!\d)/,
  );

  if (!match) {
    return null;
  }

  try {
    return normalizeLifetimeQrTransferContent(match[0]);
  } catch {
    return null;
  }
}

function getSePayLifetimeQrContentCandidate(payload: SePayWebhookPayload) {
  const payloadCode =
    typeof payload.code === "string" ? payload.code.trim() : "";

  if (payloadCode) {
    try {
      return normalizeLifetimeQrTransferContent(payloadCode);
    } catch {
      // Continue with bank notification text; it can contain the transfer
      // content inside a longer description.
    }
  }

  return (
    extractLifetimeQrContentCandidate(payload.content ?? "") ??
    extractLifetimeQrContentCandidate(payload.description ?? "")
  );
}

type DiamondSaleTransferContent = {
  transferContent: string;
  litmatchId: string;
  password: string;
  orderCode?: string;
};

function parseDiamondSaleTransferContent(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^LMXA\s+(\d{5,20})\s+(\S+)(?:\s+(LMXA[A-Z0-9]{4,20}))?$/i);

  if (!match) {
    return null;
  }

  try {
    return {
      transferContent: `${DIAMOND_SALE_PREFIX} ${match[1]} ${normalizeDiamondSalePassword(match[2])}${
        match[3] ? ` ${match[3].toUpperCase()}` : ""
      }`,
      litmatchId: normalizePaymentLitmatchId(match[1]),
      password: normalizeDiamondSalePassword(match[2]),
      orderCode: match[3]?.toUpperCase(),
    } satisfies DiamondSaleTransferContent;
  } catch {
    return null;
  }
}

function extractDiamondSaleTransferContent(content: string) {
  const normalized = content.trim().replace(/\s+/g, " ");
  const match = normalized.match(/LMXA\s+\d{5,20}\s+\S+(?:\s+LMXA[A-Z0-9]{4,20})?/i);

  if (!match) {
    return null;
  }

  return parseDiamondSaleTransferContent(match[0]);
}

function getSePayDiamondSaleTransferContent(payload: SePayWebhookPayload) {
  const payloadCode =
    typeof payload.code === "string" ? payload.code.trim() : "";

  if (payloadCode) {
    const parsedCode = parseDiamondSaleTransferContent(payloadCode);

    if (parsedCode) {
      return parsedCode;
    }
  }

  return (
    extractDiamondSaleTransferContent(payload.content ?? "") ??
    extractDiamondSaleTransferContent(payload.description ?? "")
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không nạp được Litmatch.";
}

function getLitmatchValidationMessage(error: unknown) {
  if (error instanceof LitmatchAgentError && error.code === "NOT_FOUND") {
    return "Không xác minh được ID Litmatch.";
  }

  return getErrorMessage(error);
}

function getDiamondSaleProviderUrl() {
  return process.env.DIAMOND_SALE_API_URL?.trim() ?? "";
}

function getDiamondSaleProviderApiKey() {
  return process.env.DIAMOND_SALE_API_KEY?.trim() ?? "";
}

function getDiamondSaleCallbackUrl() {
  return process.env.DIAMOND_SALE_CALLBACK_URL?.trim() || undefined;
}

function getResponseStringValue(payload: unknown, keys: string[]) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function buildDiamondSaleProviderRequestBody(
  payment: DiamondSalePaymentDocument,
): DiamondSaleProviderRequestBody {
  const paymentId = payment._id?.toString();

  if (!paymentId) {
    throw new Error("Diamond sale payment document is missing _id");
  }

  return {
    paymentId,
    orderCode: payment.orderCode,
    source: payment.source,
    litmatchId: payment.litmatchId,
    password: payment.password,
    diamondAmount: payment.diamondAmount,
    amount: payment.amount,
    transferContent: payment.transferContent,
    callbackUrl: getDiamondSaleCallbackUrl(),
  };
}

async function requestDiamondSaleProvider(
  body: DiamondSaleProviderRequestBody,
) {
  const providerUrl = getDiamondSaleProviderUrl();

  if (!providerUrl) {
    throw new Error("Chưa cấu hình DIAMOND_SALE_API_URL.");
  }

  const apiKey = getDiamondSaleProviderApiKey();
  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Apikey ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let responsePayload: unknown = null;

  try {
    responsePayload = responseText ? JSON.parse(responseText) : null;
  } catch {
    responsePayload = responseText;
  }

  if (!response.ok) {
    const message =
      getResponseStringValue(responsePayload, ["message", "error"]) ??
      `API kim cương xả trả HTTP ${response.status}.`;

    throw new Error(message);
  }

  return {
    request: body,
    response: responsePayload,
    externalRequestId: getResponseStringValue(responsePayload, [
      "externalRequestId",
      "requestId",
      "id",
    ]),
    message:
      getResponseStringValue(responsePayload, ["message", "status"]) ??
      "Đã gửi yêu cầu sang bên thứ ba.",
  };
}

async function sendDiamondSalePaymentToProvider(
  payment: DiamondSalePaymentDocument,
  retryCount = payment.provider?.retryCount ?? 0,
) {
  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Diamond sale payment document is missing _id");
  }

  const collection =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const requestedAt = new Date();
  const requestBody = buildDiamondSaleProviderRequestBody(payment);

  try {
    const providerResult = await requestDiamondSaleProvider(requestBody);
    const updatedAt = new Date();

    await collection.updateOne(
      { _id: paymentId },
      {
        $set: {
          status: "provider_pending",
          updatedAt,
          provider: {
            status: "pending",
            externalRequestId: providerResult.externalRequestId,
            request: providerResult.request,
            response: providerResult.response,
            message: providerResult.message,
            retryCount,
            requestedAt,
            acceptedAt: updatedAt,
          },
        },
      },
    );

    return {
      status: "provider_pending" as const,
      message: providerResult.message,
    };
  } catch (error) {
    const failedAt = new Date();
    const message =
      error instanceof Error
        ? error.message
        : "Không gửi được yêu cầu kim cương xả.";

    await collection.updateOne(
      { _id: paymentId },
      {
        $set: {
          status: "failed",
          updatedAt: failedAt,
          provider: {
            status: "failed",
            request: requestBody,
            error: message,
            retryCount,
            requestedAt,
            failedAt,
          },
        },
      },
    );

    return {
      status: "failed" as const,
      message,
    };
  }
}

function normalizeRewardAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new PaymentValidationError("Số kim cương/sao không hợp lệ.");
  }

  return amount;
}

function normalizeDirectRechargeNote(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const note = String(value).trim().replace(/\s+/g, " ");
  return note ? note.slice(0, 500) : undefined;
}

function normalizeEditableBankTransferContent(value: unknown) {
  const rawValue = typeof value === "string" ? value : "";

  if (/[\x00-\x1F\x7F]/.test(rawValue)) {
    throw new PaymentValidationError(
      "Nội dung chuyển khoản không được chứa ký tự điều khiển.",
    );
  }

  const transferContent = rawValue.trim().replace(/\s+/g, " ").toUpperCase();

  if (!transferContent) {
    throw new PaymentValidationError("Vui lòng nhập nội dung chuyển khoản.");
  }

  if (transferContent.length > 120) {
    throw new PaymentValidationError(
      "Nội dung chuyển khoản không được vượt quá 120 ký tự.",
    );
  }

  return transferContent;
}

function serializeDirectRecharge(
  recharge: AdminDirectRechargeDocument,
): AdminDirectRechargeRow {
  return {
    id: recharge._id?.toString() ?? "",
    status: recharge.status,
    adminUsername: recharge.adminUsername,
    litmatchId: recharge.litmatchId,
    verifiedUser: recharge.verifiedUser
      ? {
          targetUid: recharge.verifiedUser.targetUid,
          avatar: recharge.verifiedUser.avatar,
          bio: recharge.verifiedUser.bio,
          nickname: recharge.verifiedUser.nickname,
        }
      : null,
    rewardType: recharge.rewardType,
    rewardAmount: recharge.rewardAmount,
    note: recharge.note ?? null,
    rechargeStatus: recharge.recharge.status,
    rechargeError: recharge.recharge.error ?? null,
    rechargeCompletedAt: serializeDate(recharge.recharge.completedAt),
    createdAt: recharge.createdAt.toISOString(),
    updatedAt: recharge.updatedAt.toISOString(),
  };
}

function generateCardRequestId() {
  return String(randomInt(CARD_REQUEST_ID_MIN, CARD_REQUEST_ID_MAX));
}

function normalizeProviderStatus(value: unknown) {
  const status = typeof value === "number" ? value : Number(value);

  return Number.isInteger(status) ? status : 0;
}

function normalizeOptionalNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const stringValue = String(value).trim();
  return stringValue || undefined;
}

function providerFailureMessage(status: number, message?: string) {
  if (status === 2) {
    return "Thẻ đúng nhưng sai mệnh giá.";
  }

  return message || "Thẻ lỗi hoặc không xử lý được.";
}

function getPay1sProviderFields(payload: Pay1sChargingResponse) {
  return {
    providerStatus: normalizeProviderStatus(payload.status),
    providerMessage: normalizeOptionalString(payload.message),
    providerTransId: normalizeOptionalString(payload.trans_id),
    declaredValue: normalizeOptionalNumber(payload.declared_value),
    actualValue: normalizeOptionalNumber(payload.value),
    providerAmount: normalizeOptionalNumber(payload.amount),
    providerDiscountPercent: normalizeOptionalNumber(payload.chietkhau),
  };
}

function buildCardWebhookEventKey(payload: Pay1sCallbackPayload) {
  return [
    normalizeOptionalString(payload.request_id) ?? "",
    normalizeProviderStatus(payload.status),
    normalizeOptionalString(payload.trans_id) ?? "",
    normalizeOptionalNumber(payload.value) ?? "",
    normalizeOptionalNumber(payload.amount) ?? "",
  ].join(":");
}

function buildProviderFieldUpdate(payload: Pay1sChargingResponse) {
  const fields = getPay1sProviderFields(payload);
  const update: Record<string, unknown> = {
    providerStatus: fields.providerStatus,
  };

  if (fields.providerMessage !== undefined) {
    update.providerMessage = fields.providerMessage;
  }

  if (fields.providerTransId !== undefined) {
    update.providerTransId = fields.providerTransId;
  }

  if (fields.declaredValue !== undefined) {
    update.declaredValue = fields.declaredValue;
  }

  if (fields.actualValue !== undefined) {
    update.actualValue = fields.actualValue;
  }

  if (fields.providerAmount !== undefined) {
    update.providerAmount = fields.providerAmount;
  }

  if (fields.providerDiscountPercent !== undefined) {
    update.providerDiscountPercent = fields.providerDiscountPercent;
  }

  return update;
}

async function rechargeBankPaymentAfterPaid(payment: BankPaymentDocument) {
  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  const bankPayments =
    await getCollection<BankPaymentDocument>("bank_payments");
  const transferType = toTransferAssetType(payment.rewardType);
  const requestedAt = new Date();

  await bankPayments.updateOne(
    { _id: paymentId, status: "paid" },
    {
      $set: {
        updatedAt: requestedAt,
        recharge: {
          targetUid: payment.litmatchId,
          transferType,
          transferNum: payment.rewardAmount,
          status: "pending",
          requestedAt,
        },
      },
    },
  );

  try {
    const verifiedUser =
      payment.verifiedUser ??
      (await litmatchAgent.getTargetUserInfo(payment.litmatchId));
    const response = await litmatchAgent.transferAccount({
      targetUid: verifiedUser.targetUid,
      rewardType: payment.rewardType,
      transferNum: payment.rewardAmount,
    });
    const completedAt = new Date();

    await bankPayments.updateOne(
      { _id: paymentId, status: "paid" },
      {
        $set: {
          status: "completed",
          updatedAt: completedAt,
          "recharge.status": "completed",
          "recharge.response": response,
          "recharge.completedAt": completedAt,
        },
        $unset: {
          "recharge.error": "",
          "recharge.failedAt": "",
        },
      },
    );

    return { status: "recharge_completed" as const };
  } catch (error) {
    const failedAt = new Date();

    await bankPayments.updateOne(
      { _id: paymentId, status: "paid" },
      {
        $set: {
          status: "recharge_failed",
          updatedAt: failedAt,
          "recharge.status": "failed",
          "recharge.error": getErrorMessage(error),
          "recharge.failedAt": failedAt,
        },
      },
    );

    return {
      status: "recharge_failed" as const,
      error: getErrorMessage(error),
    };
  }
}

async function rechargeCardPaymentAfterPaid(payment: CardPaymentDocument) {
  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  const cardPayments =
    await getCollection<CardPaymentDocument>("card_payments");
  const transferType = toTransferAssetType(payment.rewardType);
  const requestedAt = new Date();

  await cardPayments.updateOne(
    { _id: paymentId, status: "paid" },
    {
      $set: {
        updatedAt: requestedAt,
        recharge: {
          targetUid: payment.litmatchId,
          transferType,
          transferNum: payment.rewardAmount,
          status: "pending",
          requestedAt,
        },
      },
    },
  );

  try {
    const verifiedUser =
      payment.verifiedUser ??
      (await litmatchAgent.getTargetUserInfo(payment.litmatchId));
    const response = await litmatchAgent.transferAccount({
      targetUid: verifiedUser.targetUid,
      rewardType: payment.rewardType,
      transferNum: payment.rewardAmount,
    });
    const completedAt = new Date();

    await cardPayments.updateOne(
      { _id: paymentId, status: "paid" },
      {
        $set: {
          status: "completed",
          updatedAt: completedAt,
          "recharge.status": "completed",
          "recharge.response": response,
          "recharge.completedAt": completedAt,
        },
        $unset: {
          "recharge.error": "",
          "recharge.failedAt": "",
        },
      },
    );

    return { status: "completed" as const };
  } catch (error) {
    const failedAt = new Date();

    await cardPayments.updateOne(
      { _id: paymentId, status: "paid" },
      {
        $set: {
          status: "recharge_failed",
          updatedAt: failedAt,
          "recharge.status": "failed",
          "recharge.error": getErrorMessage(error),
          "recharge.failedAt": failedAt,
        },
      },
    );

    return {
      status: "recharge_failed" as const,
      error: getErrorMessage(error),
    };
  }
}

async function applyPay1sCardResult(
  payment: CardPaymentDocument,
  payload: Pay1sChargingResponse,
  extraProviderFields: Record<string, unknown> = {},
) {
  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  const cardPayments =
    await getCollection<CardPaymentDocument>("card_payments");
  const providerFields = buildProviderFieldUpdate(payload);
  const providerStatus = normalizeProviderStatus(payload.status);
  const providerMessage = normalizeOptionalString(payload.message);
  const now = new Date();

  if (providerStatus === 99) {
    await cardPayments.updateOne(
      { _id: paymentId, status: { $in: ["incomplete", "processing"] } },
      {
        $set: {
          ...providerFields,
          ...extraProviderFields,
          status: "processing",
          updatedAt: now,
        },
      },
    );

    return {
      status: "processing" as const,
      providerStatus,
      message: providerMessage ?? "Thẻ đang chờ xử lý.",
    };
  }

  if (providerStatus === 1) {
    const updateResult = await cardPayments.updateOne(
      { _id: paymentId, status: { $in: ["incomplete", "processing"] } },
      {
        $set: {
          ...providerFields,
          ...extraProviderFields,
          status: "paid",
          updatedAt: now,
        },
      },
    );

    if (!updateResult.modifiedCount) {
      return {
        status: payment.status,
        providerStatus,
        message: "Giao dịch đã được xử lý trước đó.",
      };
    }

    const rechargeResult = await rechargeCardPaymentAfterPaid(payment);

    return {
      status: rechargeResult.status,
      providerStatus,
      message:
        rechargeResult.status === "completed"
          ? "Thẻ đúng, đã nạp Litmatch thành công."
          : rechargeResult.error,
    };
  }

  const errorMessage = providerFailureMessage(providerStatus, providerMessage);
  const failedAt = new Date();

  await cardPayments.updateOne(
    { _id: paymentId, status: { $ne: "completed" } },
    {
      $set: {
        ...providerFields,
        ...extraProviderFields,
        status: "recharge_failed",
        updatedAt: failedAt,
        recharge: {
          targetUid: payment.litmatchId,
          transferType: toTransferAssetType(payment.rewardType),
          transferNum: payment.rewardAmount,
          status: "failed",
          error: errorMessage,
          requestedAt: failedAt,
          failedAt,
        },
      },
    },
  );

  return {
    status: "recharge_failed" as const,
    providerStatus,
    message: errorMessage,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeListPage(value: unknown) {
  const page = typeof value === "number" ? value : Number(value);

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizeListPageSize(value: unknown) {
  const pageSize = typeof value === "number" ? value : Number(value);

  return Number.isInteger(pageSize) && pageSize > 0
    ? Math.min(pageSize, ADMIN_PAYMENT_PAGE_SIZE)
    : ADMIN_PAYMENT_PAGE_SIZE;
}

function parseVietnamDayStart(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseVietnamDayEndExclusive(value?: string) {
  const start = parseVietnamDayStart(value);

  if (!start) {
    return null;
  }

  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function buildCommonPaymentFilter<TDocument extends { updatedAt: Date }>(
  input: PaymentListInput,
): Filter<TDocument> {
  const filter: Filter<TDocument> = {};

  if (
    input.status === "incomplete" ||
    input.status === "processing" ||
    input.status === "paid" ||
    input.status === "completed" ||
    input.status === "recharge_failed"
  ) {
    Object.assign(filter, { status: input.status });
  }

  const litmatchId = input.litmatchId?.replace(/\D/g, "");

  if (litmatchId) {
    Object.assign(filter, { litmatchId: { $regex: escapeRegex(litmatchId) } });
  }

  const updatedFrom = parseVietnamDayStart(input.updatedFrom);
  const updatedTo = parseVietnamDayEndExclusive(input.updatedTo);

  if (updatedFrom || updatedTo) {
    Object.assign(filter, {
      updatedAt: {
        ...(updatedFrom ? { $gte: updatedFrom } : {}),
        ...(updatedTo ? { $lt: updatedTo } : {}),
      },
    });
  }

  return filter;
}

function buildBankPaymentFilter(input: PaymentListInput) {
  const filter = buildCommonPaymentFilter<BankPaymentDocument>(input);
  const transferContentTokens =
    input.transferContent
      ?.trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean) ?? [];

  if (transferContentTokens.length === 1) {
    Object.assign(filter, {
      transferContent: {
        $regex: escapeRegex(transferContentTokens[0]),
        $options: "i",
      },
    });
  }

  if (transferContentTokens.length > 1) {
    Object.assign(filter, {
      $and: transferContentTokens.map((token) => ({
        transferContent: {
          $regex: escapeRegex(token),
          $options: "i",
        },
      })),
    });
  }

  return filter;
}

function addNoteFilter<TDocument>(filter: Filter<TDocument>, note?: string) {
  const noteTokens =
    note
      ?.trim()
      .split(/\s+/)
      .filter(Boolean) ?? [];

  if (noteTokens.length === 1) {
    Object.assign(filter, {
      note: {
        $regex: escapeRegex(noteTokens[0]),
        $options: "i",
      },
    });
  }

  if (noteTokens.length > 1) {
    Object.assign(filter, {
      $and: noteTokens.map((token) => ({
        note: {
          $regex: escapeRegex(token),
          $options: "i",
        },
      })),
    });
  }
}

function buildCardPaymentFilter(input: PaymentListInput) {
  const filter = buildCommonPaymentFilter<CardPaymentDocument>(input);

  addNoteFilter(filter, input.note);

  return filter;
}

function buildDirectRechargeFilter(input: DirectRechargeListInput) {
  const filter: Filter<AdminDirectRechargeDocument> = {};

  if (
    input.status === "pending" ||
    input.status === "completed" ||
    input.status === "failed"
  ) {
    Object.assign(filter, { status: input.status });
  }

  const litmatchId = input.litmatchId?.replace(/\D/g, "");

  if (litmatchId) {
    Object.assign(filter, { litmatchId: { $regex: escapeRegex(litmatchId) } });
  }

  addNoteFilter(filter, input.note);

  const updatedFrom = parseVietnamDayStart(input.updatedFrom);
  const updatedTo = parseVietnamDayEndExclusive(input.updatedTo);

  if (updatedFrom || updatedTo) {
    Object.assign(filter, {
      updatedAt: {
        ...(updatedFrom ? { $gte: updatedFrom } : {}),
        ...(updatedTo ? { $lt: updatedTo } : {}),
      },
    });
  }

  return filter;
}

function buildDiamondSalePaymentFilter(input: DiamondSalePaymentListInput) {
  const filter: Filter<DiamondSalePaymentDocument> = {};

  if (
    input.status === "incomplete" ||
    input.status === "paid" ||
    input.status === "provider_pending" ||
    input.status === "completed" ||
    input.status === "failed"
  ) {
    Object.assign(filter, { status: input.status });
  }

  if (input.source === "frontend_qr" || input.source === "manual_transfer") {
    Object.assign(filter, { source: input.source });
  }

  const litmatchId = input.litmatchId?.replace(/\D/g, "");

  if (litmatchId) {
    Object.assign(filter, { litmatchId: { $regex: escapeRegex(litmatchId) } });
  }

  const queryTokens =
    input.query
      ?.trim()
      .split(/\s+/)
      .filter(Boolean) ?? [];

  if (queryTokens.length) {
    Object.assign(filter, {
      $and: queryTokens.map((token) => ({
        $or: [
          {
            orderCode: {
              $regex: escapeRegex(token),
              $options: "i",
            },
          },
          {
            transferContent: {
              $regex: escapeRegex(token),
              $options: "i",
            },
          },
        ],
      })),
    });
  }

  const updatedFrom = parseVietnamDayStart(input.updatedFrom);
  const updatedTo = parseVietnamDayEndExclusive(input.updatedTo);

  if (updatedFrom || updatedTo) {
    Object.assign(filter, {
      updatedAt: {
        ...(updatedFrom ? { $gte: updatedFrom } : {}),
        ...(updatedTo ? { $lt: updatedTo } : {}),
      },
    });
  }

  return filter;
}

function buildLifetimeQrPaymentFilter(input: LifetimeQrReportInput) {
  const filter = {
    ...buildBankPaymentFilter(input),
    mode: "lifetime" as const,
  };
  const paidFrom = parseVietnamDayStart(input.updatedFrom);
  const paidTo = parseVietnamDayEndExclusive(input.updatedTo);

  delete filter.updatedAt;

  if (paidFrom || paidTo) {
    Object.assign(filter, {
      paidAt: {
        ...(paidFrom ? { $gte: paidFrom } : {}),
        ...(paidTo ? { $lt: paidTo } : {}),
      },
    });
  }

  return filter;
}

function buildBankQrBlacklistFilter(input: BankQrBlacklistListInput) {
  const filter: Filter<BankQrBlacklistDocument> = {};

  if (input.status === "active" || input.status === "unblocked") {
    Object.assign(filter, { status: input.status });
  }

  const litmatchId = input.litmatchId?.replace(/\D/g, "");

  if (litmatchId) {
    Object.assign(filter, { litmatchId: { $regex: escapeRegex(litmatchId) } });
  }

  return filter;
}

async function paginatePayments<TDocument extends { updatedAt: Date }, TRow>({
  collectionName,
  filter,
  input,
  serialize,
}: {
  collectionName: string;
  filter: Filter<TDocument>;
  input: {
    page?: number;
    pageSize?: number;
  };
  serialize: (payment: TDocument) => TRow;
}): Promise<AdminPaginatedPayments<TRow>> {
  const page = normalizeListPage(input.page);
  const pageSize = normalizeListPageSize(input.pageSize);
  const collection = await getCollection<TDocument>(collectionName);
  const total = await collection.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = await collection
    .find(filter)
    .sort({ updatedAt: -1 })
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  return {
    rows: rows.map((payment) => serialize(payment as TDocument)),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

const emptyBankPaymentSummary: AdminBankPaymentSummary = {
  paymentCount: 0,
  completedCount: 0,
  rechargeFailedCount: 0,
  totalAmount: 0,
  totalRewardAmount: 0,
  diamondRewardAmount: 0,
  starRewardAmount: 0,
};

async function summarizeBankPayments(filter: Filter<BankPaymentDocument>) {
  const collection = await getCollection<BankPaymentDocument>("bank_payments");
  const [summary] = await collection
    .aggregate<AdminBankPaymentSummary>([
      { $match: filter },
      {
        $group: {
          _id: null,
          paymentCount: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          rechargeFailedCount: {
            $sum: { $cond: [{ $eq: ["$status", "recharge_failed"] }, 1, 0] },
          },
          totalAmount: { $sum: "$amount" },
          totalRewardAmount: { $sum: "$rewardAmount" },
          diamondRewardAmount: {
            $sum: {
              $cond: [{ $eq: ["$rewardType", "diamond"] }, "$rewardAmount", 0],
            },
          },
          starRewardAmount: {
            $sum: {
              $cond: [{ $eq: ["$rewardType", "star"] }, "$rewardAmount", 0],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ])
    .toArray();

  return summary ?? emptyBankPaymentSummary;
}

const emptyCardPaymentSummary: AdminCardPaymentSummary = {
  paymentCount: 0,
  completedCount: 0,
  rechargeFailedCount: 0,
  totalDeclaredAmount: 0,
  totalActualAmount: 0,
  totalRewardAmount: 0,
  diamondRewardAmount: 0,
  starRewardAmount: 0,
};

async function summarizeCardPayments(filter: Filter<CardPaymentDocument>) {
  const collection = await getCollection<CardPaymentDocument>("card_payments");
  const [summary] = await collection
    .aggregate<AdminCardPaymentSummary>([
      { $match: filter },
      {
        $group: {
          _id: null,
          paymentCount: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          rechargeFailedCount: {
            $sum: { $cond: [{ $eq: ["$status", "recharge_failed"] }, 1, 0] },
          },
          totalDeclaredAmount: {
            $sum: { $ifNull: ["$declaredValue", "$cardDenomination"] },
          },
          totalActualAmount: {
            $sum: { $ifNull: ["$actualValue", 0] },
          },
          totalRewardAmount: { $sum: "$rewardAmount" },
          diamondRewardAmount: {
            $sum: {
              $cond: [{ $eq: ["$rewardType", "diamond"] }, "$rewardAmount", 0],
            },
          },
          starRewardAmount: {
            $sum: {
              $cond: [{ $eq: ["$rewardType", "star"] }, "$rewardAmount", 0],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ])
    .toArray();

  return summary ?? emptyCardPaymentSummary;
}

const emptyDirectRechargeSummary: AdminDirectRechargeSummary = {
  rechargeCount: 0,
  completedCount: 0,
  failedCount: 0,
  totalRewardAmount: 0,
  diamondRewardAmount: 0,
  starRewardAmount: 0,
};

async function summarizeDirectRecharges(
  filter: Filter<AdminDirectRechargeDocument>,
) {
  const collection =
    await getCollection<AdminDirectRechargeDocument>("admin_direct_recharges");
  const [summary] = await collection
    .aggregate<AdminDirectRechargeSummary>([
      { $match: filter },
      {
        $group: {
          _id: null,
          rechargeCount: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          totalRewardAmount: { $sum: "$rewardAmount" },
          diamondRewardAmount: {
            $sum: {
              $cond: [{ $eq: ["$rewardType", "diamond"] }, "$rewardAmount", 0],
            },
          },
          starRewardAmount: {
            $sum: {
              $cond: [{ $eq: ["$rewardType", "star"] }, "$rewardAmount", 0],
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ])
    .toArray();

  return summary ?? emptyDirectRechargeSummary;
}

const emptyDiamondSalePaymentSummary: AdminDiamondSalePaymentSummary = {
  paymentCount: 0,
  manualTransferCount: 0,
  incompleteCount: 0,
  providerPendingCount: 0,
  completedCount: 0,
  failedCount: 0,
  totalAmount: 0,
  totalDiamondAmount: 0,
};

async function summarizeDiamondSalePayments(
  filter: Filter<DiamondSalePaymentDocument>,
) {
  const collection =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const [summary] = await collection
    .aggregate<AdminDiamondSalePaymentSummary>([
      { $match: filter },
      {
        $group: {
          _id: null,
          paymentCount: { $sum: 1 },
          manualTransferCount: {
            $sum: { $cond: [{ $eq: ["$source", "manual_transfer"] }, 1, 0] },
          },
          incompleteCount: {
            $sum: { $cond: [{ $eq: ["$status", "incomplete"] }, 1, 0] },
          },
          providerPendingCount: {
            $sum: { $cond: [{ $eq: ["$status", "provider_pending"] }, 1, 0] },
          },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          totalAmount: { $sum: "$amount" },
          totalDiamondAmount: { $sum: "$diamondAmount" },
        },
      },
      { $project: { _id: 0 } },
    ])
    .toArray();

  return summary ?? emptyDiamondSalePaymentSummary;
}

async function assertPaymentCreationNotBlacklisted(litmatchId: string) {
  const blacklist =
    await getCollection<BankQrBlacklistDocument>("bank_qr_blacklist");
  const activeBlacklist = await blacklist.findOne({
    litmatchId,
    status: "active",
  });

  if (activeBlacklist) {
    throw new PaymentValidationError(PAYMENT_BLACKLIST_ERROR);
  }

  const latestUnblockedBlacklist = await blacklist.findOne(
    {
      litmatchId,
      status: "unblocked",
      unblockedAt: { $exists: true },
    },
    { sort: { unblockedAt: -1, updatedAt: -1 } },
  );

  return latestUnblockedBlacklist?.unblockedAt
    ? { createdAt: { $gt: latestUnblockedBlacklist.unblockedAt } }
    : {};
}

async function activatePaymentBlacklist(input: {
  litmatchId: string;
  reason: string;
  triggeredByPaymentIds: ObjectId[];
}) {
  const blacklist =
    await getCollection<BankQrBlacklistDocument>("bank_qr_blacklist");
  const now = new Date();

  await blacklist.updateOne(
    { litmatchId: input.litmatchId, status: "active" },
    {
      $setOnInsert: {
        litmatchId: input.litmatchId,
        status: "active",
        createdAt: now,
      },
      $set: {
        reason: input.reason,
        triggeredByPaymentIds: input.triggeredByPaymentIds,
        blockedAt: now,
        updatedAt: now,
      },
      $unset: {
        unblockedAt: "",
        unblockedBy: "",
      },
    },
    { upsert: true },
  );
}

function collectPaymentObjectIds(payments: Array<{ _id?: ObjectId }>) {
  return payments
    .map((payment) => payment._id)
    .filter((id): id is ObjectId => Boolean(id));
}

function isSuccessfulCardPayment(payment: CardPaymentDocument) {
  return payment.status === "completed";
}

async function assertBankQrCreationAllowed(litmatchId: string) {
  const createdAfterUnblock =
    await assertPaymentCreationNotBlacklisted(litmatchId);
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const recentFixedPayments = await bankPayments
    .find({
      litmatchId,
      ...createdAfterUnblock,
      $or: [{ mode: "fixed" }, { mode: { $exists: false } }],
    })
    .sort({ createdAt: -1 })
    .limit(PAYMENT_BLACKLIST_LIMIT)
    .toArray();

  if (
    recentFixedPayments.length < PAYMENT_BLACKLIST_LIMIT ||
    recentFixedPayments.some((payment) => payment.status !== "incomplete")
  ) {
    return;
  }

  await activatePaymentBlacklist({
    litmatchId,
    reason: BANK_QR_BLACKLIST_REASON,
    triggeredByPaymentIds: collectPaymentObjectIds(recentFixedPayments),
  });

  throw new PaymentValidationError(PAYMENT_BLACKLIST_ERROR);
}

async function assertCardPaymentCreationAllowed(litmatchId: string) {
  const createdAfterUnblock =
    await assertPaymentCreationNotBlacklisted(litmatchId);
  const cardPayments =
    await getCollection<CardPaymentDocument>("card_payments");
  const recentCardPayments = await cardPayments
    .find({
      litmatchId,
      ...createdAfterUnblock,
    })
    .sort({ createdAt: -1 })
    .limit(PAYMENT_BLACKLIST_LIMIT)
    .toArray();

  if (
    recentCardPayments.length < PAYMENT_BLACKLIST_LIMIT ||
    recentCardPayments.some(isSuccessfulCardPayment)
  ) {
    return;
  }

  await activatePaymentBlacklist({
    litmatchId,
    reason: CARD_PAYMENT_BLACKLIST_REASON,
    triggeredByPaymentIds: collectPaymentObjectIds(recentCardPayments),
  });

  throw new PaymentValidationError(PAYMENT_BLACKLIST_ERROR);
}

export async function createBankPayment(input: {
  litmatchId?: unknown;
  amount?: unknown;
  rewardType?: unknown;
}) {
  const config = await getRuntimeConfig();
  assertBankConfig(config);

  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const amount = normalizeAmount(input.amount);
  const rewardType = input.rewardType;
  assertRewardType(rewardType);
  await assertBankQrCreationAllowed(litmatchId);

  let verifiedUser: TargetUserInfo;

  try {
    verifiedUser = await litmatchAgent.getTargetUserInfo(litmatchId);
  } catch (error) {
    if (
      error instanceof LitmatchAgentError &&
      error.code === "NOT_FOUND"
    ) {
      throw new PaymentValidationError("Không xác minh được ID Litmatch.");
    }

    throw error;
  }

  const rewardAmount = calculateReceiveAmount(
    amount,
    rewardType,
    config.bankRate,
  );
  const collection = await getCollection<BankPaymentDocument>("bank_payments");
  const lifetimeQrCollection =
    await getCollection<LifetimeBankQrDocument>("lifetime_bank_qrs");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const transferContent = generateTransferContent(config.paymentCodePrefix);
    const existingLifetimeQr = await lifetimeQrCollection.findOne({
      transferContent,
    });

    if (existingLifetimeQr) {
      continue;
    }

    const now = new Date();
    const payment: BankPaymentDocument = {
      mode: "fixed",
      status: "incomplete" as const,
      litmatchId,
      verifiedUser: {
        ...verifiedUser,
        verifiedAt: now,
      },
      amount,
      rewardType,
      rewardAmount,
      transferContent,
      configSnapshot: {
        bank: config.bank,
        bankRate: config.bankRate,
        paymentCodePrefix: config.paymentCodePrefix,
      },
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await collection.insertOne(payment);

      return {
        id: result.insertedId.toString(),
        amount,
        rewardType,
        rewardAmount,
        transferContent,
        qrUrl: buildVietQrUrl(config.bank, amount, transferContent),
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Could not generate a unique transfer content");
}

export async function createDiamondSalePayment(input: {
  litmatchId?: unknown;
  password?: unknown;
  amount?: unknown;
}) {
  const config = await getRuntimeConfig();
  assertBankConfig(config);

  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const password = normalizeDiamondSalePassword(input.password);
  const amount = normalizeAmount(input.amount);
  const diamondAmount = calculateDiamondSaleAmount(
    amount,
    config.diamondSaleRate,
  );
  const collection =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderCode = generateDiamondSaleOrderCode();
    const transferContent = `${DIAMOND_SALE_PREFIX} ${litmatchId} ${password} ${orderCode}`;
    const now = new Date();
    const payment: DiamondSalePaymentDocument = {
      source: "frontend_qr",
      status: "incomplete",
      litmatchId,
      password,
      amount,
      diamondAmount,
      orderCode,
      transferContent,
      configSnapshot: {
        bank: config.bank,
        diamondSaleRate: config.diamondSaleRate,
        paymentCodePrefix: config.paymentCodePrefix,
      },
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await collection.insertOne(payment);

      return {
        id: result.insertedId.toString(),
        type: "diamond-sale" as const,
        amount,
        rewardType: "diamond" as const,
        rewardAmount: diamondAmount,
        diamondAmount,
        orderCode,
        transferContent,
        maskedTransferContent: maskDiamondSaleTransferContent(transferContent),
        qrUrl: buildVietQrUrl(config.bank, amount, transferContent),
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Could not generate a unique diamond sale order code");
}

export async function createLifetimeBankQr(input: {
  litmatchId?: unknown;
  rewardType?: unknown;
  transferContent?: unknown;
}) {
  const config = await getRuntimeConfig();
  assertBankConfig(config);

  const {
    transferContent,
    litmatchId,
    rewardType: contentRewardType,
  } = normalizeLifetimeQrTransferContent(input.transferContent);
  const rewardType = input.rewardType ?? contentRewardType;
  assertRewardType(rewardType);

  if (rewardType !== contentRewardType) {
    throw new PaymentValidationError(
      "Loại nhận không khớp nội dung chuyển khoản. LMKC dùng cho kim cương, LMSAO dùng cho sao.",
    );
  }

  let verifiedUser: TargetUserInfo;

  try {
    verifiedUser = await litmatchAgent.getTargetUserInfo(litmatchId);
  } catch (error) {
    if (error instanceof LitmatchAgentError && error.code === "NOT_FOUND") {
      throw new PaymentValidationError("Không xác minh được ID Litmatch.");
    }

    throw error;
  }

  const collection =
    await getCollection<LifetimeBankQrDocument>("lifetime_bank_qrs");
  const bankPayments =
    await getCollection<BankPaymentDocument>("bank_payments");
  const existingLifetimeQr = await collection.findOne({ transferContent });

  if (existingLifetimeQr) {
    throw new DuplicateLifetimeBankQrError(
      "Nội dung chuyển khoản này đã tồn tại. Vui lòng nhập nội dung khác.",
      serializePublicLifetimeBankQr(existingLifetimeQr, config),
    );
  }

  const existingBankPayment = await bankPayments.findOne({ transferContent });

  if (existingBankPayment) {
    throw new DuplicateLifetimeBankQrError(
      "Nội dung chuyển khoản này đã có giao dịch. Vui lòng nhập nội dung khác.",
      serializePublicLifetimeBankQrFromBankPayment(existingBankPayment, config),
    );
  }

  const now = new Date();
  const lifetimeQr: LifetimeBankQrDocument = {
    status: "active",
    litmatchId,
    verifiedUser: {
      ...verifiedUser,
      verifiedAt: now,
    },
    rewardType,
    transferContent,
    configSnapshot: {
      bank: config.bank,
      paymentCodePrefix: config.paymentCodePrefix,
    },
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await collection.insertOne(lifetimeQr);

    return {
      id: result.insertedId.toString(),
      litmatchId,
      rewardType,
      transferContent,
      qrUrl: buildVietQrUrl(config.bank, null, transferContent),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const duplicateLifetimeQr = await collection.findOne({ transferContent });

      if (duplicateLifetimeQr) {
        throw new DuplicateLifetimeBankQrError(
          "Nội dung chuyển khoản này đã tồn tại. Vui lòng nhập nội dung khác.",
          serializePublicLifetimeBankQr(duplicateLifetimeQr, config),
        );
      }

      throw new PaymentValidationError(
        "Nội dung chuyển khoản này đã tồn tại. Vui lòng nhập nội dung khác.",
      );
    }

    throw error;
  }
}

export async function createCardPayment(input: {
  litmatchId?: unknown;
  rewardType?: unknown;
  cardProvider?: unknown;
  cardDenomination?: unknown;
  cardCode?: unknown;
  cardSerial?: unknown;
}) {
  const config = await getRuntimeConfig();
  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const rewardType = input.rewardType;
  assertRewardType(rewardType);

  const cardProvider = normalizeCardProvider(input.cardProvider);
  const cardDenomination = normalizeCardDenomination(input.cardDenomination);
  const cardCode = normalizeRequiredString(input.cardCode, "mã thẻ");
  const cardSerial = normalizeRequiredString(input.cardSerial, "số seri");
  await assertCardPaymentCreationAllowed(litmatchId);
  let verifiedUser: TargetUserInfo;

  try {
    verifiedUser = await litmatchAgent.getTargetUserInfo(litmatchId);
  } catch (error) {
    if (
      error instanceof LitmatchAgentError &&
      error.code === "NOT_FOUND"
    ) {
      throw new PaymentValidationError("Không xác minh được ID Litmatch.");
    }

    throw error;
  }

  const rewardAmount = calculateReceiveAmount(
    cardDenomination,
    rewardType,
    config.cardRate,
  );
  const collection = await getCollection<CardPaymentDocument>("card_payments");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const requestId = generateCardRequestId();
    const now = new Date();
    const payment: CardPaymentDocument = {
      status: "processing",
      litmatchId,
      verifiedUser: {
        ...verifiedUser,
        verifiedAt: now,
      },
      rewardType,
      requestId,
      cardProvider,
      cardDenomination,
      declaredValue: cardDenomination,
      rewardAmount,
      cardCode,
      cardSerial,
      configSnapshot: {
        cardRate: config.cardRate,
        paymentCodePrefix: config.paymentCodePrefix,
      },
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await collection.insertOne(payment);
      const savedPayment = {
        ...payment,
        _id: result.insertedId,
      };

      try {
        const providerResult = await chargePay1sCard({
          requestId,
          code: cardCode,
          serial: cardSerial,
          telco: cardProvider,
          amount: cardDenomination,
        });
        const cardResult = await applyPay1sCardResult(
          savedPayment,
          providerResult.response,
          {
            providerRequest: providerResult.request,
            providerResponse: providerResult.response,
          },
        );

        return {
          id: result.insertedId.toString(),
          status: cardResult.status,
          providerStatus: cardResult.providerStatus,
          message: cardResult.message,
          rewardType,
          cardProvider,
          cardDenomination,
          rewardAmount,
        };
      } catch (error) {
        const failedAt = new Date();
        const message =
          error instanceof Pay1sClientError
            ? error.message
            : "Không gửi được thẻ sang PAY1S.";

        await collection.updateOne(
          { _id: result.insertedId, status: { $ne: "completed" } },
          {
            $set: {
              status: "recharge_failed",
              providerMessage: message,
              updatedAt: failedAt,
              recharge: {
                targetUid: litmatchId,
                transferType: toTransferAssetType(rewardType),
                transferNum: rewardAmount,
                status: "failed",
                error: message,
                requestedAt: failedAt,
                failedAt,
              },
            },
          },
        );

        throw new PaymentValidationError(message);
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Could not generate a unique card request id");
}

export async function listBankPayments(
  input: PaymentListInput = {},
): Promise<AdminPaginatedBankPayments> {
  const filter = buildBankPaymentFilter(input);
  const page = await paginatePayments<BankPaymentDocument, AdminBankPaymentRow>({
    collectionName: "bank_payments",
    filter,
    input,
    serialize: serializeBankPayment,
  });

  return {
    ...page,
    summary: await summarizeBankPayments(filter),
  };
}

export async function listCardPayments(
  input: PaymentListInput = {},
): Promise<AdminPaginatedCardPayments> {
  const filter = buildCardPaymentFilter(input);
  const page = await paginatePayments<CardPaymentDocument, AdminCardPaymentRow>({
    collectionName: "card_payments",
    filter,
    input,
    serialize: serializeCardPayment,
  });

  return {
    ...page,
    summary: await summarizeCardPayments(filter),
  };
}

export async function listDiamondSalePayments(
  input: DiamondSalePaymentListInput = {},
): Promise<AdminPaginatedDiamondSalePayments> {
  const filter = buildDiamondSalePaymentFilter(input);
  const page = await paginatePayments<
    DiamondSalePaymentDocument,
    AdminDiamondSalePaymentRow
  >({
    collectionName: "diamond_sale_payments",
    filter,
    input,
    serialize: serializeDiamondSalePayment,
  });

  return {
    ...page,
    summary: await summarizeDiamondSalePayments(filter),
  };
}

export async function updateBankPaymentTransferContent(input: {
  paymentId?: unknown;
  transferContent?: unknown;
}): Promise<AdminBankPaymentRow> {
  if (typeof input.paymentId !== "string") {
    throw new PaymentNotFoundError();
  }

  const paymentId = normalizePaymentObjectId(input.paymentId);
  const transferContent = normalizeEditableBankTransferContent(
    input.transferContent,
  );
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const payment = await bankPayments.findOne({ _id: paymentId });

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  if (!payment.paidAt && !payment.sepay) {
    throw new PaymentValidationError(
      "Chỉ được sửa nội dung chuyển khoản của giao dịch đã nhận tiền.",
    );
  }

  if (payment.transferContent === transferContent) {
    return serializeBankPayment(payment);
  }

  const lifetimeQrs =
    await getCollection<LifetimeBankQrDocument>("lifetime_bank_qrs");
  const duplicateLifetimeQr = await lifetimeQrs.findOne({ transferContent });

  if (duplicateLifetimeQr) {
    throw new PaymentValidationError(
      "Nội dung chuyển khoản này đang thuộc QR trọn đời. Vui lòng nhập nội dung khác.",
    );
  }

  const updatedAt = new Date();
  const updatedPayment = await bankPayments.findOneAndUpdate(
    { _id: paymentId },
    {
      $set: {
        transferContent,
        updatedAt,
      },
    },
    { returnDocument: "after" },
  );

  if (!updatedPayment) {
    throw new PaymentNotFoundError();
  }

  return serializeBankPayment(updatedPayment);
}

export async function updateCardPaymentNote(input: {
  paymentId?: unknown;
  note?: unknown;
}): Promise<AdminCardPaymentRow> {
  if (typeof input.paymentId !== "string") {
    throw new PaymentNotFoundError();
  }

  const paymentId = normalizePaymentObjectId(input.paymentId);
  const note = normalizeDirectRechargeNote(input.note);
  const cardPayments = await getCollection<CardPaymentDocument>("card_payments");
  const updatedAt = new Date();
  const update: UpdateFilter<CardPaymentDocument> =
    note === undefined
      ? {
          $set: { updatedAt },
          $unset: { note: "" },
        }
      : {
          $set: { note, updatedAt },
        };
  const updatedPayment = await cardPayments.findOneAndUpdate(
    { _id: paymentId },
    update,
    { returnDocument: "after" },
  );

  if (!updatedPayment) {
    throw new PaymentNotFoundError();
  }

  return serializeCardPayment(updatedPayment);
}

export async function listBankQrBlacklist(
  input: BankQrBlacklistListInput = {},
): Promise<AdminPaginatedBankQrBlacklist> {
  return paginatePayments<BankQrBlacklistDocument, AdminBankQrBlacklistRow>({
    collectionName: "bank_qr_blacklist",
    filter: buildBankQrBlacklistFilter(input),
    input: {
      page: input.page,
      pageSize: input.pageSize,
    },
    serialize: serializeBankQrBlacklist,
  });
}

export async function unblockBankQrBlacklist(input: {
  id?: unknown;
  adminUsername: string;
}): Promise<AdminBankQrBlacklistRow> {
  if (typeof input.id !== "string" || !ObjectId.isValid(input.id)) {
    throw new PaymentValidationError("Blacklist không hợp lệ.");
  }

  const objectId = new ObjectId(input.id);
  const collection =
    await getCollection<BankQrBlacklistDocument>("bank_qr_blacklist");
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    { _id: objectId, status: "active" },
    {
      $set: {
        status: "unblocked",
        unblockedAt: now,
        unblockedBy: input.adminUsername,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!result) {
    throw new PaymentValidationError(
      "Blacklist không tồn tại hoặc đã được mở trước đó.",
    );
  }

  return serializeBankQrBlacklist(result);
}

function normalizePaymentKind(value: unknown): "bank" | "card" {
  if (value === "bank" || value === "card") {
    return value;
  }

  throw new PaymentValidationError("Loại giao dịch không hợp lệ.");
}

async function getRetryablePayment(
  type: "bank" | "card",
  paymentId: unknown,
) {
  if (typeof paymentId !== "string") {
    throw new PaymentNotFoundError();
  }

  const objectId = normalizePaymentObjectId(paymentId);

  if (type === "bank") {
    const collection = await getCollection<BankPaymentDocument>("bank_payments");
    const payment = await collection.findOne({ _id: objectId });

    if (!payment) {
      throw new PaymentNotFoundError();
    }

    if (!canRetryBankRecharge(payment)) {
      throw new PaymentValidationError(
        "Giao dịch chuyển khoản này không đủ điều kiện nạp lại.",
      );
    }

    return payment;
  }

  const collection = await getCollection<CardPaymentDocument>("card_payments");
  const payment = await collection.findOne({ _id: objectId });

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  if (!canRetryCardRecharge(payment)) {
    throw new PaymentValidationError(
      "Giao dịch nạp thẻ này không đủ điều kiện nạp lại.",
    );
  }

  return payment;
}

function buildRechargePreview(input: {
  paymentType: "bank" | "card" | "direct";
  paymentId?: string | null;
  sourceLabel: string;
  litmatchId: string;
  verifiedUser: TargetUserInfo;
  rewardType: RewardType;
  rewardAmount: number;
  amount?: number | null;
  transferContent?: string | null;
  requestId?: string | null;
  note?: string | null;
}): AdminRechargePreview {
  return {
    paymentType: input.paymentType,
    paymentId: input.paymentId ?? null,
    sourceLabel: input.sourceLabel,
    litmatchId: input.litmatchId,
    verifiedUser: {
      targetUid: input.verifiedUser.targetUid,
      avatar: input.verifiedUser.avatar,
      bio: input.verifiedUser.bio,
      nickname: input.verifiedUser.nickname,
    },
    rewardType: input.rewardType,
    rewardAmount: input.rewardAmount,
    amount: input.amount ?? null,
    transferContent: input.transferContent ?? null,
    requestId: input.requestId ?? null,
    note: input.note ?? null,
  };
}

export async function previewFailedPaymentRecharge(input: {
  type?: unknown;
  paymentId?: unknown;
}): Promise<AdminRechargePreview> {
  const type = normalizePaymentKind(input.type);
  const payment = await getRetryablePayment(type, input.paymentId);
  const verifiedUser = await litmatchAgent.getTargetUserInfo(
    payment.litmatchId,
  );

  if (type === "bank") {
    const bankPayment = payment as BankPaymentDocument;

    return buildRechargePreview({
      paymentType: "bank",
      paymentId: bankPayment._id?.toString() ?? null,
      sourceLabel:
        bankPayment.mode === "lifetime"
          ? "Giao dịch QR trọn đời"
          : "Giao dịch chuyển khoản",
      litmatchId: bankPayment.litmatchId,
      verifiedUser,
      rewardType: bankPayment.rewardType,
      rewardAmount: bankPayment.rewardAmount,
      amount: bankPayment.amount,
      transferContent: bankPayment.transferContent,
    });
  }

  const cardPayment = payment as CardPaymentDocument;

  return buildRechargePreview({
    paymentType: "card",
    paymentId: cardPayment._id?.toString() ?? null,
    sourceLabel: "Giao dịch nạp thẻ",
    litmatchId: cardPayment.litmatchId,
    verifiedUser,
    rewardType: cardPayment.rewardType,
    rewardAmount: cardPayment.rewardAmount,
    amount: cardPayment.actualValue ?? cardPayment.cardDenomination,
    requestId: cardPayment.requestId ?? null,
  });
}

export async function retryFailedPaymentRecharge(input: {
  type?: unknown;
  paymentId?: unknown;
  adminUsername?: string;
}): Promise<AdminRechargeResult> {
  const type = normalizePaymentKind(input.type);
  const payment = await getRetryablePayment(type, input.paymentId);
  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  const requestedAt = new Date();
  const transferType = toTransferAssetType(payment.rewardType);
  const pendingUpdate = {
    status: "paid" as const,
    updatedAt: requestedAt,
    recharge: {
      targetUid: payment.litmatchId,
      transferType,
      transferNum: payment.rewardAmount,
      status: "pending" as const,
      requestedAt,
    },
  };
  const updateResult =
    type === "bank"
      ? await (await getCollection<BankPaymentDocument>("bank_payments")).updateOne(
          { _id: paymentId, status: "recharge_failed" },
          { $set: pendingUpdate },
        )
      : await (await getCollection<CardPaymentDocument>("card_payments")).updateOne(
          { _id: paymentId, status: "recharge_failed" },
          { $set: pendingUpdate },
        );

  if (!updateResult.modifiedCount) {
    throw new PaymentValidationError(
      "Giao dịch đã được xử lý trước đó. Vui lòng tải lại danh sách.",
    );
  }

  try {
    const verifiedUser = await litmatchAgent.getTargetUserInfo(
      payment.litmatchId,
    );
    const response = await litmatchAgent.transferAccount({
      targetUid: verifiedUser.targetUid,
      rewardType: payment.rewardType,
      transferNum: payment.rewardAmount,
    });
    const completedAt = new Date();
    const completedUpdate = {
      status: "completed" as const,
      updatedAt: completedAt,
      verifiedUser: {
        ...verifiedUser,
        verifiedAt: completedAt,
      },
      "recharge.status": "completed" as const,
      "recharge.response": response,
      "recharge.completedAt": completedAt,
      "recharge.adminUsername": input.adminUsername ?? "",
    };
    const unsetFailed = {
      "recharge.error": "" as const,
      "recharge.failedAt": "" as const,
    };

    if (type === "bank") {
      await (await getCollection<BankPaymentDocument>("bank_payments")).updateOne(
        { _id: paymentId },
        { $set: completedUpdate, $unset: unsetFailed },
      );
    } else {
      await (await getCollection<CardPaymentDocument>("card_payments")).updateOne(
        { _id: paymentId },
        { $set: completedUpdate, $unset: unsetFailed },
      );
    }

    return {
      status: "completed",
      message: "Đã nạp Litmatch thành công.",
    };
  } catch (error) {
    const failedAt = new Date();
    const message = getLitmatchValidationMessage(error);
    const failedUpdate = {
      status: "recharge_failed" as const,
      updatedAt: failedAt,
      "recharge.status": "failed" as const,
      "recharge.error": message,
      "recharge.failedAt": failedAt,
      "recharge.adminUsername": input.adminUsername ?? "",
    };

    if (type === "bank") {
      await (await getCollection<BankPaymentDocument>("bank_payments")).updateOne(
        { _id: paymentId },
        { $set: failedUpdate },
      );
    } else {
      await (await getCollection<CardPaymentDocument>("card_payments")).updateOne(
        { _id: paymentId },
        { $set: failedUpdate },
      );
    }

    return {
      status: "failed",
      message,
    };
  }
}

export async function previewDirectAdminRecharge(input: {
  litmatchId?: unknown;
  rewardType?: unknown;
  rewardAmount?: unknown;
  note?: unknown;
}): Promise<AdminRechargePreview> {
  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const rewardType = input.rewardType;
  assertRewardType(rewardType);
  const rewardAmount = normalizeRewardAmount(input.rewardAmount);
  const note = normalizeDirectRechargeNote(input.note);
  const verifiedUser = await litmatchAgent.getTargetUserInfo(litmatchId);

  return buildRechargePreview({
    paymentType: "direct",
    sourceLabel: "Nạp trực tiếp",
    litmatchId,
    verifiedUser,
    rewardType,
    rewardAmount,
    note: note ?? null,
  });
}

export async function createDirectAdminRecharge(input: {
  litmatchId?: unknown;
  rewardType?: unknown;
  rewardAmount?: unknown;
  note?: unknown;
  adminUsername: string;
}): Promise<AdminRechargeResult> {
  const preview = await previewDirectAdminRecharge(input);
  const now = new Date();
  const collection =
    await getCollection<AdminDirectRechargeDocument>("admin_direct_recharges");
  const directRecharge: AdminDirectRechargeDocument = {
    status: "pending",
    adminUsername: input.adminUsername,
    litmatchId: preview.litmatchId,
    verifiedUser: {
      ...preview.verifiedUser,
      verifiedAt: now,
    },
    rewardType: preview.rewardType,
    rewardAmount: preview.rewardAmount,
    ...(preview.note ? { note: preview.note } : {}),
    recharge: {
      targetUid: preview.verifiedUser.targetUid,
      transferType: toTransferAssetType(preview.rewardType),
      transferNum: preview.rewardAmount,
      status: "pending",
      requestedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const result = await collection.insertOne(directRecharge);

  try {
    const response = await litmatchAgent.transferAccount({
      targetUid: preview.verifiedUser.targetUid,
      rewardType: preview.rewardType,
      transferNum: preview.rewardAmount,
    });
    const completedAt = new Date();

    await collection.updateOne(
      { _id: result.insertedId },
      {
        $set: {
          status: "completed",
          updatedAt: completedAt,
          "recharge.status": "completed",
          "recharge.response": response,
          "recharge.completedAt": completedAt,
        },
      },
    );

    const saved = await collection.findOne({ _id: result.insertedId });

    return {
      status: "completed",
      message: "Đã nạp trực tiếp thành công.",
      directRecharge: saved
        ? serializeDirectRecharge(saved)
        : serializeDirectRecharge({
            ...directRecharge,
            _id: result.insertedId,
            status: "completed",
            updatedAt: completedAt,
            recharge: {
              ...directRecharge.recharge,
              status: "completed",
              response,
              completedAt,
            },
          }),
    };
  } catch (error) {
    const failedAt = new Date();
    const message = getErrorMessage(error);

    await collection.updateOne(
      { _id: result.insertedId },
      {
        $set: {
          status: "failed",
          updatedAt: failedAt,
          "recharge.status": "failed",
          "recharge.error": message,
          "recharge.failedAt": failedAt,
        },
      },
    );

    const saved = await collection.findOne({ _id: result.insertedId });

    return {
      status: "failed",
      message,
      directRecharge: saved
        ? serializeDirectRecharge(saved)
        : serializeDirectRecharge({
            ...directRecharge,
            _id: result.insertedId,
            status: "failed",
            updatedAt: failedAt,
            recharge: {
              ...directRecharge.recharge,
              status: "failed",
              error: message,
              failedAt,
            },
          }),
    };
  }
}

export async function listDirectAdminRecharges(
  input: DirectRechargeListInput = {},
): Promise<AdminPaginatedDirectRecharges> {
  const filter = buildDirectRechargeFilter(input);
  const page = await paginatePayments<
    AdminDirectRechargeDocument,
    AdminDirectRechargeRow
  >({
    collectionName: "admin_direct_recharges",
    filter,
    input,
    serialize: serializeDirectRecharge,
  });

  return {
    ...page,
    summary: await summarizeDirectRecharges(filter),
  };
}

export async function updateDirectAdminRechargeNote(input: {
  id?: unknown;
  note?: unknown;
}): Promise<AdminDirectRechargeRow> {
  if (typeof input.id !== "string") {
    throw new PaymentNotFoundError();
  }

  const rechargeId = normalizePaymentObjectId(input.id);
  const note = normalizeDirectRechargeNote(input.note);
  const collection =
    await getCollection<AdminDirectRechargeDocument>("admin_direct_recharges");
  const updatedAt = new Date();
  const update: UpdateFilter<AdminDirectRechargeDocument> =
    note === undefined
      ? {
          $set: { updatedAt },
          $unset: { note: "" },
        }
      : {
          $set: { note, updatedAt },
        };
  const updatedRecharge = await collection.findOneAndUpdate(
    { _id: rechargeId },
    update,
    { returnDocument: "after" },
  );

  if (!updatedRecharge) {
    throw new PaymentNotFoundError();
  }

  return serializeDirectRecharge(updatedRecharge);
}

export async function retryDiamondSalePayment(input: {
  id?: unknown;
  litmatchId?: unknown;
  password?: unknown;
  adminUsername?: string;
}): Promise<AdminDiamondSalePaymentRow> {
  if (typeof input.id !== "string") {
    throw new PaymentNotFoundError();
  }

  const paymentId = normalizePaymentObjectId(input.id);
  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const password = normalizeDiamondSalePassword(input.password);
  const collection =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const payment = await collection.findOne({ _id: paymentId });

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  if (!canRetryDiamondSalePayment(payment)) {
    throw new PaymentValidationError(
      "Giao dịch kim cương xả này không đủ điều kiện thực hiện lại.",
    );
  }

  const retryCount = (payment.provider?.retryCount ?? 0) + 1;
  const updatedAt = new Date();
  const retryPayment: DiamondSalePaymentDocument = {
    ...payment,
    status: "paid",
    litmatchId,
    password,
    updatedAt,
    provider: {
      status: "pending",
      retryCount,
      message: input.adminUsername
        ? `Admin ${input.adminUsername} thực hiện lại.`
        : "Admin thực hiện lại.",
      requestedAt: updatedAt,
    },
  };

  const updateResult = await collection.updateOne(
    { _id: paymentId, status: "failed" },
    {
      $set: {
        status: "paid",
        litmatchId,
        password,
        updatedAt,
        provider: retryPayment.provider,
      },
    },
  );

  if (!updateResult.modifiedCount) {
    throw new PaymentValidationError(
      "Giao dịch đã được xử lý trước đó. Vui lòng tải lại danh sách.",
    );
  }

  const providerResult = await sendDiamondSalePaymentToProvider(
    retryPayment,
    retryCount,
  );
  const refreshedPayment = await collection.findOne({ _id: paymentId });

  if (!refreshedPayment) {
    throw new PaymentNotFoundError();
  }

  if (providerResult.status === "failed") {
    return serializeDiamondSalePayment(refreshedPayment);
  }

  return serializeDiamondSalePayment(refreshedPayment);
}

export async function getLifetimeQrReport(
  input: LifetimeQrReportInput = {},
): Promise<AdminLifetimeQrReport> {
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const filter = buildLifetimeQrPaymentFilter(input);
  const payments = await bankPayments
    .find(filter)
    .sort({ paidAt: -1, updatedAt: -1 })
    .toArray();

  const rows: AdminLifetimeQrReportRow[] = payments.map((payment) => ({
    id: payment._id?.toString() ?? "",
    litmatchId: payment.litmatchId,
    transferContent: payment.transferContent,
    rewardType: payment.rewardType,
    amount: payment.amount,
    rewardAmount: payment.rewardAmount,
    status: payment.status,
    paidAt: serializeDate(payment.paidAt),
    updatedAt: payment.updatedAt.toISOString(),
    exportStatus: payment.commissionExport ? "exported" : "not_exported",
    exportedAt: serializeDate(payment.commissionExport?.exportedAt),
  }));
  const summary = rows.reduce(
    (current, row) => ({
      paymentCount: current.paymentCount + 1,
      totalAmount: current.totalAmount + row.amount,
      totalRewardAmount: current.totalRewardAmount + row.rewardAmount,
      exportedCount:
        current.exportedCount + (row.exportStatus === "exported" ? 1 : 0),
    }),
    {
      paymentCount: 0,
      totalAmount: 0,
      totalRewardAmount: 0,
      exportedCount: 0,
    },
  );

  return {
    rows,
    summary,
  };
}

export async function exportLifetimeQrReportPayments(input: {
  paymentIds?: unknown;
}): Promise<AdminLifetimeQrExportResult> {
  const paymentIds = Array.isArray(input.paymentIds) ? input.paymentIds : [];
  const objectIds = paymentIds
    .filter((value): value is string => typeof value === "string")
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));

  if (!objectIds.length) {
    throw new PaymentValidationError("Vui lòng chọn giao dịch cần xuất.");
  }

  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const payments = await bankPayments
    .find({
      _id: { $in: objectIds },
      mode: "lifetime",
      "commissionExport.status": { $exists: false },
    })
    .toArray();

  if (!payments.length) {
    throw new PaymentValidationError(
      "Không có giao dịch QR trọn đời chưa xuất phù hợp.",
    );
  }

  const exportedAt = new Date();

  await bankPayments.updateMany(
    { _id: { $in: payments.map((payment) => payment._id).filter(Boolean) } },
    {
      $set: {
        commissionExport: {
          status: "exported",
          exportedAt,
        },
        updatedAt: exportedAt,
      },
    },
  );

  return payments.reduce(
    (current, payment) => ({
      exportedCount: current.exportedCount + 1,
      totalAmount: current.totalAmount + payment.amount,
      diamondRewardAmount:
        current.diamondRewardAmount +
        (payment.rewardType === "diamond" ? payment.rewardAmount : 0),
      starRewardAmount:
        current.starRewardAmount +
        (payment.rewardType === "star" ? payment.rewardAmount : 0),
    }),
    {
      exportedCount: 0,
      totalAmount: 0,
      diamondRewardAmount: 0,
      starRewardAmount: 0,
    },
  );
}

export async function cancelLifetimeQrReportExport(input: {
  paymentIds?: unknown;
}): Promise<AdminLifetimeQrExportResult> {
  const paymentIds = Array.isArray(input.paymentIds) ? input.paymentIds : [];
  const objectIds = paymentIds
    .filter((value): value is string => typeof value === "string")
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));

  if (!objectIds.length) {
    throw new PaymentValidationError("Vui lòng chọn giao dịch cần hủy xuất.");
  }

  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const payments = await bankPayments
    .find({
      _id: { $in: objectIds },
      mode: "lifetime",
      "commissionExport.status": "exported",
    })
    .toArray();

  if (!payments.length) {
    throw new PaymentValidationError(
      "Không có giao dịch QR trọn đời đã xuất phù hợp.",
    );
  }

  await bankPayments.updateMany(
    { _id: { $in: payments.map((payment) => payment._id).filter(Boolean) } },
    {
      $set: {
        updatedAt: new Date(),
      },
      $unset: {
        commissionExport: "",
      },
    },
  );

  return payments.reduce(
    (current, payment) => ({
      exportedCount: current.exportedCount + 1,
      totalAmount: current.totalAmount + payment.amount,
      diamondRewardAmount:
        current.diamondRewardAmount +
        (payment.rewardType === "diamond" ? payment.rewardAmount : 0),
      starRewardAmount:
        current.starRewardAmount +
        (payment.rewardType === "star" ? payment.rewardAmount : 0),
    }),
    {
      exportedCount: 0,
      totalAmount: 0,
      diamondRewardAmount: 0,
      starRewardAmount: 0,
    },
  );
}

export async function deleteIncompleteBankPayments(
  input: PaymentListInput = {},
): Promise<DeleteIncompletePaymentsResult> {
  const collection = await getCollection<BankPaymentDocument>("bank_payments");
  const result = await collection.deleteMany(
    buildBankPaymentFilter({
      ...input,
      status: "incomplete",
    }),
  );

  return { deletedCount: result.deletedCount };
}

export async function deleteIncompleteCardPayments(
  input: PaymentListInput = {},
): Promise<DeleteIncompletePaymentsResult> {
  const collection = await getCollection<CardPaymentDocument>("card_payments");
  const result = await collection.deleteMany(
    buildCardPaymentFilter({
      ...input,
      status: "incomplete",
    }),
  );

  return { deletedCount: result.deletedCount };
}

export async function getPublicPaymentStatus(input: {
  type: "bank" | "card" | "diamond-sale";
  id: string;
}): Promise<PublicPaymentStatus> {
  const objectId = normalizePaymentObjectId(input.id);

  if (input.type === "bank") {
    const collection = await getCollection<BankPaymentDocument>("bank_payments");
    const payment = await collection.findOne({ _id: objectId });

    if (!payment) {
      throw new PaymentNotFoundError();
    }

    return serializePublicBankPayment(payment, input.id);
  }

  if (input.type === "diamond-sale") {
    const collection =
      await getCollection<DiamondSalePaymentDocument>(
        "diamond_sale_payments",
      );
    const payment = await collection.findOne({ _id: objectId });

    if (!payment) {
      throw new PaymentNotFoundError();
    }

    return serializePublicDiamondSalePayment(payment, input.id);
  }

  const collection = await getCollection<CardPaymentDocument>("card_payments");
  const payment = await collection.findOne({ _id: objectId });

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  return {
    id: payment._id?.toString() ?? input.id,
    type: "card",
    status: payment.status,
    litmatchId: payment.litmatchId,
    rewardType: payment.rewardType,
    rewardAmount: payment.rewardAmount,
    cardProvider: payment.cardProvider,
    cardDenomination: payment.cardDenomination,
    providerStatus: payment.providerStatus ?? null,
    providerMessage: payment.providerMessage ?? null,
    actualValue: payment.actualValue ?? null,
    providerAmount: payment.providerAmount ?? null,
    rechargeStatus: payment.recharge?.status ?? null,
    rechargeError: payment.recharge?.error ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export async function getPublicLifetimeBankQrStatus(input: {
  id: string;
}): Promise<PublicPaymentStatus> {
  const objectId = normalizePaymentObjectId(input.id);
  const lifetimeQrCollection =
    await getCollection<LifetimeBankQrDocument>("lifetime_bank_qrs");
  const lifetimeQr = await lifetimeQrCollection.findOne({
    _id: objectId,
    status: "active",
  });

  if (!lifetimeQr) {
    throw new PaymentNotFoundError();
  }

  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const payment = await bankPayments.findOne(
    { lifetimeQrId: objectId },
    { sort: { createdAt: -1 } },
  );

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  return serializePublicBankPayment(payment, input.id);
}

function normalizeDiamondSaleProviderWebhookStatus(value: unknown) {
  if (value === "success" || value === "failed") {
    return value;
  }

  throw new PaymentValidationError(
    "Trạng thái webhook kim cương xả không hợp lệ.",
  );
}

function buildDiamondSaleWebhookEventKey(
  payload: DiamondSaleProviderWebhookPayload,
) {
  const paymentKey =
    (typeof payload.paymentId === "string" && payload.paymentId.trim()) ||
    (typeof payload.orderCode === "string" && payload.orderCode.trim()) ||
    "";
  const externalKey =
    typeof payload.externalRequestId === "string"
      ? payload.externalRequestId.trim()
      : "";

  if (!paymentKey) {
    throw new PaymentValidationError(
      "Webhook kim cương xả thiếu paymentId hoặc orderCode.",
    );
  }

  return `${paymentKey}:${externalKey}:${payload.status ?? ""}`;
}

export async function processDiamondSaleProviderWebhook(
  payload: DiamondSaleProviderWebhookPayload,
  rawBody: string,
) {
  const providerStatus = normalizeDiamondSaleProviderWebhookStatus(
    payload.status,
  );
  const eventKey = buildDiamondSaleWebhookEventKey(payload);
  const webhookEvents =
    await getCollection<DiamondSaleWebhookEventDocument>(
      "diamond_sale_webhook_events",
    );
  const payments =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const now = new Date();

  try {
    await webhookEvents.insertOne({
      eventKey,
      status: "received",
      payload,
      rawBody,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const existing = await webhookEvents.findOne({ eventKey });

      return {
        status: "duplicate" as const,
        paymentId: existing?.paymentId?.toString(),
        message: existing?.message ?? "Webhook already processed.",
      };
    }

    throw error;
  }

  async function markEvent(
    status: DiamondSaleWebhookEventDocument["status"],
    update: Partial<DiamondSaleWebhookEventDocument> = {},
  ) {
    await webhookEvents.updateOne(
      { eventKey },
      {
        $set: {
          ...update,
          status,
          updatedAt: new Date(),
        },
      },
    );

    return {
      status,
      paymentId: update.paymentId?.toString(),
      message: update.message,
    };
  }

  const paymentFilter =
    typeof payload.paymentId === "string" && ObjectId.isValid(payload.paymentId)
      ? { _id: new ObjectId(payload.paymentId) }
      : typeof payload.orderCode === "string" && payload.orderCode.trim()
        ? { orderCode: payload.orderCode.trim().toUpperCase() }
        : null;

  if (!paymentFilter) {
    return markEvent("failed", {
      message: "Webhook kim cương xả thiếu mã giao dịch hợp lệ.",
    });
  }

  const payment = await payments.findOne(paymentFilter);

  if (!payment) {
    return markEvent("unmatched", {
      message: "Không tìm thấy giao dịch kim cương xả.",
    });
  }

  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Diamond sale payment document is missing _id");
  }

  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : providerStatus === "success"
        ? "Bên thứ ba báo nạp thành công."
        : "Bên thứ ba báo nạp thất bại.";

  if (providerStatus === "success") {
    const completedAt = new Date();

    await payments.updateOne(
      { _id: paymentId },
      {
        $set: {
          status: "completed",
          updatedAt: completedAt,
          "provider.status": "completed",
          "provider.externalRequestId": payload.externalRequestId,
          "provider.message": message,
          "provider.webhookPayload": payload,
          "provider.completedAt": completedAt,
        },
        $unset: {
          "provider.error": "",
          "provider.failedAt": "",
        },
      },
    );

    return markEvent("processed", {
      paymentId,
      message,
    });
  }

  const failedAt = new Date();

  await payments.updateOne(
    { _id: paymentId, status: { $ne: "completed" } },
    {
      $set: {
        status: "failed",
        updatedAt: failedAt,
        "provider.status": "failed",
        "provider.externalRequestId": payload.externalRequestId,
        "provider.error": message,
        "provider.message": message,
        "provider.webhookPayload": payload,
        "provider.failedAt": failedAt,
      },
    },
  );

  return markEvent("processed", {
    paymentId,
    message,
  });
}

export async function processPay1sWebhook(
  payload: Pay1sCallbackPayload,
  rawBody: string,
) {
  const requestId = normalizeOptionalString(payload.request_id);

  if (!requestId) {
    throw new PaymentValidationError("Payload PAY1S thiếu request_id.");
  }

  const eventKey = buildCardWebhookEventKey(payload);
  const webhookEvents =
    await getCollection<CardWebhookEventDocument>("card_webhook_events");
  const cardPayments =
    await getCollection<CardPaymentDocument>("card_payments");
  const now = new Date();

  try {
    await webhookEvents.insertOne({
      eventKey,
      requestId,
      status: "received",
      payload,
      rawBody,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return { status: "duplicate" as const };
    }

    throw error;
  }

  async function markEvent(
    status: CardWebhookEventDocument["status"],
    update: Partial<CardWebhookEventDocument> = {},
  ) {
    await webhookEvents.updateOne(
      { eventKey },
      {
        $set: {
          ...update,
          status,
          updatedAt: new Date(),
        },
      },
    );

    return { status };
  }

  const payment = await cardPayments.findOne({ requestId });

  if (!payment) {
    return markEvent("unmatched", {
      message: "Không tìm thấy giao dịch nạp thẻ tương ứng.",
    });
  }

  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  try {
    const result = await applyPay1sCardResult(payment, payload, {
      providerCallback: payload,
    });

    return markEvent("processed", {
      paymentId,
      message: result.message,
    });
  } catch (error) {
    return markEvent("failed", {
      paymentId,
      message:
        error instanceof Error ? error.message : "Không xử lý được callback.",
    });
  }
}

async function createLifetimeBankPaymentFromSePay(
  lifetimeQr: LifetimeBankQrDocument,
  payload: SePayWebhookPayload,
  sepayId: number,
) {
  const lifetimeQrId = lifetimeQr._id;

  if (!lifetimeQrId) {
    throw new Error("Lifetime QR document is missing _id");
  }

  const transferAmount = normalizeAmount(payload.transferAmount);
  const config = await getRuntimeConfig();
  const rewardAmount = calculateReceiveAmount(
    transferAmount,
    lifetimeQr.rewardType,
    config.bankRate,
  );
  const paidAt = new Date();
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const lifetimeQrCollection =
    await getCollection<LifetimeBankQrDocument>("lifetime_bank_qrs");
  const payment: BankPaymentDocument = {
    mode: "lifetime",
    status: "paid",
    litmatchId: lifetimeQr.litmatchId,
    verifiedUser: lifetimeQr.verifiedUser,
    amount: transferAmount,
    rewardType: lifetimeQr.rewardType,
    rewardAmount,
    transferContent: lifetimeQr.transferContent,
    lifetimeQrId,
    configSnapshot: {
      bank: lifetimeQr.configSnapshot.bank ?? config.bank,
      bankRate: config.bankRate,
      paymentCodePrefix:
        lifetimeQr.configSnapshot.paymentCodePrefix ||
        config.paymentCodePrefix,
    },
    sepay: {
      id: sepayId,
      gateway: payload.gateway,
      transactionDate: payload.transactionDate,
      accountNumber: payload.accountNumber,
      content: payload.content,
      transferAmount,
      referenceCode: payload.referenceCode,
      payload,
    },
    paidAt,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
  const result = await bankPayments.insertOne(payment);
  const savedPayment = {
    ...payment,
    _id: result.insertedId,
  };

  await lifetimeQrCollection.updateOne(
    { _id: lifetimeQrId },
    { $set: { updatedAt: paidAt } },
  );

  return {
    paymentId: result.insertedId,
    rechargeResult: await rechargeBankPaymentAfterPaid(savedPayment),
  };
}

async function createDirectLifetimeBankPaymentFromSePay(
  lifetimeQrContent: ReturnType<typeof normalizeLifetimeQrTransferContent>,
  payload: SePayWebhookPayload,
  sepayId: number,
) {
  const transferAmount = normalizeAmount(payload.transferAmount);
  const config = await getRuntimeConfig();
  const rewardAmount = calculateReceiveAmount(
    transferAmount,
    lifetimeQrContent.rewardType,
    config.bankRate,
  );
  const paidAt = new Date();
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");

  let verifiedUser: BankPaymentDocument["verifiedUser"];

  try {
    const targetUser = await litmatchAgent.getTargetUserInfo(
      lifetimeQrContent.litmatchId,
    );
    verifiedUser = {
      ...targetUser,
      verifiedAt: paidAt,
    };
  } catch (error) {
    const message =
      error instanceof LitmatchAgentError && error.code === "NOT_FOUND"
        ? "Không xác minh được ID Litmatch trong nội dung chuyển khoản."
        : getErrorMessage(error);
    const payment: BankPaymentDocument = {
      mode: "lifetime",
      status: "recharge_failed",
      litmatchId: lifetimeQrContent.litmatchId,
      amount: transferAmount,
      rewardType: lifetimeQrContent.rewardType,
      rewardAmount,
      transferContent: lifetimeQrContent.transferContent,
      configSnapshot: {
        bank: config.bank,
        bankRate: config.bankRate,
        paymentCodePrefix: config.paymentCodePrefix,
      },
      sepay: {
        id: sepayId,
        gateway: payload.gateway,
        transactionDate: payload.transactionDate,
        accountNumber: payload.accountNumber,
        content: payload.content,
        transferAmount,
        referenceCode: payload.referenceCode,
        payload,
      },
      paidAt,
      recharge: {
        targetUid: lifetimeQrContent.litmatchId,
        transferType: toTransferAssetType(lifetimeQrContent.rewardType),
        transferNum: rewardAmount,
        status: "failed",
        error: message,
        requestedAt: paidAt,
        failedAt: paidAt,
      },
      createdAt: paidAt,
      updatedAt: paidAt,
    };
    const result = await bankPayments.insertOne(payment);

    return {
      paymentId: result.insertedId,
      rechargeResult: {
        status: "recharge_failed" as const,
        error: message,
      },
    };
  }

  const payment: BankPaymentDocument = {
    mode: "lifetime",
    status: "paid",
    litmatchId: lifetimeQrContent.litmatchId,
    verifiedUser,
    amount: transferAmount,
    rewardType: lifetimeQrContent.rewardType,
    rewardAmount,
    transferContent: lifetimeQrContent.transferContent,
    configSnapshot: {
      bank: config.bank,
      bankRate: config.bankRate,
      paymentCodePrefix: config.paymentCodePrefix,
    },
    sepay: {
      id: sepayId,
      gateway: payload.gateway,
      transactionDate: payload.transactionDate,
      accountNumber: payload.accountNumber,
      content: payload.content,
      transferAmount,
      referenceCode: payload.referenceCode,
      payload,
    },
    paidAt,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
  const result = await bankPayments.insertOne(payment);
  const savedPayment = {
    ...payment,
    _id: result.insertedId,
  };

  return {
    paymentId: result.insertedId,
    rechargeResult: await rechargeBankPaymentAfterPaid(savedPayment),
  };
}

function buildDiamondSaleSePaySnapshot(
  payload: SePayWebhookPayload,
  sepayId: number,
  transferAmount: number,
) {
  return {
    id: sepayId,
    gateway: payload.gateway,
    transactionDate: payload.transactionDate,
    accountNumber: payload.accountNumber,
    content: payload.content,
    transferAmount,
    referenceCode: payload.referenceCode,
    payload,
  };
}

async function createManualDiamondSalePaymentFromSePay(
  diamondSaleContent: DiamondSaleTransferContent,
  payload: SePayWebhookPayload,
  sepayId: number,
) {
  const transferAmount = normalizeAmount(payload.transferAmount);
  const config = await getRuntimeConfig();
  const diamondAmount = calculateDiamondSaleAmount(
    transferAmount,
    config.diamondSaleRate,
  );
  const paidAt = new Date();
  const collection =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const orderCode = `${DIAMOND_SALE_PREFIX}${sepayId}`;
  const payment: DiamondSalePaymentDocument = {
    source: "manual_transfer",
    status: "paid",
    litmatchId: diamondSaleContent.litmatchId,
    password: diamondSaleContent.password,
    amount: transferAmount,
    diamondAmount,
    orderCode,
    transferContent: diamondSaleContent.transferContent,
    configSnapshot: {
      bank: config.bank,
      diamondSaleRate: config.diamondSaleRate,
      paymentCodePrefix: config.paymentCodePrefix,
    },
    sepay: buildDiamondSaleSePaySnapshot(payload, sepayId, transferAmount),
    paidAt,
    createdAt: paidAt,
    updatedAt: paidAt,
  };
  const result = await collection.insertOne(payment);
  const savedPayment = {
    ...payment,
    _id: result.insertedId,
  };

  return {
    paymentId: result.insertedId,
    providerResult: await sendDiamondSalePaymentToProvider(savedPayment),
  };
}

async function processDiamondSalePaymentFromSePay(
  diamondSaleContent: DiamondSaleTransferContent,
  payload: SePayWebhookPayload,
  sepayId: number,
) {
  const collection =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const transferAmount = normalizeAmount(payload.transferAmount);

  if (!diamondSaleContent.orderCode) {
    return createManualDiamondSalePaymentFromSePay(
      diamondSaleContent,
      payload,
      sepayId,
    );
  }

  const payment = await collection.findOne({
    orderCode: diamondSaleContent.orderCode,
  });

  if (!payment) {
    return {
      status: "unmatched" as const,
      message: "Không tìm thấy giao dịch kim cương xả theo mã đơn.",
    };
  }

  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Diamond sale payment document is missing _id");
  }

  if (payment.amount !== transferAmount) {
    return {
      status: "amount_mismatch" as const,
      paymentId,
      message: "Số tiền webhook không khớp giao dịch kim cương xả.",
    };
  }

  if (payment.status !== "incomplete") {
    return {
      status: payment.status === "provider_pending" ? "provider_pending" : "already_paid",
      paymentId,
      message: "Giao dịch kim cương xả đã được cập nhật trước đó.",
    };
  }

  const paidAt = new Date();
  const updateResult = await collection.updateOne(
    { _id: paymentId, status: "incomplete" },
    {
      $set: {
        status: "paid",
        paidAt,
        updatedAt: paidAt,
        sepay: buildDiamondSaleSePaySnapshot(payload, sepayId, transferAmount),
      },
    },
  );

  if (!updateResult.modifiedCount) {
    return {
      status: "already_paid" as const,
      paymentId,
      message: "Giao dịch kim cương xả đã được cập nhật trước đó.",
    };
  }

  const paidPayment: DiamondSalePaymentDocument = {
    ...payment,
    status: "paid",
    paidAt,
    updatedAt: paidAt,
    sepay: buildDiamondSaleSePaySnapshot(payload, sepayId, transferAmount),
  };

  return {
    paymentId,
    providerResult: await sendDiamondSalePaymentToProvider(paidPayment),
  };
}

async function retrySePayBankRechargeFromWebhook(
  payment: BankPaymentDocument,
): Promise<SePayWebhookProcessResult> {
  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  const webhookEvents =
    await getCollection<SePayWebhookEventDocument>("sepay_webhook_events");
  const rawSepayId = payment.sepay?.id;

  if (typeof rawSepayId !== "number" || !Number.isInteger(rawSepayId)) {
    throw new Error("Payment document is missing sepay.id");
  }

  const sepayId: number = rawSepayId;

  async function markEvent(
    status: SePayWebhookEventDocument["status"],
    update: Partial<SePayWebhookEventDocument> = {},
  ): Promise<SePayWebhookProcessResult> {
    await webhookEvents.updateOne(
      { sepayId },
      {
        $set: {
          ...update,
          status,
          updatedAt: new Date(),
        },
      },
    );

    return {
      sepayId,
      status,
      message: update.message,
      paymentId: update.paymentId?.toString(),
    };
  }

  const retryResult = await retryFailedPaymentRecharge({
    type: "bank",
    paymentId: paymentId.toString(),
  });

  if (retryResult.status === "completed") {
    return markEvent("recharge_completed", {
      paymentId,
      message: retryResult.message,
    });
  }

  return markEvent("recharge_failed", {
    paymentId,
    message: retryResult.message,
  });
}

async function processSePayWebhookCore(
  sepayId: number,
  payload: SePayWebhookPayload,
): Promise<SePayWebhookProcessResult> {
  const webhookEvents =
    await getCollection<SePayWebhookEventDocument>("sepay_webhook_events");
  const bankPayments =
    await getCollection<BankPaymentDocument>("bank_payments");
  const diamondSalePayments =
    await getCollection<DiamondSalePaymentDocument>("diamond_sale_payments");
  const lifetimeQrs =
    await getCollection<LifetimeBankQrDocument>("lifetime_bank_qrs");

  async function markEvent(
    status: SePayWebhookEventDocument["status"],
    update: Partial<SePayWebhookEventDocument> = {},
  ): Promise<SePayWebhookProcessResult> {
    await webhookEvents.updateOne(
      { sepayId },
      {
        $set: {
          ...update,
          status,
          updatedAt: new Date(),
        },
      },
    );

    return {
      sepayId,
      status,
      message: update.message,
      paymentId: update.paymentId?.toString(),
    };
  }

  const existingPayment = await bankPayments.findOne({ "sepay.id": sepayId });
  const existingDiamondSalePayment = await diamondSalePayments.findOne({
    "sepay.id": sepayId,
  });

  if (existingDiamondSalePayment) {
    const paymentId = existingDiamondSalePayment._id;

    if (!paymentId) {
      throw new Error("Diamond sale payment document is missing _id");
    }

    if (existingDiamondSalePayment.status === "provider_pending") {
      return markEvent("provider_pending", {
        paymentId,
        message: "Giao dịch kim cương xả đang chờ bên thứ ba xử lý.",
      });
    }

    if (existingDiamondSalePayment.status === "completed") {
      return markEvent("recharge_completed", {
        paymentId,
        message: "Giao dịch kim cương xả đã hoàn tất.",
      });
    }

    if (existingDiamondSalePayment.status === "failed") {
      return markEvent("recharge_failed", {
        paymentId,
        message:
          existingDiamondSalePayment.provider?.error ??
          "Giao dịch kim cương xả đang lỗi.",
      });
    }

    return markEvent("already_paid", {
      paymentId,
      message: "Giao dịch kim cương xả đã được ghi nhận.",
    });
  }

  if (existingPayment) {
    const paymentId = existingPayment._id;

    if (!paymentId) {
      throw new Error("Payment document is missing _id");
    }

    if (existingPayment.status === "completed") {
      return markEvent("already_paid", {
        paymentId,
        message: "Giao dịch đã nạp Litmatch thành công.",
      });
    }

    if (canRetryBankRecharge(existingPayment)) {
      return retrySePayBankRechargeFromWebhook(existingPayment);
    }
  }

  if (payload.transferType !== "in") {
    return markEvent("ignored", { message: "Không phải giao dịch tiền vào." });
  }

  const diamondSaleContent = getSePayDiamondSaleTransferContent(payload);

  if (diamondSaleContent) {
    const result = await processDiamondSalePaymentFromSePay(
      diamondSaleContent,
      payload,
      sepayId,
    );

    if ("providerResult" in result) {
      return result.providerResult.status === "provider_pending"
        ? markEvent("provider_pending", {
            paymentId: result.paymentId,
            message: result.providerResult.message,
          })
        : markEvent("recharge_failed", {
            paymentId: result.paymentId,
            message: result.providerResult.message,
          });
    }

    return markEvent(result.status as SePayWebhookEventDocument["status"], {
      paymentId: result.paymentId,
      message: result.message,
    });
  }

  const candidates = getSePayTransferContentCandidates(payload);
  const payment = candidates.length
    ? await bankPayments.findOne({
        transferContent: { $in: candidates },
        $or: [{ mode: "fixed" }, { mode: { $exists: false } }],
      })
    : null;

  if (!payment) {
    const lifetimeQrContent = getSePayLifetimeQrContentCandidate(payload);
    const lifetimeQrFilter = lifetimeQrContent
      ? {
          status: "active" as const,
          transferContent: lifetimeQrContent.transferContent,
          litmatchId: lifetimeQrContent.litmatchId,
        }
      : candidates.length
        ? {
            status: "active" as const,
            transferContent: { $in: candidates },
          }
        : null;
    const lifetimeQr = lifetimeQrFilter
      ? await lifetimeQrs.findOne(lifetimeQrFilter)
      : null;

    if (lifetimeQr) {
      const result = await createLifetimeBankPaymentFromSePay(
        lifetimeQr,
        payload,
        sepayId,
      );

      if (result.rechargeResult.status === "recharge_completed") {
        return markEvent("recharge_completed", {
          paymentId: result.paymentId,
        });
      }

      return markEvent("recharge_failed", {
        paymentId: result.paymentId,
        message: result.rechargeResult.error,
      });
    }

    if (lifetimeQrContent) {
      const result = await createDirectLifetimeBankPaymentFromSePay(
        lifetimeQrContent,
        payload,
        sepayId,
      );

      if (result.rechargeResult.status === "recharge_completed") {
        return markEvent("recharge_completed", {
          paymentId: result.paymentId,
        });
      }

      return markEvent("recharge_failed", {
        paymentId: result.paymentId,
        message: result.rechargeResult.error,
      });
    }
  }

  if (!payment) {
    return markEvent("unmatched", {
      message: "Không tìm thấy giao dịch chuyển khoản tương ứng.",
    });
  }

  const paymentId = payment._id;

  if (!paymentId) {
    throw new Error("Payment document is missing _id");
  }

  const transferAmount = Number(payload.transferAmount);

  if (payment.amount !== transferAmount) {
    return markEvent("amount_mismatch", {
      paymentId,
      message: "Số tiền webhook không khớp giao dịch.",
    });
  }

  if (payment.status !== "incomplete") {
    return markEvent("already_paid", {
      paymentId,
      message: "Giao dịch đã được cập nhật trước đó.",
    });
  }

  const paidAt = new Date();

  const updateResult = await bankPayments.updateOne(
    { _id: paymentId, status: "incomplete" },
    {
      $set: {
        status: "paid",
        paidAt,
        updatedAt: paidAt,
        sepay: {
          id: sepayId,
          gateway: payload.gateway,
          transactionDate: payload.transactionDate,
          accountNumber: payload.accountNumber,
          content: payload.content,
          transferAmount,
          referenceCode: payload.referenceCode,
          payload,
        },
      },
    },
  );

  if (!updateResult.modifiedCount) {
    return markEvent("already_paid", {
      paymentId,
      message: "Giao dịch đã được cập nhật trước đó.",
    });
  }

  const rechargeResult = await rechargeBankPaymentAfterPaid(payment);

  if (rechargeResult.status === "recharge_completed") {
    return markEvent("recharge_completed", { paymentId });
  }

  return markEvent("recharge_failed", {
    paymentId,
    message: rechargeResult.error,
  });
}

export async function processSePayWebhook(
  payload: SePayWebhookPayload,
  rawBody: string,
): Promise<SePayWebhookProcessResult> {
  const sepayId = Number(payload.id);

  if (!Number.isInteger(sepayId)) {
    throw new PaymentValidationError("Payload SePay thiếu mã giao dịch.");
  }

  const webhookEvents =
    await getCollection<SePayWebhookEventDocument>("sepay_webhook_events");
  const now = new Date();

  try {
    await webhookEvents.insertOne({
      sepayId,
      status: "received",
      payload,
      rawBody,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const existing = await webhookEvents.findOne({ sepayId });

      if (existing && SEPAY_WEBHOOK_RETRIABLE_STATUSES.has(existing.status)) {
        await webhookEvents.updateOne(
          { sepayId },
          {
            $set: {
              status: "received",
              payload,
              rawBody,
              updatedAt: new Date(),
            },
          },
        );

        return processSePayWebhookCore(sepayId, payload);
      }

      return {
        sepayId,
        status: "duplicate",
        message: existing?.message ?? "Webhook already processed.",
        paymentId: existing?.paymentId?.toString(),
      };
    }

    throw error;
  }

  return processSePayWebhookCore(sepayId, payload);
}
