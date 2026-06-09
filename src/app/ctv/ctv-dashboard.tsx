"use client";

import { useState } from "react";
import type {
  AdminCtvTransactionRow,
  AdminPaginatedCtvTransactions,
} from "@/lib/admin-types";
import type { CtvSessionProfile } from "@/server/ctv-repository";
import styles from "../admin/admin.module.css";

type CtvDashboardProps = {
  profile: CtvSessionProfile;
  initialTransactions: AdminPaginatedCtvTransactions;
};

type TransactionFilters = {
  type: AdminCtvTransactionRow["type"] | "all";
  status: AdminCtvTransactionRow["status"] | "all";
  litmatchId: string;
  updatedFrom: string;
  updatedTo: string;
};

type PasswordFormState = {
  currentPassword: string;
  nextPassword: string;
  confirmPassword: string;
};

type TransactionsResponse = {
  success: boolean;
  data?: AdminPaginatedCtvTransactions;
  error?: string;
};

type PasswordResponse = {
  success: boolean;
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

function emptyFilters(): TransactionFilters {
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

function buildRefPath(code: string) {
  return `/?ctv=${encodeURIComponent(code)}`;
}

function buildRefUrl(code: string) {
  if (typeof window === "undefined") {
    return buildRefPath(code);
  }

  const url = new URL("/", window.location.origin);
  url.searchParams.set("ctv", code);

  return url.toString();
}

function emptyPasswordForm(): PasswordFormState {
  return {
    currentPassword: "",
    nextPassword: "",
    confirmPassword: "",
  };
}

export default function CtvDashboard({
  profile,
  initialTransactions,
}: CtvDashboardProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [filters, setFilters] = useState<TransactionFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<TransactionFilters>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [passwordForm, setPasswordForm] =
    useState<PasswordFormState>(emptyPasswordForm);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  async function fetchTransactions(
    page = transactions.page,
    nextFilters = appliedFilters,
  ) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        type: nextFilters.type,
        status: nextFilters.status,
        litmatchId: nextFilters.litmatchId,
        updatedFrom: nextFilters.updatedFrom,
        updatedTo: nextFilters.updatedTo,
      });
      const response = await fetch(`/api/ctv/transactions?${params.toString()}`);
      const payload = (await response.json()) as TransactionsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error ?? "Không tải được giao dịch.");
        return;
      }

      setTransactions(payload.data);
    } catch {
      setError("Không tải được giao dịch.");
    } finally {
      setLoading(false);
    }
  }

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(buildRefUrl(profile.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function applyFilters() {
    setAppliedFilters(filters);
    fetchTransactions(1, filters);
  }

  function clearFilters() {
    const nextFilters = emptyFilters();
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    fetchTransactions(1, nextFilters);
  }

  async function changePassword() {
    setPasswordMessage("");
    setPasswordError("");

    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      setPasswordError("Mật khẩu mới nhập lại không khớp.");
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch("/api/ctv/password", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          nextPassword: passwordForm.nextPassword,
        }),
      });
      const payload = (await response.json()) as PasswordResponse;

      if (!response.ok || !payload.success) {
        setPasswordError(payload.error ?? "Không đổi được mật khẩu.");
        return;
      }

      setPasswordForm(emptyPasswordForm());
      setPasswordMessage("Đã đổi mật khẩu.");
    } catch {
      setPasswordError("Không đổi được mật khẩu.");
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <main className={styles.adminPage}>
      <aside className={styles.sidebar} aria-label="Thông tin CTV">
        <div className={styles.sidebarBrand}>
          <p className={styles.kicker}>CTV Thành Thái</p>
          <strong>{profile.name}</strong>
          <span>{profile.username}</span>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={copyRef}>
          {copied ? "Đã chép link" : "Copy link ref"}
        </button>
        <form action="/api/ctv/logout" method="post">
          <button className={styles.secondaryButton} type="submit">
            Đăng xuất
          </button>
        </form>
      </aside>

      <div className={styles.adminContent}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Thống kê CTV</p>
            <h1>Doanh thu của bạn</h1>
            <p className={styles.refLine}>{buildRefPath(profile.code)}</p>
          </div>
        </header>

        <section className={styles.panel} aria-labelledby="ctv-password-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="ctv-password-title">Tài khoản CTV</h2>
              <p>Đổi mật khẩu đăng nhập thống kê.</p>
            </div>
          </div>

          <form
            className={styles.directRechargeForm}
            onSubmit={(event) => {
              event.preventDefault();
              changePassword();
            }}
          >
            <label className={styles.field}>
              <span>Mật khẩu hiện tại</span>
              <input
                autoComplete="current-password"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    currentPassword: event.target.value,
                  }))
                }
              />
            </label>
            <label className={styles.field}>
              <span>Mật khẩu mới</span>
              <input
                autoComplete="new-password"
                type="password"
                value={passwordForm.nextPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    nextPassword: event.target.value,
                  }))
                }
              />
            </label>
            <label className={styles.field}>
              <span>Nhập lại mật khẩu mới</span>
              <input
                autoComplete="new-password"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({
                    ...current,
                    confirmPassword: event.target.value,
                  }))
                }
              />
            </label>

            {passwordError ? (
              <p className={styles.errorText} role="alert">
                {passwordError}
              </p>
            ) : null}
            {passwordMessage ? (
              <p className={styles.successText} role="status">
                {passwordMessage}
              </p>
            ) : null}

            <div className={styles.formActions}>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={passwordLoading}
              >
                {passwordLoading ? "Đang đổi..." : "Đổi mật khẩu"}
              </button>
            </div>
          </form>
        </section>

        <section className={styles.panel} aria-labelledby="ctv-dashboard-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="ctv-dashboard-title">Giao dịch CTV</h2>
              <p>
                Gồm giao dịch qua link ref và nạp trực tiếp được ghi chú bằng
                code {profile.code}. Doanh thu tính theo số tiền khách đã thanh
                toán.
              </p>
            </div>
          </div>

          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span>Doanh thu</span>
              <strong>
                {formatNumber(transactions.summary.totalCompletedRevenue)} đ
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Tổng giao dịch</span>
              <strong>{formatNumber(transactions.summary.transactionCount)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Đã nạp</span>
              <strong>{formatNumber(transactions.summary.completedCount)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Kim cương</span>
              <strong>{formatNumber(transactions.summary.diamondRewardAmount)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Sao</span>
              <strong>{formatNumber(transactions.summary.starRewardAmount)}</strong>
            </div>
          </div>

          <div className={styles.filters}>
            <label className={styles.filterField}>
              <span>Loại</span>
              <select
                value={filters.type}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    type: event.target.value as TransactionFilters["type"],
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
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value as TransactionFilters["status"],
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
                value={filters.litmatchId}
                onChange={(event) =>
                  setFilters((current) => ({
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
                value={filters.updatedFrom}
                onChange={(event) =>
                  setFilters((current) => ({
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
                value={filters.updatedTo}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    updatedTo: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className={styles.applyFilterButton}
              type="button"
              onClick={applyFilters}
            >
              Lọc
            </button>
            <button
              className={styles.clearFilterButton}
              type="button"
              onClick={clearFilters}
            >
              Xóa lọc
            </button>
          </div>

          {error ? (
            <p className={styles.errorText} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Trạng thái</th>
                  <th>Loại</th>
                  <th>ID Litmatch</th>
                  <th>Loại nhận</th>
                  <th>Doanh thu</th>
                  <th>Thực nhận</th>
                  <th>Mã/Nội dung</th>
                  <th>Cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {transactions.rows.length ? (
                  transactions.rows.map((row) => (
                    <tr key={`${row.type}-${row.id}`}>
                      <td data-label="Trạng thái">
                        <span
                          className={`${styles.statusBadge} ${statusClassName(
                            row.status,
                          )}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td data-label="Loại">{transactionTypeLabel(row)}</td>
                      <td data-label="ID Litmatch">{row.litmatchId}</td>
                      <td data-label="Loại nhận">
                        {rewardLabel(row.rewardType)}
                      </td>
                      <td data-label="Doanh thu">
                        {formatNumber(row.revenueAmount)} đ
                      </td>
                      <td data-label="Thực nhận">
                        {formatNumber(row.rewardAmount)}{" "}
                        {rewardLabel(row.rewardType)}
                      </td>
                      <td
                        data-label="Mã/Nội dung"
                        className={styles.monoCell}
                      >
                        {row.transferContent ?? row.requestId ?? "-"}
                      </td>
                      <td data-label="Cập nhật">
                        {formatDate(row.updatedAt)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      {loading
                        ? "Đang tải giao dịch..."
                        : "Chưa có giao dịch phù hợp."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span>
              Trang {formatNumber(transactions.page)}/
              {formatNumber(transactions.totalPages)}
            </span>
            <div className={styles.paginationActions}>
              <button
                type="button"
                disabled={transactions.page <= 1 || loading}
                onClick={() => fetchTransactions(Math.max(1, transactions.page - 1))}
              >
                Trước
              </button>
              <button
                type="button"
                disabled={transactions.page >= transactions.totalPages || loading}
                onClick={() =>
                  fetchTransactions(
                    Math.min(transactions.totalPages, transactions.page + 1),
                  )
                }
              >
                Sau
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
