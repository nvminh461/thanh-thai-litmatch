"use client";

import { useState } from "react";
import type {
  AdminCtvRow,
  AdminCtvTransactionRow,
  AdminPaginatedCtvTransactions,
  AdminPaginatedCtvs,
} from "@/lib/admin-types";
import styles from "./admin.module.css";

type CtvAdminPanelProps = {
  initialCtvs: AdminPaginatedCtvs;
};

type CtvFormState = {
  id: string;
  name: string;
  username: string;
  password: string;
};

type CtvTransactionFilters = {
  type: AdminCtvTransactionRow["type"] | "all";
  status: AdminCtvTransactionRow["status"] | "all";
  litmatchId: string;
  updatedFrom: string;
  updatedTo: string;
};

type CtvListResponse = {
  success: boolean;
  data?: AdminPaginatedCtvs;
  error?: string;
};

type CtvMutationResponse = {
  success: boolean;
  data?: AdminCtvRow;
  error?: string;
};

type CtvTransactionsResponse = {
  success: boolean;
  data?: AdminPaginatedCtvTransactions;
  error?: string;
};

const numberFormatter = new Intl.NumberFormat("vi-VN");
const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Ho_Chi_Minh",
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "-";
}

function emptyCtvForm(): CtvFormState {
  return {
    id: "",
    name: "",
    username: "",
    password: "",
  };
}

function emptyTransactionFilters(): CtvTransactionFilters {
  return {
    type: "all",
    status: "all",
    litmatchId: "",
    updatedFrom: "",
    updatedTo: "",
  };
}

function statusLabel(status: AdminCtvTransactionRow["status"]) {
  if (status === "completed") {
    return "Đã nạp";
  }

  if (status === "recharge_failed" || status === "failed") {
    return "Lỗi nạp";
  }

  if (status === "processing" || status === "pending") {
    return "Đang xử lý";
  }

  return status === "paid" ? "Đã thanh toán" : "Chưa thanh toán";
}

function statusClassName(status: AdminCtvTransactionRow["status"]) {
  if (status === "completed") {
    return styles.statusCompleted;
  }

  if (status === "recharge_failed" || status === "failed") {
    return styles.statusFailed;
  }

  if (status === "processing" || status === "pending") {
    return styles.statusProcessing;
  }

  return status === "paid" ? styles.statusPaid : styles.statusIncomplete;
}

function rewardLabel(value: AdminCtvTransactionRow["rewardType"]) {
  return value === "diamond" ? "Kim cương" : "Sao";
}

function transactionTypeLabel(row: AdminCtvTransactionRow) {
  if (row.type === "card") {
    return "Nạp thẻ";
  }

  if (row.type === "direct") {
    return "Nạp trực tiếp";
  }

  return row.bankMode === "lifetime" ? "QR trọn đời" : "Chuyển khoản";
}

function isLocked(ctv: AdminCtvRow) {
  return Boolean(ctv.loginDisabledAt || ctv.deletedAt);
}

function ctvInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function buildRefUrl(code: string) {
  if (typeof window === "undefined") {
    return buildRefPath(code);
  }

  const url = new URL("/", window.location.origin);
  url.searchParams.set("ctv", code);

  return url.toString();
}

function buildRefPath(code: string) {
  return `/?ctv=${encodeURIComponent(code)}`;
}

export default function CtvAdminPanel({ initialCtvs }: CtvAdminPanelProps) {
  const [ctvPageData, setCtvPageData] = useState(initialCtvs);
  const [ctvPage, setCtvPage] = useState(initialCtvs.page);
  const [form, setForm] = useState<CtvFormState>(emptyCtvForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lockingId, setLockingId] = useState("");
  const [copiedCode, setCopiedCode] = useState("");
  const [selectedCtv, setSelectedCtv] = useState<AdminCtvRow | null>(null);
  const [transactionData, setTransactionData] =
    useState<AdminPaginatedCtvTransactions | null>(null);
  const [transactionFilters, setTransactionFilters] =
    useState<CtvTransactionFilters>(emptyTransactionFilters);
  const [appliedTransactionFilters, setAppliedTransactionFilters] =
    useState<CtvTransactionFilters>(emptyTransactionFilters);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [transactionError, setTransactionError] = useState("");

  async function reloadCtvs(page = ctvPage) {
    const params = new URLSearchParams({ page: String(page) });
    const response = await fetch(`/api/admin/ctvs?${params.toString()}`);
    const payload = (await response.json()) as CtvListResponse;

    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Không tải được danh sách CTV.");
    }

    setCtvPageData(payload.data);
    setCtvPage(payload.data.page);
  }

  function updateCtvRow(row: AdminCtvRow) {
    setCtvPageData((current) => ({
      ...current,
      rows: current.rows.map((item) => (item.id === row.id ? row : item)),
    }));
    setSelectedCtv((current) => (current?.id === row.id ? row : current));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const isEditing = Boolean(form.id);
      const body = {
        id: form.id,
        name: form.name,
        username: form.username,
        ...(form.password.trim() ? { password: form.password } : {}),
      };
      const response = await fetch("/api/admin/ctvs", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as CtvMutationResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error ?? "Không lưu được CTV.");
        return;
      }

      if (isEditing) {
        updateCtvRow(payload.data);
      } else {
        await reloadCtvs(1);
      }

      setForm(emptyCtvForm());
      setMessage(
        isEditing
          ? "Đã cập nhật CTV."
          : `Đã tạo CTV. Code ref: ${payload.data.code}`,
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Không lưu được CTV.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(ctv: AdminCtvRow) {
    setForm({
      id: ctv.id,
      name: ctv.name,
      username: ctv.username,
      password: "",
    });
    setError("");
    setMessage("");
  }

  async function lockCtv(ctv: AdminCtvRow) {
    if (
      !window.confirm(
        "Khóa đăng nhập CTV này? Link ref cũ vẫn tiếp tục ghi nhận giao dịch.",
      )
    ) {
      return;
    }

    setLockingId(ctv.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/ctvs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: ctv.id }),
      });
      const payload = (await response.json()) as CtvMutationResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error ?? "Không khóa được CTV.");
        return;
      }

      updateCtvRow(payload.data);
      setMessage("Đã khóa đăng nhập CTV. Link ref vẫn ghi nhận giao dịch.");
    } catch {
      setError("Không khóa được CTV.");
    } finally {
      setLockingId("");
    }
  }

  async function copyRef(ctv: AdminCtvRow) {
    try {
      await navigator.clipboard.writeText(buildRefUrl(ctv.code));
      setCopiedCode(ctv.code);
      window.setTimeout(() => setCopiedCode(""), 1600);
    } catch {
      setCopiedCode("");
    }
  }

  async function fetchTransactions(
    ctv: AdminCtvRow,
    page = 1,
    filters = appliedTransactionFilters,
  ) {
    setTransactionLoading(true);
    setTransactionError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        type: filters.type,
        status: filters.status,
        litmatchId: filters.litmatchId,
        updatedFrom: filters.updatedFrom,
        updatedTo: filters.updatedTo,
      });
      const response = await fetch(
        `/api/admin/ctvs/${ctv.id}/transactions?${params.toString()}`,
      );
      const payload = (await response.json()) as CtvTransactionsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setTransactionError(payload.error ?? "Không tải được giao dịch CTV.");
        return;
      }

      setSelectedCtv(ctv);
      setTransactionData(payload.data);
    } catch {
      setTransactionError("Không tải được giao dịch CTV.");
    } finally {
      setTransactionLoading(false);
    }
  }

  function applyTransactionFilters() {
    setAppliedTransactionFilters(transactionFilters);

    if (selectedCtv) {
      fetchTransactions(selectedCtv, 1, transactionFilters);
    }
  }

  function clearTransactionFilters() {
    const emptyFilters = emptyTransactionFilters();
    setTransactionFilters(emptyFilters);
    setAppliedTransactionFilters(emptyFilters);

    if (selectedCtv) {
      fetchTransactions(selectedCtv, 1, emptyFilters);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="ctv-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="ctv-title">Quản lý CTV</h2>
          <p>Tạo CTV, copy link ref và xem doanh thu theo từng CTV.</p>
        </div>
      </div>

      <form
        className={styles.settingsForm}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Tên CTV</span>
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Tài khoản đăng nhập</span>
            <input
              autoComplete="username"
              required
              value={form.username}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>{form.id ? "Mật khẩu mới" : "Mật khẩu"}</span>
            <input
              autoComplete={form.id ? "new-password" : "current-password"}
              placeholder={form.id ? "Để trống nếu không đổi" : ""}
              required={!form.id}
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </label>
        </div>

        {error ? (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={styles.successText} role="status">
            {message}
          </p>
        ) : null}

        <div className={styles.formActions}>
          {form.id ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setForm(emptyCtvForm())}
            >
              Hủy sửa
            </button>
          ) : null}
          <button className={styles.primaryButton} type="submit" disabled={submitting}>
            {submitting ? "Đang lưu..." : form.id ? "Cập nhật CTV" : "Tạo CTV"}
          </button>
        </div>
      </form>

      <div className={styles.ctvList}>
        {ctvPageData.rows.length ? (
          ctvPageData.rows.map((ctv) => {
            const locked = isLocked(ctv);
            const selected = selectedCtv?.id === ctv.id;

            return (
              <article
                className={`${styles.ctvCard}${
                  selected ? ` ${styles.ctvCardSelected}` : ""
                }`}
                key={ctv.id}
              >
                <div className={styles.ctvCardTop}>
                  <span className={styles.ctvAvatar} aria-hidden="true">
                    {ctvInitials(ctv.name)}
                  </span>
                  <div className={styles.ctvIdentity}>
                    <strong>{ctv.name}</strong>
                    <span>{ctv.username}</span>
                  </div>
                  <span
                    className={`${styles.statusBadge} ${
                      locked ? styles.statusFailed : styles.statusCompleted
                    }`}
                  >
                    {locked ? "Khóa đăng nhập" : "Hoạt động"}
                  </span>
                </div>

                <div className={styles.ctvCardMeta}>
                  <div>
                    <span>Code ref</span>
                    <strong>{ctv.code}</strong>
                    <small>{buildRefPath(ctv.code)}</small>
                  </div>
                  <div>
                    <span>Cập nhật</span>
                    <strong>{formatDate(ctv.updatedAt)}</strong>
                    <small>
                      {locked
                        ? "Ref vẫn ghi nhận giao dịch"
                        : "CTV có thể đăng nhập thống kê"}
                    </small>
                  </div>
                </div>

                <div className={styles.ctvCardActions}>
                  <button
                    className={styles.inlineActionButton}
                    type="button"
                    onClick={() => copyRef(ctv)}
                  >
                    {copiedCode === ctv.code ? "Đã chép" : "Copy link"}
                  </button>
                  <button
                    className={`${styles.inlineActionButton}${
                      selected ? ` ${styles.inlineActionButtonActive}` : ""
                    }`}
                    type="button"
                    onClick={() => fetchTransactions(ctv, 1)}
                  >
                    Doanh thu
                  </button>
                  <button
                    className={styles.inlineActionButton}
                    type="button"
                    onClick={() => startEdit(ctv)}
                  >
                    Sửa
                  </button>
                  <button
                    className={styles.ctvDangerButton}
                    type="button"
                    disabled={lockingId === ctv.id || locked}
                    onClick={() => lockCtv(ctv)}
                  >
                    {lockingId === ctv.id ? "Đang khóa..." : "Xóa"}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <p className={styles.ctvEmptyState}>Chưa có CTV.</p>
        )}
      </div>

      <div className={styles.pagination}>
        <span>
          Trang {formatNumber(ctvPageData.page)}/
          {formatNumber(ctvPageData.totalPages)}
        </span>
        <div className={styles.paginationActions}>
          <button
            type="button"
            disabled={ctvPageData.page <= 1}
            onClick={() => reloadCtvs(Math.max(1, ctvPageData.page - 1))}
          >
            Trước
          </button>
          <button
            type="button"
            disabled={ctvPageData.page >= ctvPageData.totalPages}
            onClick={() =>
              reloadCtvs(Math.min(ctvPageData.totalPages, ctvPageData.page + 1))
            }
          >
            Sau
          </button>
        </div>
      </div>

      {selectedCtv ? (
        <section className={styles.formSection} aria-labelledby="ctv-revenue-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="ctv-revenue-title">Doanh thu {selectedCtv.name}</h2>
              <p>
                Link ref: <strong>{buildRefPath(selectedCtv.code)}</strong>. Ghi
                chú nạp trực tiếp dùng code{" "}
                <strong>{selectedCtv.code}</strong>.
              </p>
            </div>
          </div>

          <div className={styles.filters}>
            <label className={styles.filterField}>
              <span>Loại</span>
              <select
                value={transactionFilters.type}
                onChange={(event) =>
                  setTransactionFilters((current) => ({
                    ...current,
                    type: event.target.value as CtvTransactionFilters["type"],
                  }))
                }
              >
                <option value="all">Tất cả</option>
                <option value="bank">Chuyển khoản</option>
                <option value="card">Nạp thẻ</option>
                <option value="direct">Nạp trực tiếp</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Trạng thái</span>
              <select
                value={transactionFilters.status}
                onChange={(event) =>
                  setTransactionFilters((current) => ({
                    ...current,
                    status: event.target.value as CtvTransactionFilters["status"],
                  }))
                }
              >
                <option value="all">Tất cả</option>
                <option value="incomplete">Chưa thanh toán</option>
                <option value="processing">Đang xử lý</option>
                <option value="paid">Đã thanh toán</option>
                <option value="completed">Đã nạp</option>
                <option value="recharge_failed">Lỗi nạp</option>
                <option value="pending">Nạp trực tiếp đang xử lý</option>
                <option value="failed">Nạp trực tiếp lỗi</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>ID Litmatch</span>
              <input
                value={transactionFilters.litmatchId}
                onChange={(event) =>
                  setTransactionFilters((current) => ({
                    ...current,
                    litmatchId: event.target.value,
                  }))
                }
              />
            </label>
            <label className={styles.filterField}>
              <span>Từ ngày</span>
              <input
                type="date"
                value={transactionFilters.updatedFrom}
                onChange={(event) =>
                  setTransactionFilters((current) => ({
                    ...current,
                    updatedFrom: event.target.value,
                  }))
                }
              />
            </label>
            <label className={styles.filterField}>
              <span>Đến ngày</span>
              <input
                type="date"
                value={transactionFilters.updatedTo}
                onChange={(event) =>
                  setTransactionFilters((current) => ({
                    ...current,
                    updatedTo: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className={styles.applyFilterButton}
              type="button"
              onClick={applyTransactionFilters}
            >
              Lọc
            </button>
            <button
              className={styles.clearFilterButton}
              type="button"
              onClick={clearTransactionFilters}
            >
              Xóa lọc
            </button>
          </div>

          {transactionError ? (
            <p className={styles.errorText} role="alert">
              {transactionError}
            </p>
          ) : null}

          {transactionData ? (
            <>
              <div className={styles.ctvSummaryGrid}>
                <div className={styles.ctvSummaryPrimary}>
                  <span>Doanh thu</span>
                  <strong>
                    {formatNumber(transactionData.summary.totalCompletedRevenue)} đ
                  </strong>
                  <small>Chỉ tính giao dịch đã nạp thành công</small>
                </div>
                <div className={styles.ctvSummaryItem}>
                  <span>Tổng giao dịch</span>
                  <strong>
                    {formatNumber(transactionData.summary.transactionCount)}
                  </strong>
                </div>
                <div className={styles.ctvSummaryItem}>
                  <span>Đã nạp</span>
                  <strong>
                    {formatNumber(transactionData.summary.completedCount)}
                  </strong>
                </div>
                <div className={styles.ctvSummaryItem}>
                  <span>Kim cương</span>
                  <strong>
                    {formatNumber(transactionData.summary.diamondRewardAmount)}
                  </strong>
                </div>
                <div className={styles.ctvSummaryItem}>
                  <span>Sao</span>
                  <strong>
                    {formatNumber(transactionData.summary.starRewardAmount)}
                  </strong>
                </div>
              </div>

              <div className={styles.ctvTransactionList}>
                {transactionData.rows.length ? (
                  transactionData.rows.map((row) => (
                    <article
                      className={styles.ctvTransactionItem}
                      key={`${row.type}-${row.id}`}
                    >
                      <div className={styles.ctvTransactionMain}>
                        <div>
                          <strong>{transactionTypeLabel(row)}</strong>
                          <span>ID Litmatch {row.litmatchId}</span>
                        </div>
                        <span
                          className={`${styles.statusBadge} ${statusClassName(
                            row.status,
                          )}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </div>
                      <div className={styles.ctvTransactionMetrics}>
                        <div>
                          <span>Doanh thu</span>
                          <strong>{formatNumber(row.revenueAmount)} đ</strong>
                        </div>
                        <div>
                          <span>Thực nhận</span>
                          <strong>
                            {formatNumber(row.rewardAmount)}{" "}
                            {rewardLabel(row.rewardType)}
                          </strong>
                        </div>
                        <div>
                          <span>Mã/Nội dung</span>
                          <strong>{row.transferContent ?? row.requestId ?? "-"}</strong>
                        </div>
                        <div>
                          <span>Cập nhật</span>
                          <strong>{formatDate(row.updatedAt)}</strong>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className={styles.emptyCell}>Không có giao dịch phù hợp.</p>
                )}
              </div>

              <div className={styles.pagination}>
                <span>
                  Trang {formatNumber(transactionData.page)}/
                  {formatNumber(transactionData.totalPages)}
                </span>
                <div className={styles.paginationActions}>
                  <button
                    type="button"
                    disabled={transactionData.page <= 1 || transactionLoading}
                    onClick={() =>
                      fetchTransactions(
                        selectedCtv,
                        Math.max(1, transactionData.page - 1),
                      )
                    }
                  >
                    Trước
                  </button>
                  <button
                    type="button"
                    disabled={
                      transactionData.page >= transactionData.totalPages ||
                      transactionLoading
                    }
                    onClick={() =>
                      fetchTransactions(
                        selectedCtv,
                        Math.min(
                          transactionData.totalPages,
                          transactionData.page + 1,
                        ),
                      )
                    }
                  >
                    Sau
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p>{transactionLoading ? "Đang tải giao dịch..." : "Chọn CTV để xem doanh thu."}</p>
          )}
        </section>
      ) : null}
    </section>
  );
}
