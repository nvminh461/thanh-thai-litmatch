import type { RewardType } from "@/lib/payment-config";

export type EasyPosOrderStatus = "pending" | "completed" | "failed";
export type EasyPosSyncSource = "webhook" | "admin";

export type EasyPosBillKeys = {
  uniqueKey: string;
  idempotencyKey: string;
  fkey: string;
  code: string;
  billDate: string;
  taxAuthorityCode: string;
  groupBatch: string;
};

export type EasyPosBillProduct = Record<string, unknown> & {
  productId: number;
  quantity: number;
  amount: number;
  totalPreTax: number;
  totalAmount: number;
};

export type EasyPosBillPayload = Record<string, unknown> & {
  products: EasyPosBillProduct[];
  payment: {
    paymentMethod: string;
    amount: number;
  };
  amount: number;
  totalPreTax: number;
  totalAmount: number;
  quantity: number;
  uniqueKey: string;
  idempotencyKey: string;
  fkey: string;
};

export type EasyPosBuildBillInput = {
  rewardType: RewardType;
  quantity: number;
  amount: number;
  keys: EasyPosBillKeys;
};

export type EasyPosBillMetadata = {
  productId: number;
  quantity: number;
  amount: number;
};

export type EasyPosCreateBillResult = {
  request: EasyPosBillPayload;
  response: unknown;
};

export type EasyPosLoginResponse = {
  status?: boolean;
  reason?: string | null;
  message?: unknown;
  data?: {
    id_token?: string | null;
  } | null;
};

export class EasyPosClientError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "EasyPosClientError";
    this.statusCode = statusCode;
  }
}
