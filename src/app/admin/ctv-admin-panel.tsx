"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminCtvRow, AdminPaginatedCtvs } from "@/lib/admin-types";
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
  const [unlockingId, setUnlockingId] = useState("");
  const [copiedCode, setCopiedCode] = useState("");

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

  async function unlockCtv(ctv: AdminCtvRow) {
    if (
      !window.confirm(
        "Mở khóa đăng nhập CTV này? CTV sẽ đăng nhập lại trang thống kê được.",
      )
    ) {
      return;
    }

    setUnlockingId(ctv.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin/ctvs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: ctv.id }),
      });
      const payload = (await response.json()) as CtvMutationResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error ?? "Không mở khóa được CTV.");
        return;
      }

      updateCtvRow(payload.data);
      setMessage("Đã mở khóa đăng nhập CTV.");
    } catch {
      setError("Không mở khóa được CTV.");
    } finally {
      setUnlockingId("");
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

            return (
              <article className={styles.ctvCard} key={ctv.id}>
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
                  <Link
                    className={styles.inlineActionButton}
                    href={`/admin/ctv/${ctv.id}/revenue`}
                  >
                    Doanh thu
                  </Link>
                  <button
                    className={styles.inlineActionButton}
                    type="button"
                    onClick={() => startEdit(ctv)}
                  >
                    Sửa
                  </button>
                  {locked ? (
                    <button
                      className={styles.inlineActionButton}
                      type="button"
                      disabled={unlockingId === ctv.id}
                      onClick={() => unlockCtv(ctv)}
                    >
                      {unlockingId === ctv.id
                        ? "Đang mở khóa..."
                        : "Mở khóa đăng nhập"}
                    </button>
                  ) : (
                    <button
                      className={styles.ctvDangerButton}
                      type="button"
                      disabled={lockingId === ctv.id}
                      onClick={() => lockCtv(ctv)}
                    >
                      {lockingId === ctv.id ? "Đang khóa..." : "Xóa"}
                    </button>
                  )}
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
    </section>
  );
}
