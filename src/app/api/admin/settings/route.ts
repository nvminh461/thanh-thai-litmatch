import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import { toAdminRuntimeConfigForm } from "@/server/admin-view";
import { getRuntimeConfig, saveRuntimeConfig } from "@/server/runtime-config";
import { normalizePaymentCodePrefix, type RuntimeConfig } from "@/lib/payment-config";

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
