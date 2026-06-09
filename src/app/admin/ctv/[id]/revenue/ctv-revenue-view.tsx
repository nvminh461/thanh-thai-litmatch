"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminNavCounts } from "@/lib/admin-navigation";
import { adminSectionHref } from "@/lib/admin-navigation";
import type {
  AdminCtvRow,
  AdminCtvTransactionRow,
  AdminPaginatedCtvTransactions,
} from "@/lib/admin-types";
import AdminSidebar from "../../../admin-sidebar";
import styles from "../../../admin.module.css";

type CtvRevenueViewProps = {
  username: string;
  navCounts: AdminNavCounts;
  ctv: AdminCtvRow;
  initialTransactions: AdminPaginatedCtvTransactions;
};

type TransactionFilters = {
  type: AdminCtvTransactionRow["type"] | "all";
  status: AdminCtvTransactionRow["status"] | "all";
  litmatchId: string;
  updatedFrom: string;
  updatedTo: string;
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

export default function CtvRevenueView({
  username,
  navCounts,
  ctv,
  initialTransactions,
}: CtvRevenueViewProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [filters, setFilters] = useState<TransactionFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<TransactionFilters>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      const response = await fetch(
        `/api/admin/ctvs/${ctv.id}/transactions?${params.toString()}`,
      );
      const payload = (await response.json()) as CtvTransactionsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error ?? "Không tải được giao dịch CTV.");
        return;
      }

      setTransactions(payload.data);
    } catch {
      setError("Không tải được giao dịch CTV.");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    setAppliedFilters(filters);
    fetchTransactions(1, filters);
  }

  function clearFilters() {
    const empty = emptyFilters();
    setFilters(empty);
    setAppliedFilters(empty);
    fetchTransactions(1, empty);
  }

  return (
    <main className={styles.adminPage}>
      <AdminSidebar
        username={username}
        activeSection="ctv"
        counts={navCounts}
      />

      <div className={styles.adminContent}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Doanh thu CTV</p>
            <h1>{ctv.name}</h1>
            <p>
              Code ref: <strong>{ctv.code}</strong> · Link:{" "}
              <strong>{buildRefPath(ctv.code)}</strong> · Ghi chú nạp trực tiếp
              dùng code <strong>{ctv.code}</strong>
            </p>
          </div>
          <Link className={styles.secondaryButton} href={adminSectionHref("ctv")}>
            Quay lại quản lý CTV
          </Link>
        </header>

        <section className={styles.panel} aria-labelledby="ctv-revenue-summary">
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span>Doanh thu</span>
              <strong>
                {formatNumber(transactions.summary.totalCompletedRevenue)} đ
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Tổng giao dịch</span>
              <strong>
                {formatNumber(transactions.summary.transactionCount)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Đã nạp</span>
              <strong>
                {formatNumber(transactions.summary.completedCount)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Kim cương</span>
              <strong>
                {formatNumber(transactions.summary.diamondRewardAmount)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span>Sao</span>
              <strong>
                {formatNumber(transactions.summary.starRewardAmount)}
              </strong>
            </div>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="ctv-revenue-list">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="ctv-revenue-list">Danh sách giao dịch</h2>
              <p>Doanh thu tính theo số tiền khách đã thanh toán thành công.</p>
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
                        {formatNumber(row.rewardAmount)}
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
                        : "Không có giao dịch phù hợp."}
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
                onClick={() =>
                  fetchTransactions(Math.max(1, transactions.page - 1))
                }
              >
                Trước
              </button>
              <button
                type="button"
                disabled={
                  transactions.page >= transactions.totalPages || loading
                }
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
