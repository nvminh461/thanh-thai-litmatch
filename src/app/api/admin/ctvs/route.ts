import { NextResponse } from "next/server";
import { getAdminSession } from "@/server/admin-auth";
import {
  createCtv,
  CtvNotFoundError,
  CtvValidationError,
  disableCtvLogin,
  listCtvs,
  updateCtv,
} from "@/server/ctv-repository";

function readListInput(searchParams: URLSearchParams) {
  return {
    page: Number(searchParams.get("page") ?? 1),
    pageSize: 20,
  };
}

function getBodyObject(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

async function requireAdmin() {
  const session = await getAdminSession();

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Chưa đăng nhập." },
      { status: 401 },
    );
  }

  return null;
}

function handleCtvError(error: unknown, fallback: string) {
  if (error instanceof CtvNotFoundError) {
    return NextResponse.json(
      { success: false, error: "Không tìm thấy CTV." },
      { status: 404 },
    );
  }

  if (error instanceof CtvValidationError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { success: false, error: fallback },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin();

  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);

  return NextResponse.json({
    success: true,
    data: await listCtvs(readListInput(searchParams)),
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin();

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = getBodyObject(await request.json());

    return NextResponse.json({
      success: true,
      data: await createCtv(body),
    });
  } catch (error) {
    return handleCtvError(error, "Không tạo được CTV.");
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireAdmin();

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = getBodyObject(await request.json());

    return NextResponse.json({
      success: true,
      data: await updateCtv(body),
    });
  } catch (error) {
    return handleCtvError(error, "Không cập nhật được CTV.");
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin();

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = getBodyObject(await request.json());

    return NextResponse.json({
      success: true,
      data: await disableCtvLogin({ id: body.id }),
    });
  } catch (error) {
    return handleCtvError(error, "Không khóa được CTV.");
  }
}
