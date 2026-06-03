import type { RewardType } from "./payment-config";

export type AdminPaymentStatus =
  | "incomplete"
  | "processing"
  | "paid"
  | "completed"
  | "recharge_failed";

export type AdminDiamondSalePaymentStatus =
  | "incomplete"
  | "paid"
  | "provider_pending"
  | "completed"
  | "failed";

export type AdminDiamondSalePaymentSource =
  | "frontend_qr"
  | "manual_transfer";

export type AdminBankPaymentMode = "fixed" | "lifetime";
export type AdminBankQrBlacklistStatus = "active" | "unblocked";

export type AdminDiamondSaleRateTier = {
  minAmount: number;
  diamond: number;
};

export type AdminRuntimeConfigForm = {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  template: string;
  bankBaseAmount: number;
  bankDiamond: number;
  bankStar: number;
  cardBaseAmount: number;
  cardDiamond: number;
  cardStar: number;
  diamondSaleBaseAmount: number;
  diamondSaleTiers: AdminDiamondSaleRateTier[];
  paymentCodePrefix: string;
  dealerName: string;
  zaloPhone: string;
  supportGroupUrl: string;
  facebookUrl: string;
  phoneNumber: string;
  announcementEnabled: boolean;
  announcementText: string;
};

export type AdminBankPaymentRow = {
  id: string;
  bankMode: AdminBankPaymentMode;
  status: AdminPaymentStatus;
  litmatchId: string;
  amount: number;
  rewardType: RewardType;
  rewardAmount: number;
  transferContent: string;
  sepayId: number | null;
  sepayAmount: number | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  rechargeStatus: "pending" | "completed" | "failed" | null;
  rechargeTransferType: "diamonds" | "stars" | null;
  rechargeTransferNum: number | null;
  rechargeError: string | null;
  rechargeCompletedAt: string | null;
  canRetryRecharge: boolean;
};

export type AdminBankPaymentSummary = {
  paymentCount: number;
  completedCount: number;
  rechargeFailedCount: number;
  totalAmount: number;
  totalRewardAmount: number;
  diamondRewardAmount: number;
  starRewardAmount: number;
};

export type AdminCardPaymentRow = {
  id: string;
  status: AdminPaymentStatus;
  litmatchId: string;
  rewardType: RewardType;
  requestId: string | null;
  cardProvider: string;
  cardDenomination: number;
  rewardAmount: number;
  cardCode: string;
  cardSerial: string;
  providerStatus: number | null;
  providerMessage: string | null;
  providerTransId: string | null;
  declaredValue: number | null;
  actualValue: number | null;
  providerAmount: number | null;
  providerDiscountPercent: number | null;
  rechargeStatus: "pending" | "completed" | "failed" | null;
  rechargeTransferType: "diamonds" | "stars" | null;
  rechargeTransferNum: number | null;
  rechargeError: string | null;
  rechargeCompletedAt: string | null;
  canRetryRecharge: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCardPaymentSummary = {
  paymentCount: number;
  completedCount: number;
  rechargeFailedCount: number;
  totalDeclaredAmount: number;
  totalActualAmount: number;
  totalRewardAmount: number;
  diamondRewardAmount: number;
  starRewardAmount: number;
};

export type AdminPaginatedCardPayments =
  AdminPaginatedPayments<AdminCardPaymentRow> & {
    summary: AdminCardPaymentSummary;
  };

export type AdminDiamondSalePaymentRow = {
  id: string;
  source: AdminDiamondSalePaymentSource;
  status: AdminDiamondSalePaymentStatus;
  litmatchId: string;
  passwordMasked: string;
  amount: number;
  diamondAmount: number;
  orderCode: string;
  transferContent: string;
  sepayId: number | null;
  sepayAmount: number | null;
  providerExternalRequestId: string | null;
  providerMessage: string | null;
  providerError: string | null;
  providerRetryCount: number;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  canRetry: boolean;
};

export type AdminDiamondSalePaymentSummary = {
  paymentCount: number;
  manualTransferCount: number;
  incompleteCount: number;
  providerPendingCount: number;
  completedCount: number;
  failedCount: number;
  totalAmount: number;
  totalDiamondAmount: number;
};

export type AdminPaginatedDiamondSalePayments =
  AdminPaginatedPayments<AdminDiamondSalePaymentRow> & {
    summary: AdminDiamondSalePaymentSummary;
  };

export type AdminPaginatedPayments<TPayment> = {
  rows: TPayment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary?: unknown;
};

export type AdminPaginatedBankPayments =
  AdminPaginatedPayments<AdminBankPaymentRow> & {
    summary: AdminBankPaymentSummary;
  };

export type AdminBankQrBlacklistRow = {
  id: string;
  litmatchId: string;
  status: AdminBankQrBlacklistStatus;
  reason: string;
  triggeredByPaymentIds: string[];
  blockedAt: string;
  unblockedAt: string | null;
  unblockedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminPaginatedBankQrBlacklist =
  AdminPaginatedPayments<AdminBankQrBlacklistRow>;

export type AdminLifetimeQrReportSummary = {
  paymentCount: number;
  totalAmount: number;
  totalRewardAmount: number;
  exportedCount: number;
};

export type AdminLifetimeQrReportRow = {
  id: string;
  litmatchId: string;
  transferContent: string;
  rewardType: RewardType;
  amount: number;
  rewardAmount: number;
  status: AdminPaymentStatus;
  paidAt: string | null;
  updatedAt: string;
  exportStatus: "not_exported" | "exported";
  exportedAt: string | null;
};

export type AdminLifetimeQrReport = {
  rows: AdminLifetimeQrReportRow[];
  summary: AdminLifetimeQrReportSummary;
};

export type AdminLifetimeQrExportResult = {
  exportedCount: number;
  totalAmount: number;
  diamondRewardAmount: number;
  starRewardAmount: number;
};

export type AdminTargetUserInfo = {
  targetUid: string;
  avatar: string;
  bio: string;
  nickname: string;
};

export type AdminRechargePreview = {
  paymentType: "bank" | "card" | "direct";
  paymentId: string | null;
  sourceLabel: string;
  litmatchId: string;
  verifiedUser: AdminTargetUserInfo;
  rewardType: RewardType;
  rewardAmount: number;
  amount: number | null;
  transferContent: string | null;
  requestId: string | null;
  note: string | null;
};

export type AdminDirectRechargeRow = {
  id: string;
  status: "pending" | "completed" | "failed";
  adminUsername: string;
  litmatchId: string;
  verifiedUser: AdminTargetUserInfo | null;
  rewardType: RewardType;
  rewardAmount: number;
  note: string | null;
  rechargeStatus: "pending" | "completed" | "failed";
  rechargeError: string | null;
  rechargeCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminDirectRechargeSummary = {
  rechargeCount: number;
  completedCount: number;
  failedCount: number;
  totalRewardAmount: number;
  diamondRewardAmount: number;
  starRewardAmount: number;
};

export type AdminPaginatedDirectRecharges =
  AdminPaginatedPayments<AdminDirectRechargeRow> & {
    summary: AdminDirectRechargeSummary;
  };

export type AdminRechargeResult = {
  status: "completed" | "failed";
  message: string;
  directRecharge?: AdminDirectRechargeRow;
};
