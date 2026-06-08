import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { ObjectId, type Filter, type UpdateFilter } from "mongodb";
import type {
  AdminBankPaymentMode,
  AdminCtvRef,
  AdminCtvRevenueSummary,
  AdminCtvRow,
  AdminCtvTransactionRow,
  AdminDirectRechargeStatus,
  AdminPaginatedCtvTransactions,
  AdminPaginatedCtvs,
  AdminPaymentStatus,
} from "@/lib/admin-types";
import type { RewardType } from "@/lib/payment-config";
import { calculatePaymentAmountFromReward } from "@/lib/payment-config";
import { timingSafeEqualString } from "./crypto-utils";
import { getCollection } from "./mongo";
import { getRuntimeConfig } from "./runtime-config";

const scrypt = promisify(scryptCallback);
const CTV_PAGE_SIZE = 20;

export class CtvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CtvValidationError";
  }
}

export class CtvNotFoundError extends Error {
  constructor() {
    super("CTV not found");
    this.name = "CtvNotFoundError";
  }
}

export type CtvDocument = {
  _id?: ObjectId;
  name: string;
  code: string;
  username: string;
  passwordHash: string;
  salt: string;
  loginDisabledAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CtvRefSnapshot = {
  ctvId: ObjectId;
  code: string;
  name: string;
};

export type CtvSessionProfile = {
  id: string;
  name: string;
  code: string;
  username: string;
};

export type CtvTransactionListInput = {
  ctvId: string;
  page?: number;
  pageSize?: number;
  type?: AdminCtvTransactionRow["type"] | "all";
  status?: AdminCtvTransactionRow["status"] | "all";
  litmatchId?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

type CtvPaymentRefDocument = {
  ctvRef?: CtvRefSnapshot;
  status: AdminPaymentStatus;
  litmatchId: string;
  rewardType: RewardType;
  rewardAmount: number;
  createdAt: Date;
  updatedAt: Date;
  recharge?: {
    completedAt?: Date;
  };
};

type CtvBankPaymentDocument = CtvPaymentRefDocument & {
  _id?: ObjectId;
  mode?: AdminBankPaymentMode;
  amount?: number;
  transferContent: string;
  paidAt?: Date;
  note?: string;
  sepay?: {
    transferAmount?: number;
    content?: string;
  };
};

type CtvCardPaymentDocument = CtvPaymentRefDocument & {
  _id?: ObjectId;
  requestId?: string;
  cardProvider: string;
  cardDenomination: number;
  declaredValue?: number;
  actualValue?: number;
  providerAmount?: number;
  providerStatus?: number;
  note?: string;
};

type CtvDirectRechargeDocument = {
  _id?: ObjectId;
  status: AdminDirectRechargeStatus;
  litmatchId: string;
  rewardType: RewardType;
  rewardAmount: number;
  note?: string;
  recharge?: {
    completedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
};

function serializeDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function normalizeListPage(value: unknown) {
  const page = Number(value);

  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }

  return page;
}

function normalizeListPageSize(value: unknown) {
  const pageSize = Number(value);

  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return CTV_PAGE_SIZE;
  }

  return Math.min(pageSize, 100);
}

function normalizeRequiredString(value: unknown, fieldName: string) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new CtvValidationError(`Vui lòng nhập ${fieldName}.`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUsername(value: unknown) {
  const username = normalizeRequiredString(value, "tài khoản CTV");

  if (username.length > 80) {
    throw new CtvValidationError("Tài khoản CTV không được vượt quá 80 ký tự.");
  }

  return username;
}

function normalizePassword(value: unknown) {
  const password = normalizeRequiredString(value, "mật khẩu CTV");

  if (password.length < 4) {
    throw new CtvValidationError("Mật khẩu CTV cần tối thiểu 4 ký tự.");
  }

  return password;
}

function stripVietnameseMarks(value: string) {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function generateCtvCodeFromName(name: string) {
  const firstPart = name.trim().split(/\s+/).filter(Boolean)[0] ?? "";

  return stripVietnameseMarks(firstPart).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getLegacyCtvCodeFromName(name: string) {
  return stripVietnameseMarks(name).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeCtvCode(value: unknown) {
  const rawValue = typeof value === "string" ? value : "";

  return stripVietnameseMarks(rawValue).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getCtvContentTokens(ctv: Pick<CtvDocument, "code" | "name">) {
  const tokens = new Set<string>([ctv.code]);
  const legacyCode = getLegacyCtvCodeFromName(ctv.name);

  if (legacyCode) {
    tokens.add(legacyCode);
  }

  for (const part of ctv.name.trim().split(/\s+/).filter(Boolean)) {
    const normalized = normalizeCtvCode(part);

    if (normalized) {
      tokens.add(normalized);
    }
  }

  return [...tokens];
}

function buildCtvTokenPattern(tokens: string[]) {
  return tokens.map((token) => escapeRegex(token)).join("|");
}

function buildLifetimeTransferContentRegex(tokens: string[]) {
  return `^(LMKC|LMSAO) (${buildCtvTokenPattern(tokens)}) \\d{5,20}$`;
}

function buildLifetimeTransferContentInTextRegex(tokens: string[]) {
  return `(LMKC|LMSAO)[\\s]+(${buildCtvTokenPattern(tokens)})[\\s]+\\d{5,20}`;
}

function buildCtvNoteRegex(tokens: string[]) {
  return `^(${buildCtvTokenPattern(tokens)})$`;
}

function buildCtvAttributionOrConditions(
  ctvId: ObjectId,
  ctv: Pick<CtvDocument, "code" | "name">,
) {
  const tokens = getCtvContentTokens(ctv);
  const lifetimeTransferRegex = buildLifetimeTransferContentRegex(tokens);
  const lifetimeInTextRegex = buildLifetimeTransferContentInTextRegex(tokens);
  const noteRegex = buildCtvNoteRegex(tokens);

  return [
    { "ctvRef.ctvId": ctvId },
    {
      transferContent: {
        $regex: lifetimeTransferRegex,
        $options: "i",
      },
    },
    {
      "sepay.content": {
        $regex: lifetimeInTextRegex,
        $options: "i",
      },
    },
    {
      note: {
        $regex: noteRegex,
        $options: "i",
      },
    },
  ];
}

async function hashPassword(password: string, salt: string) {
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return derivedKey.toString("hex");
}

function serializeCtv(ctv: CtvDocument): AdminCtvRow {
  return {
    id: ctv._id?.toString() ?? "",
    name: ctv.name,
    code: ctv.code,
    username: ctv.username,
    loginDisabledAt: serializeDate(ctv.loginDisabledAt),
    deletedAt: serializeDate(ctv.deletedAt),
    createdAt: ctv.createdAt.toISOString(),
    updatedAt: ctv.updatedAt.toISOString(),
  };
}

export function serializeCtvRef(ctvRef?: CtvRefSnapshot | null): AdminCtvRef | null {
  if (!ctvRef) {
    return null;
  }

  return {
    id: ctvRef.ctvId.toString(),
    code: ctvRef.code,
    name: ctvRef.name,
  };
}

function toCtvRefSnapshot(ctv: CtvDocument): CtvRefSnapshot | null {
  if (!ctv._id) {
    return null;
  }

  return {
    ctvId: ctv._id,
    code: ctv.code,
    name: ctv.name,
  };
}

function normalizeCtvObjectId(value: unknown) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) {
    throw new CtvNotFoundError();
  }

  return new ObjectId(value);
}

async function assertUniqueCode(code: string, currentId?: ObjectId) {
  const collection = await getCollection<CtvDocument>("ctvs");
  const existing = await collection.findOne({
    code,
    ...(currentId ? { _id: { $ne: currentId } } : {}),
  });

  if (existing) {
    throw new CtvValidationError(
      "Tên CTV sinh ra code đã tồn tại. Vui lòng đổi tên/biệt danh.",
    );
  }
}

async function assertUniqueUsername(username: string, currentId?: ObjectId) {
  const collection = await getCollection<CtvDocument>("ctvs");
  const existing = await collection.findOne({
    username,
    ...(currentId ? { _id: { $ne: currentId } } : {}),
  });

  if (existing) {
    throw new CtvValidationError("Tài khoản CTV đã tồn tại.");
  }
}

export async function getCtvById(id: string): Promise<AdminCtvRow | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const collection = await getCollection<CtvDocument>("ctvs");
  const ctv = await collection.findOne({ _id: new ObjectId(id) });

  if (!ctv) {
    return null;
  }

  return serializeCtv(ctv);
}

export async function listCtvs(input: {
  page?: unknown;
  pageSize?: unknown;
} = {}): Promise<AdminPaginatedCtvs> {
  const page = normalizeListPage(input.page);
  const pageSize = normalizeListPageSize(input.pageSize);
  const collection = await getCollection<CtvDocument>("ctvs");
  const total = await collection.countDocuments({});
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = await collection
    .find({})
    .sort({ updatedAt: -1 })
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  return {
    rows: rows.map(serializeCtv),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function createCtv(input: {
  name?: unknown;
  username?: unknown;
  password?: unknown;
}): Promise<AdminCtvRow> {
  const name = normalizeRequiredString(input.name, "tên CTV");
  const code = generateCtvCodeFromName(name);

  if (!code) {
    throw new CtvValidationError(
      "Tên CTV không sinh được code. Vui lòng nhập tên có chữ hoặc số.",
    );
  }

  const username = normalizeUsername(input.username);
  const password = normalizePassword(input.password);
  await assertUniqueCode(code);
  await assertUniqueUsername(username);

  const now = new Date();
  const salt = randomBytes(16).toString("hex");
  const ctv: CtvDocument = {
    name,
    code,
    username,
    passwordHash: await hashPassword(password, salt),
    salt,
    createdAt: now,
    updatedAt: now,
  };
  const collection = await getCollection<CtvDocument>("ctvs");

  try {
    const result = await collection.insertOne(ctv);

    return serializeCtv({
      ...ctv,
      _id: result.insertedId,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new CtvValidationError(
        "Code hoặc tài khoản CTV đã tồn tại. Vui lòng kiểm tra lại.",
      );
    }

    throw error;
  }
}

export async function updateCtv(input: {
  id?: unknown;
  name?: unknown;
  username?: unknown;
  password?: unknown;
}): Promise<AdminCtvRow> {
  const ctvId = normalizeCtvObjectId(input.id);
  const collection = await getCollection<CtvDocument>("ctvs");
  const existing = await collection.findOne({ _id: ctvId });

  if (!existing) {
    throw new CtvNotFoundError();
  }

  const update: UpdateFilter<CtvDocument> = {
    $set: {
      updatedAt: new Date(),
    },
  };
  const nextName = normalizeOptionalString(input.name);
  const nextUsername = normalizeOptionalString(input.username);
  const nextPassword = normalizeOptionalString(input.password);

  if (nextName) {
    const nextCode = generateCtvCodeFromName(nextName);

    if (!nextCode) {
      throw new CtvValidationError(
        "Tên CTV không sinh được code. Vui lòng nhập tên có chữ hoặc số.",
      );
    }

    if (nextCode !== existing.code) {
      await assertUniqueCode(nextCode, ctvId);
    }

    update.$set = {
      ...update.$set,
      name: nextName,
      code: nextCode,
    };
  }

  if (nextUsername && nextUsername !== existing.username) {
    if (nextUsername.length > 80) {
      throw new CtvValidationError("Tài khoản CTV không được vượt quá 80 ký tự.");
    }

    await assertUniqueUsername(nextUsername, ctvId);
    update.$set = {
      ...update.$set,
      username: nextUsername,
    };
  }

  if (nextPassword) {
    if (nextPassword.length < 4) {
      throw new CtvValidationError("Mật khẩu CTV cần tối thiểu 4 ký tự.");
    }

    const salt = randomBytes(16).toString("hex");
    update.$set = {
      ...update.$set,
      passwordHash: await hashPassword(nextPassword, salt),
      salt,
    };
  }

  const updated = await collection.findOneAndUpdate(
    { _id: ctvId },
    update,
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new CtvNotFoundError();
  }

  return serializeCtv(updated);
}

export async function disableCtvLogin(input: {
  id?: unknown;
}): Promise<AdminCtvRow> {
  const ctvId = normalizeCtvObjectId(input.id);
  const collection = await getCollection<CtvDocument>("ctvs");
  const now = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: ctvId },
    {
      $set: {
        loginDisabledAt: now,
        deletedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new CtvNotFoundError();
  }

  return serializeCtv(updated);
}

export async function enableCtvLogin(input: {
  id?: unknown;
}): Promise<AdminCtvRow> {
  const ctvId = normalizeCtvObjectId(input.id);
  const collection = await getCollection<CtvDocument>("ctvs");
  const updated = await collection.findOneAndUpdate(
    { _id: ctvId },
    {
      $unset: {
        loginDisabledAt: "",
        deletedAt: "",
      },
      $set: {
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new CtvNotFoundError();
  }

  return serializeCtv(updated);
}

export async function resolveCtvRefSnapshot(
  codeValue: unknown,
): Promise<CtvRefSnapshot | null> {
  const code = normalizeCtvCode(codeValue);

  if (!code) {
    return null;
  }

  const collection = await getCollection<CtvDocument>("ctvs");
  const exactMatch = await collection.findOne({ code });

  if (exactMatch) {
    return toCtvRefSnapshot(exactMatch);
  }

  const ctvs = await collection.find({}).toArray();
  const prefixMatches = ctvs.filter(
    (ctv) => ctv.code.startsWith(code) || code.startsWith(ctv.code),
  );

  if (prefixMatches.length === 1) {
    return toCtvRefSnapshot(prefixMatches[0]);
  }

  return null;
}

export async function verifyCtvCredentials(username: string, password: string) {
  const normalizedUsername = username.trim();
  const normalizedPassword = password.trim();

  if (!normalizedUsername || !normalizedPassword) {
    return null;
  }

  const collection = await getCollection<CtvDocument>("ctvs");
  const ctv = await collection.findOne({ username: normalizedUsername });

  if (!ctv || ctv.loginDisabledAt || ctv.deletedAt || !ctv._id) {
    return null;
  }

  const passwordHash = await hashPassword(normalizedPassword, ctv.salt);

  if (!timingSafeEqualString(passwordHash, ctv.passwordHash)) {
    return null;
  }

  return {
    id: ctv._id.toString(),
    name: ctv.name,
    code: ctv.code,
    username: ctv.username,
  };
}

export async function changeCtvPassword(input: {
  ctvId: string;
  currentPassword?: unknown;
  nextPassword?: unknown;
}) {
  if (!ObjectId.isValid(input.ctvId)) {
    throw new CtvNotFoundError();
  }

  const currentPassword = normalizeRequiredString(
    input.currentPassword,
    "mật khẩu hiện tại",
  );
  const nextPassword = normalizePassword(input.nextPassword);
  const ctvId = new ObjectId(input.ctvId);
  const collection = await getCollection<CtvDocument>("ctvs");
  const ctv = await collection.findOne({ _id: ctvId });

  if (!ctv || ctv.loginDisabledAt || ctv.deletedAt) {
    throw new CtvNotFoundError();
  }

  const currentPasswordHash = await hashPassword(currentPassword, ctv.salt);

  if (!timingSafeEqualString(currentPasswordHash, ctv.passwordHash)) {
    throw new CtvValidationError("Mật khẩu hiện tại không đúng.");
  }

  const salt = randomBytes(16).toString("hex");
  const updatedAt = new Date();

  await collection.updateOne(
    { _id: ctvId },
    {
      $set: {
        passwordHash: await hashPassword(nextPassword, salt),
        salt,
        updatedAt,
      },
    },
  );
}

export async function getActiveCtvProfile(
  ctvId: string,
): Promise<CtvSessionProfile | null> {
  if (!ObjectId.isValid(ctvId)) {
    return null;
  }

  const collection = await getCollection<CtvDocument>("ctvs");
  const ctv = await collection.findOne({ _id: new ObjectId(ctvId) });

  if (!ctv || ctv.loginDisabledAt || ctv.deletedAt || !ctv._id) {
    return null;
  }

  return {
    id: ctv._id.toString(),
    name: ctv.name,
    code: ctv.code,
    username: ctv.username,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseVietnamDayStart(value?: string) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+07:00`);
}

function parseVietnamDayEndExclusive(value?: string) {
  const start = parseVietnamDayStart(value);

  if (!start) {
    return null;
  }

  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function isPaymentStatus(value: unknown): value is AdminPaymentStatus {
  return (
    value === "incomplete" ||
    value === "processing" ||
    value === "paid" ||
    value === "completed" ||
    value === "recharge_failed"
  );
}

function isDirectRechargeStatus(
  value: unknown,
): value is AdminDirectRechargeStatus {
  return value === "pending" || value === "completed" || value === "failed";
}

function shouldQueryPaymentTransactions(
  status: CtvTransactionListInput["status"],
) {
  return !status || status === "all" || isPaymentStatus(status);
}

function shouldQueryDirectTransactions(
  status: CtvTransactionListInput["status"],
) {
  return !status || status === "all" || isDirectRechargeStatus(status);
}

function buildCtvPaymentFilter<TDocument extends CtvPaymentRefDocument>(
  input: CtvTransactionListInput,
  ctvId: ObjectId,
  ctv: Pick<CtvDocument, "code" | "name">,
): Filter<TDocument> {
  const filter: Filter<TDocument> = {
    $or: buildCtvAttributionOrConditions(ctvId, ctv),
  } as unknown as Filter<TDocument>;

  if (isPaymentStatus(input.status)) {
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

function buildCtvDirectRechargeFilter(
  input: CtvTransactionListInput,
  ctv: Pick<CtvDocument, "code" | "name">,
): Filter<CtvDirectRechargeDocument> {
  const tokens = getCtvContentTokens(ctv);
  const filter: Filter<CtvDirectRechargeDocument> = {
    note: {
      $regex: buildCtvNoteRegex(tokens),
      $options: "i",
    },
  };

  if (isDirectRechargeStatus(input.status)) {
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

function normalizeMoney(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);

  return Number.isFinite(amount) ? amount : 0;
}

function getBankPaymentAmount(payment: CtvBankPaymentDocument) {
  const amount = normalizeMoney(payment.amount);

  if (amount > 0) {
    return amount;
  }

  return normalizeMoney(payment.sepay?.transferAmount);
}

function getCardRevenueAmount(payment: CtvCardPaymentDocument) {
  return normalizeMoney(
    payment.actualValue ??
      payment.providerAmount ??
      payment.declaredValue ??
      payment.cardDenomination,
  );
}

function isBankRevenueEligible(payment: CtvBankPaymentDocument) {
  const amount = getBankPaymentAmount(payment);

  if (amount <= 0) {
    return false;
  }

  if (payment.status === "completed") {
    return true;
  }

  if (payment.status === "paid" || payment.status === "recharge_failed") {
    return Boolean(payment.paidAt || payment.sepay);
  }

  return false;
}

function isCardRevenueEligible(payment: CtvCardPaymentDocument) {
  if (
    payment.status !== "paid" &&
    payment.status !== "completed" &&
    payment.status !== "recharge_failed"
  ) {
    return false;
  }

  if (getCardRevenueAmount(payment) <= 0) {
    return false;
  }

  return payment.providerStatus === 1 || payment.status === "completed";
}

function serializeBankTransaction(
  payment: CtvBankPaymentDocument,
): AdminCtvTransactionRow {
  const amount = getBankPaymentAmount(payment);

  return {
    id: payment._id?.toString() ?? "",
    type: "bank",
    bankMode: payment.mode ?? "fixed",
    status: payment.status,
    litmatchId: payment.litmatchId,
    rewardType: payment.rewardType,
    amount,
    revenueAmount: isBankRevenueEligible(payment) ? amount : 0,
    rewardAmount: normalizeMoney(payment.rewardAmount),
    transferContent: payment.transferContent,
    requestId: null,
    cardProvider: null,
    cardDenomination: null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    completedAt: serializeDate(payment.recharge?.completedAt),
  };
}

function serializeCardTransaction(
  payment: CtvCardPaymentDocument,
): AdminCtvTransactionRow {
  const amount = getCardRevenueAmount(payment);

  return {
    id: payment._id?.toString() ?? "",
    type: "card",
    bankMode: null,
    status: payment.status,
    litmatchId: payment.litmatchId,
    rewardType: payment.rewardType,
    amount,
    revenueAmount: isCardRevenueEligible(payment) ? amount : 0,
    rewardAmount: normalizeMoney(payment.rewardAmount),
    transferContent: null,
    requestId: payment.requestId ?? null,
    cardProvider: payment.cardProvider,
    cardDenomination: payment.cardDenomination,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    completedAt: serializeDate(payment.recharge?.completedAt),
  };
}

function serializeDirectTransaction(
  recharge: CtvDirectRechargeDocument,
  bankRate: Parameters<typeof calculatePaymentAmountFromReward>[2],
): AdminCtvTransactionRow {
  const rewardAmount = normalizeMoney(recharge.rewardAmount);
  const amount =
    recharge.status === "completed"
      ? calculatePaymentAmountFromReward(
          rewardAmount,
          recharge.rewardType,
          bankRate,
        )
      : 0;

  return {
    id: recharge._id?.toString() ?? "",
    type: "direct",
    bankMode: null,
    status: recharge.status,
    litmatchId: recharge.litmatchId,
    rewardType: recharge.rewardType,
    amount,
    revenueAmount: amount,
    rewardAmount,
    transferContent: recharge.note ?? null,
    requestId: null,
    cardProvider: null,
    cardDenomination: null,
    createdAt: recharge.createdAt.toISOString(),
    updatedAt: recharge.updatedAt.toISOString(),
    completedAt: serializeDate(recharge.recharge?.completedAt),
  };
}

function summarizeCtvTransactions(
  rows: AdminCtvTransactionRow[],
): AdminCtvRevenueSummary {
  return rows.reduce(
    (current, row) => {
      const isCompleted = row.status === "completed";

      return {
        transactionCount: current.transactionCount + 1,
        completedCount: current.completedCount + (isCompleted ? 1 : 0),
        bankCompletedRevenue:
          current.bankCompletedRevenue +
          (row.type === "bank" ? row.revenueAmount : 0),
        cardCompletedRevenue:
          current.cardCompletedRevenue +
          (row.type === "card" ? row.revenueAmount : 0),
        totalCompletedRevenue:
          current.totalCompletedRevenue + row.revenueAmount,
        totalRewardAmount:
          current.totalRewardAmount + (isCompleted ? row.rewardAmount : 0),
        diamondRewardAmount:
          current.diamondRewardAmount +
          (isCompleted && row.rewardType === "diamond" ? row.rewardAmount : 0),
        starRewardAmount:
          current.starRewardAmount +
          (isCompleted && row.rewardType === "star" ? row.rewardAmount : 0),
      };
    },
    {
      transactionCount: 0,
      completedCount: 0,
      bankCompletedRevenue: 0,
      cardCompletedRevenue: 0,
      totalCompletedRevenue: 0,
      totalRewardAmount: 0,
      diamondRewardAmount: 0,
      starRewardAmount: 0,
    },
  );
}

export async function listCtvTransactions(
  input: CtvTransactionListInput,
): Promise<AdminPaginatedCtvTransactions> {
  if (!ObjectId.isValid(input.ctvId)) {
    throw new CtvNotFoundError();
  }

  const ctvId = new ObjectId(input.ctvId);
  const page = normalizeListPage(input.page);
  const pageSize = normalizeListPageSize(input.pageSize);
  const rows: AdminCtvTransactionRow[] = [];
  const [ctvCollection, runtimeConfig] = await Promise.all([
    getCollection<CtvDocument>("ctvs"),
    getRuntimeConfig(),
  ]);
  const ctv = await ctvCollection.findOne({ _id: ctvId });
  const bankRate = runtimeConfig.bankRate;

  if (!ctv) {
    throw new CtvNotFoundError();
  }

  if (
    input.type !== "card" &&
    input.type !== "direct" &&
    shouldQueryPaymentTransactions(input.status)
  ) {
    const bankPayments = await getCollection<CtvBankPaymentDocument>(
      "bank_payments",
    );
    const bankRows = await bankPayments
      .find(buildCtvPaymentFilter<CtvBankPaymentDocument>(input, ctvId, ctv))
      .toArray();

    rows.push(...bankRows.map(serializeBankTransaction));
  }

  if (
    input.type !== "bank" &&
    input.type !== "direct" &&
    shouldQueryPaymentTransactions(input.status)
  ) {
    const cardPayments = await getCollection<CtvCardPaymentDocument>(
      "card_payments",
    );
    const cardRows = await cardPayments
      .find(buildCtvPaymentFilter<CtvCardPaymentDocument>(input, ctvId, ctv))
      .toArray();

    rows.push(...cardRows.map(serializeCardTransaction));
  }

  if (
    input.type !== "bank" &&
    input.type !== "card" &&
    shouldQueryDirectTransactions(input.status)
  ) {
    const directRecharges = await getCollection<CtvDirectRechargeDocument>(
      "admin_direct_recharges",
    );
    const directRows = await directRecharges
      .find(buildCtvDirectRechargeFilter(input, ctv))
      .toArray();

    rows.push(...directRows.map((row) => serializeDirectTransaction(row, bankRate)));
  }

  rows.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
    summary: summarizeCtvTransactions(rows),
  };
}
