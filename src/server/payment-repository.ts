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
  AdminEasyPosOrderSyncResult,
  AdminRechargePreview,
  AdminRechargeResult,
} from "@/lib/admin-types";
import {
  buildVietQrUrl,
  calculateReceiveAmount,
  cardDenominations,
  cardProviders,
  normalizeLitmatchId,
  type BankConfig,
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
import {
  buildEasyPosBillKeys,
  buildEasyPosBillPayload,
  createEasyPosBill,
  getEasyPosBillMetadata,
  getEasyPosConfig,
  isEasyPosEnabled,
  type EasyPosBillKeys,
  type EasyPosBillPayload,
  type EasyPosOrderStatus,
  type EasyPosSyncSource,
} from "@/server/easypos";
import {
  resolveCtvRefSnapshot,
  serializeCtvRef,
  type CtvRefSnapshot,
} from "./ctv-repository";
import { getCollection } from "./mongo";
import { getRuntimeConfig } from "./runtime-config";

const PAYMENT_CODE_SUFFIX_LENGTH = 10;
const PAYMENT_CODE_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CARD_REQUEST_ID_MIN = 100000000;
const CARD_REQUEST_ID_MAX = 1000000000;
const LIFETIME_QR_DIAMOND_PREFIX = "LMKC";
const LIFETIME_QR_STAR_PREFIX = "LMSAO";
const PAYMENT_BLACKLIST_LIMIT = 5;
const BANK_QR_BLACKLIST_REASON =
  "Có 5 giao dịch chuyển khoản chưa thanh toán liên tiếp.";
const CARD_PAYMENT_BLACKLIST_REASON =
  "Có 5 giao dịch nạp thẻ không thành công liên tiếp.";
const PAYMENT_BLACKLIST_ERROR =
  "ID Litmatch này đang bị chặn tạo QR hoặc nạp thẻ do có nhiều giao dịch chưa hoàn tất. Vui lòng liên hệ admin.";
const EASYPOS_PENDING_STALE_MS = 5 * 60 * 1000;
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
  paymentCodePrefix: string;
};

export type BankPaymentDocument = {
  _id?: ObjectId;
  mode?: BankPaymentMode;
  status: PaymentStatus;
  litmatchId: string;
  ctvRef?: CtvRefSnapshot;
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
  easyposOrder?: {
    status: EasyPosOrderStatus;
    productId: number;
    quantity: number;
    amount: number;
    keys: EasyPosBillKeys;
    request?: EasyPosBillPayload;
    response?: unknown;
    error?: string;
    requestedAt: Date;
    completedAt?: Date;
    failedAt?: Date;
    syncedBy?: EasyPosSyncSource;
    adminUsername?: string;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type LifetimeBankQrDocument = {
  _id?: ObjectId;
  status: "active";
  litmatchId: string;
  ctvRef?: CtvRefSnapshot;
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
  ctvRef?: CtvRefSnapshot;
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
>(["ignored", "recharge_completed", "already_paid", "duplicate"]);

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
  type: "bank" | "card";
  bankMode?: BankPaymentMode;
  status: PaymentStatus;
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
  const ctvCode = parts.length === 3 ? parts[1] : undefined;
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
    ctvCode,
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

function canSyncEasyPosOrder(payment: BankPaymentDocument) {
  if (
    !isEasyPosEnabled() ||
    payment.status !== "completed" ||
    !payment.sepay
  ) {
    return false;
  }

  const easyposOrder = payment.easyposOrder;

  if (!easyposOrder || easyposOrder.status === "failed") {
    return true;
  }

  if (easyposOrder.status === "completed") {
    return false;
  }

  return (
    easyposOrder.requestedAt.getTime() + EASYPOS_PENDING_STALE_MS < Date.now()
  );
}

function canRetryCardRecharge(payment: CardPaymentDocument) {
  return (
    payment.status === "recharge_failed" &&
    payment.recharge?.status === "failed" &&
    payment.providerStatus === 1
  );
}

function serializeBankPayment(payment: BankPaymentDocument): AdminBankPaymentRow {
  return {
    id: payment._id?.toString() ?? "",
    bankMode: payment.mode ?? "fixed",
    status: payment.status,
    litmatchId: payment.litmatchId,
    ctvRef: serializeCtvRef(payment.ctvRef),
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
    easyposOrderStatus: payment.easyposOrder?.status ?? null,
    easyposOrderError: payment.easyposOrder?.error ?? null,
    canSyncEasyposOrder: canSyncEasyPosOrder(payment),
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
    ctvRef: serializeCtvRef(payment.ctvRef),
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

function normalizePaymentObjectIdInput(value: unknown) {
  if (value instanceof ObjectId) {
    return value;
  }

  if (typeof value === "string") {
    return normalizePaymentObjectId(value);
  }

  throw new PaymentNotFoundError();
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không nạp được Litmatch.";
}

function getLitmatchValidationMessage(error: unknown) {
  if (error instanceof LitmatchAgentError && error.code === "NOT_FOUND") {
    return "Không xác minh được ID Litmatch.";
  }

  return getErrorMessage(error);
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
  ctvCode?: unknown;
}) {
  const config = await getRuntimeConfig();
  assertBankConfig(config);

  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const amount = normalizeAmount(input.amount);
  const rewardType = input.rewardType;
  assertRewardType(rewardType);
  const ctvRef = await resolveCtvRefSnapshot(input.ctvCode);
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
      ...(ctvRef ? { ctvRef } : {}),
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

export async function createLifetimeBankQr(input: {
  litmatchId?: unknown;
  rewardType?: unknown;
  transferContent?: unknown;
  ctvCode?: unknown;
}) {
  const config = await getRuntimeConfig();
  assertBankConfig(config);

  const {
    transferContent,
    litmatchId,
    rewardType: contentRewardType,
    ctvCode: contentCtvCode,
  } = normalizeLifetimeQrTransferContent(input.transferContent);
  const rewardType = input.rewardType ?? contentRewardType;
  assertRewardType(rewardType);
  const ctvRef = await resolveCtvRefSnapshot(contentCtvCode ?? input.ctvCode);

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
    ...(ctvRef ? { ctvRef } : {}),
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
  ctvCode?: unknown;
}) {
  const config = await getRuntimeConfig();
  const litmatchId = normalizePaymentLitmatchId(input.litmatchId);
  const rewardType = input.rewardType;
  assertRewardType(rewardType);
  const ctvRef = await resolveCtvRefSnapshot(input.ctvCode);

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
      ...(ctvRef ? { ctvRef } : {}),
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

function getEasyPosOrderErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không sync được đơn hàng.";
}

async function getSerializedBankPaymentById(paymentId: ObjectId) {
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const payment = await bankPayments.findOne({ _id: paymentId });

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  return serializeBankPayment(payment);
}

function isEasyPosOrderPendingStale(
  payment: BankPaymentDocument,
  now: Date,
) {
  return (
    payment.easyposOrder?.status === "pending" &&
    payment.easyposOrder.requestedAt.getTime() + EASYPOS_PENDING_STALE_MS <
      now.getTime()
  );
}

function getEasyPosIneligibleMessage(payment: BankPaymentDocument) {
  if (payment.status !== "completed") {
    return "Chỉ sync ĐH cho giao dịch đã nạp thành công.";
  }

  if (!payment.sepay) {
    return "Chỉ sync ĐH cho giao dịch chuyển khoản SePay.";
  }

  return "Giao dịch này không đủ điều kiện sync ĐH.";
}

export async function syncEasyPosOrderForSePayPayment(input: {
  paymentId?: unknown;
  source: EasyPosSyncSource;
  adminUsername?: string;
}): Promise<AdminEasyPosOrderSyncResult> {
  const paymentId = normalizePaymentObjectIdInput(input.paymentId);
  const bankPayments = await getCollection<BankPaymentDocument>("bank_payments");
  const payment = await bankPayments.findOne({ _id: paymentId });

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  if (payment.status !== "completed" || !payment.sepay) {
    const message = getEasyPosIneligibleMessage(payment);

    if (input.source === "admin") {
      throw new PaymentValidationError(message);
    }

    return {
      status: "skipped",
      message,
      payment: serializeBankPayment(payment),
    };
  }

  if (!isEasyPosEnabled()) {
    return {
      status: "skipped",
      message: "EasyPos chưa được bật.",
      payment: serializeBankPayment(payment),
    };
  }

  if (payment.easyposOrder?.status === "completed") {
    return {
      status: "completed",
      message: "ĐH EasyPos đã được sync.",
      payment: serializeBankPayment(payment),
    };
  }

  const now = new Date();

  if (
    payment.easyposOrder?.status === "pending" &&
    !isEasyPosOrderPendingStale(payment, now)
  ) {
    return {
      status: "skipped",
      message: "ĐH EasyPos đang được sync.",
      payment: serializeBankPayment(payment),
    };
  }

  let config: ReturnType<typeof getEasyPosConfig>;

  try {
    config = getEasyPosConfig();
  } catch (error) {
    return {
      status: "failed",
      message: getEasyPosOrderErrorMessage(error),
      payment: serializeBankPayment(payment),
    };
  }

  const keys =
    payment.easyposOrder?.keys ??
    buildEasyPosBillKeys({ taxAuthorityPrefix: config.taxAuthorityPrefix, now });
  const buildInput = {
    rewardType: payment.rewardType,
    quantity: payment.rewardAmount,
    amount: payment.amount,
    keys,
  };
  const request = buildEasyPosBillPayload(buildInput);
  const metadata = getEasyPosBillMetadata(buildInput);
  const staleBefore = new Date(now.getTime() - EASYPOS_PENDING_STALE_MS);
  const claimResult = await bankPayments.updateOne(
    {
      _id: paymentId,
      status: "completed",
      "sepay.id": { $exists: true },
      $or: [
        { easyposOrder: { $exists: false } },
        { "easyposOrder.status": "failed" },
        {
          "easyposOrder.status": "pending",
          "easyposOrder.requestedAt": { $lt: staleBefore },
        },
      ],
    },
    {
      $set: {
        updatedAt: now,
        "easyposOrder.status": "pending",
        "easyposOrder.productId": metadata.productId,
        "easyposOrder.quantity": metadata.quantity,
        "easyposOrder.amount": metadata.amount,
        "easyposOrder.keys": keys,
        "easyposOrder.request": request,
        "easyposOrder.requestedAt": now,
        "easyposOrder.syncedBy": input.source,
        ...(input.adminUsername
          ? { "easyposOrder.adminUsername": input.adminUsername }
          : {}),
      },
      $unset: {
        "easyposOrder.response": "",
        "easyposOrder.error": "",
        "easyposOrder.completedAt": "",
        "easyposOrder.failedAt": "",
      },
    },
  );

  if (!claimResult.modifiedCount) {
    const current = await bankPayments.findOne({ _id: paymentId });

    if (!current) {
      throw new PaymentNotFoundError();
    }

    return {
      status:
        current.easyposOrder?.status === "completed" ? "completed" : "skipped",
      message:
        current.easyposOrder?.status === "completed"
          ? "ĐH EasyPos đã được sync."
          : "ĐH EasyPos đang được sync.",
      payment: serializeBankPayment(current),
    };
  }

  try {
    const result = await createEasyPosBill(request);
    const completedAt = new Date();

    await bankPayments.updateOne(
      {
        _id: paymentId,
        "easyposOrder.status": "pending",
        "easyposOrder.keys.idempotencyKey": keys.idempotencyKey,
      },
      {
        $set: {
          updatedAt: completedAt,
          "easyposOrder.status": "completed",
          "easyposOrder.response": result.response,
          "easyposOrder.completedAt": completedAt,
        },
        $unset: {
          "easyposOrder.error": "",
          "easyposOrder.failedAt": "",
        },
      },
    );

    return {
      status: "completed",
      message: "Đã sync ĐH EasyPos.",
      payment: await getSerializedBankPaymentById(paymentId),
    };
  } catch (error) {
    const failedAt = new Date();
    const message = getEasyPosOrderErrorMessage(error);

    await bankPayments.updateOne(
      {
        _id: paymentId,
        "easyposOrder.status": "pending",
        "easyposOrder.keys.idempotencyKey": keys.idempotencyKey,
      },
      {
        $set: {
          updatedAt: failedAt,
          "easyposOrder.status": "failed",
          "easyposOrder.error": message,
          "easyposOrder.failedAt": failedAt,
        },
      },
    );

    return {
      status: "failed",
      message,
      payment: await getSerializedBankPaymentById(paymentId),
    };
  }
}

async function trySyncEasyPosOrderAfterSePayCompleted(paymentId: ObjectId) {
  try {
    await syncEasyPosOrderForSePayPayment({
      paymentId,
      source: "webhook",
    });
  } catch {
    // EasyPos sync must not make a successful SePay recharge retry.
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
  type: "bank" | "card";
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
    ...(lifetimeQr.ctvRef ? { ctvRef: lifetimeQr.ctvRef } : {}),
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
  const ctvRef = await resolveCtvRefSnapshot(lifetimeQrContent.ctvCode);

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
      ...(ctvRef ? { ctvRef } : {}),
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
    ...(ctvRef ? { ctvRef } : {}),
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
    await trySyncEasyPosOrderAfterSePayCompleted(paymentId);

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
        await trySyncEasyPosOrderAfterSePayCompleted(result.paymentId);

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
        await trySyncEasyPosOrderAfterSePayCompleted(result.paymentId);

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
    await trySyncEasyPosOrderAfterSePayCompleted(paymentId);

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
