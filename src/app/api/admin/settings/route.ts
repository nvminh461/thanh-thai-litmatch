import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import { toAdminRuntimeConfigForm } from "@/server/admin-view";
import { getRuntimeConfig, saveRuntimeConfig } from "@/server/runtime-config";
import {
  normalizeDiamondSaleRateConfig,
  normalizePaymentCodePrefix,
  type DiamondSaleRateTier,
  type RuntimeConfig,
} from "@/lib/payment-config";

function requiredString(value: unknown, fieldName: string) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new Error(`Vui lòng nhập ${fieldName}.`);
  }

  return normalized;
}

function positiveNumber(value: unknown, fieldName: string) {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} không hợp lệ.`);
  }

  return numberValue;
}

function nonNegativeNumber(value: unknown, fieldName: string) {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`${fieldName} không hợp lệ.`);
  }

  return numberValue;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function contactNumber(value: unknown, fieldName: string) {
  const normalized = optionalString(value).replace(/[\s.-]/g, "");

  if (normalized && !/^\+?\d+$/.test(normalized)) {
    throw new Error(`${fieldName} chỉ được nhập số.`);
  }

  return normalized;
}

function optionalHttpUrl(value: unknown, fieldName: string) {
  const normalized = optionalString(value);

  if (!normalized) {
    return "";
  }

  try {
    const parsedUrl = new URL(normalized);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error();
    }

    return parsedUrl.toString();
  } catch {
    throw new Error(`${fieldName} phải là URL http/https hợp lệ.`);
  }
}

function diamondSaleTiers(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Vui lòng cấu hình ít nhất một mốc kim cương xả.");
  }

  const seenMinAmounts = new Set<number>();
  const tiers: DiamondSaleRateTier[] = value.map((item, index) => {
    const row =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : {};
    const minAmount = nonNegativeNumber(
      row.minAmount,
      `Mốc tiền kim cương xả dòng ${index + 1}`,
    );
    const diamond = positiveNumber(
      row.diamond,
      `Kim cương xả dòng ${index + 1}`,
    );
    const normalizedMinAmount = Math.floor(minAmount);

    if (seenMinAmounts.has(normalizedMinAmount)) {
      throw new Error("Mốc tiền kim cương xả không được trùng nhau.");
    }

    seenMinAmounts.add(normalizedMinAmount);

    return {
      minAmount: normalizedMinAmount,
      diamond,
    };
  });

  if (!tiers.length) {
    throw new Error("Vui lòng cấu hình ít nhất một mốc kim cương xả.");
  }

  if (!tiers.some((tier) => tier.minAmount === 0)) {
    tiers.push({ minAmount: 0, diamond: tiers[0].diamond });
  }

  return tiers.sort((left, right) => left.minAmount - right.minAmount);
}

export async function POST(request: Request) {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      {
        success: false,
        error: "Chưa đăng nhập.",
      },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const currentConfig = await getRuntimeConfig();
    const paymentCodePrefix = normalizePaymentCodePrefix(
      requiredString(body.paymentCodePrefix, "prefix mã thanh toán"),
    );

    if (paymentCodePrefix.length < 2) {
      throw new Error("Prefix mã thanh toán phải có từ 2 đến 5 ký tự.");
    }

    const nextConfig: RuntimeConfig = {
      bank: {
        bankId: requiredString(body.bankId, "mã ngân hàng VietQR"),
        bankName: requiredString(body.bankName, "tên ngân hàng"),
        accountNo: requiredString(body.accountNo, "số tài khoản"),
        accountName: requiredString(body.accountName, "chủ tài khoản"),
        template: requiredString(body.template, "template VietQR"),
      },
      bankRate: {
        baseAmount: positiveNumber(
          body.bankBaseAmount,
          "Mốc tiền chuyển khoản",
        ),
        diamond: positiveNumber(body.bankDiamond, "Tỷ lệ kim cương chuyển khoản"),
        star: positiveNumber(body.bankStar, "Tỷ lệ sao chuyển khoản"),
      },
      cardRate: {
        baseAmount: positiveNumber(body.cardBaseAmount, "Mốc tiền nạp thẻ"),
        diamond: positiveNumber(body.cardDiamond, "Tỷ lệ kim cương nạp thẻ"),
        star: positiveNumber(body.cardStar, "Tỷ lệ sao nạp thẻ"),
      },
      diamondSaleRate: normalizeDiamondSaleRateConfig({
        baseAmount: positiveNumber(
          body.diamondSaleBaseAmount,
          "Mốc tiền kim cương xả",
        ),
        tiers: diamondSaleTiers(body.diamondSaleTiers),
      }),
      site: {
        dealerName: requiredString(body.dealerName, "tên đại lý"),
        zaloPhone: contactNumber(body.zaloPhone, "Số Zalo"),
        supportGroupUrl: optionalHttpUrl(
          body.supportGroupUrl,
          "Link GROUP CSKH",
        ),
        facebookUrl: optionalHttpUrl(body.facebookUrl, "URL Facebook"),
        phoneNumber: contactNumber(body.phoneNumber, "Số điện thoại"),
        announcementEnabled: Boolean(body.announcementEnabled),
        announcementText: optionalString(body.announcementText),
      },
      totp: currentConfig.totp,
      litmatchAgent: currentConfig.litmatchAgent,
      paymentCodePrefix,
    };
    const savedConfig = await saveRuntimeConfig(nextConfig);

    return NextResponse.json({
      success: true,
      data: toAdminRuntimeConfigForm(savedConfig),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Không lưu được cấu hình.",
      },
      { status: 400 },
    );
  }
}
