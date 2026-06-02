"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminBankPaymentRow,
  AdminBankQrBlacklistRow,
  AdminBankQrBlacklistStatus,
  AdminCardPaymentRow,
  AdminDirectRechargeRow,
  AdminLifetimeQrExportResult,
  AdminLifetimeQrReport,
  AdminPaginatedPayments,
  AdminPaymentStatus,
  AdminRechargePreview,
  AdminRechargeResult,
  AdminRuntimeConfigForm,
} from "@/lib/admin-types";
import { buildLitmatchAvatarUrl } from "@/lib/litmatch-avatar";
import type { RewardType } from "@/lib/payment-config";
import styles from "./admin.module.css";

type AdminDashboardProps = {
  username: string;
  initialConfig: AdminRuntimeConfigForm;
  bankPayments: AdminPaginatedPayments<AdminBankPaymentRow>;
  cardPayments: AdminPaginatedPayments<AdminCardPaymentRow>;
  lifetimeQrReport: AdminLifetimeQrReport;
  directRecharges: AdminPaginatedPayments<AdminDirectRechargeRow>;
  bankQrBlacklist: AdminPaginatedPayments<AdminBankQrBlacklistRow>;
};

type ConfigFormState = Omit<
  AdminRuntimeConfigForm,
  | "bankBaseAmount"
  | "bankDiamond"
  | "bankStar"
  | "cardBaseAmount"
  | "cardDiamond"
  | "cardStar"
> & {
  bankBaseAmount: string;
  bankDiamond: string;
  bankStar: string;
  cardBaseAmount: string;
  cardDiamond: string;
  cardStar: string;
};

type SaveSettingsResponse = {
  success: boolean;
  data?: AdminRuntimeConfigForm;
  error?: string;
};

type AdminSection =
  | "bank"
  | "card"
  | "direct"
  | "blacklist"
  | "report"
  | "settings";
type StatusFilter = "all" | AdminPaymentStatus;
type BlacklistStatusFilter = "all" | AdminBankQrBlacklistStatus;
type PaymentKind = "bank" | "card";
type BankFilterState = {
  status: StatusFilter;
  litmatchId: string;
  transferContent: string;
  updatedFrom: string;
  updatedTo: string;
};
type CardFilterState = {
  status: StatusFilter;
  litmatchId: string;
  updatedFrom: string;
  updatedTo: string;
};
type BlacklistFilterState = {
  status: BlacklistStatusFilter;
  litmatchId: string;
};

type PaymentsResponse<TPayment> = {
  success: boolean;
  data?: AdminPaginatedPayments<TPayment>;
  error?: string;
};

type DeleteIncompletePaymentsResponse = {
  success: boolean;
  data?: {
    deletedCount: number;
  };
  error?: string;
};

type BankQrBlacklistResponse = {
  success: boolean;
  data?: AdminBankQrBlacklistRow;
  error?: string;
};

type LifetimeQrReportResponse = {
  success: boolean;
  data?: AdminLifetimeQrReport;
  error?: string;
};

type LifetimeQrExportResponse = {
  success: boolean;
  data?: AdminLifetimeQrExportResult;
  error?: string;
};

type RechargePreviewResponse = {
  success: boolean;
  data?: AdminRechargePreview;
  error?: string;
};

type RechargeResultResponse = {
  success: boolean;
  data?: AdminRechargeResult;
  error?: string;
};

type DirectRechargeFormState = {
  litmatchId: string;
  rewardType: RewardType;
  rewardAmount: string;
  note: string;
};

type ReportExportPreview = AdminLifetimeQrExportResult & {
  action: "export" | "cancel_export";
  paymentIds: string[];
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

function rewardLabel(rewardType: RewardType) {
  return rewardType === "diamond" ? "Kim cương" : "Sao";
}

function userInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "?";
}

function bankModeLabel(mode: AdminBankPaymentRow["bankMode"]) {
  return mode === "lifetime" ? "QR trọn đời" : "Cố định";
}

function statusLabel(status: AdminPaymentStatus) {
  if (status === "completed") {
    return "Đã nạp";
  }

  if (status === "recharge_failed") {
    return "Lỗi nạp";
  }

  if (status === "processing") {
    return "Đang xử lý";
  }

  return status === "paid" ? "Đã thanh toán" : "Chưa thanh toán";
}

function statusClassName(status: AdminPaymentStatus) {
  if (status === "completed") {
    return styles.statusCompleted;
  }

  if (status === "recharge_failed") {
    return styles.statusFailed;
  }

  if (status === "processing") {
    return styles.statusProcessing;
  }

  return status === "paid" ? styles.statusPaid : styles.statusIncomplete;
}

function transferAssetLabel(value: "diamonds" | "stars" | null) {
  if (value === "diamonds") {
    return "kim cương";
  }

  if (value === "stars") {
    return "sao";
  }

  return "";
}

function rechargeStatusLabel(value: AdminBankPaymentRow["rechargeStatus"]) {
  if (value === "completed") {
    return "đã nạp";
  }

  if (value === "failed") {
    return "lỗi";
  }

  if (value === "pending") {
    return "đang xử lý";
  }

  return "";
}

function sectionTitle(section: AdminSection) {
  if (section === "card") {
    return "Giao dịch nạp thẻ";
  }

  if (section === "direct") {
    return "Nạp trực tiếp";
  }

  if (section === "blacklist") {
    return "Danh sách đen QR";
  }

  if (section === "report") {
    return "Báo cáo thống kê";
  }

  if (section === "settings") {
    return "Cấu hình hệ thống";
  }

  return "Giao dịch chuyển khoản";
}

function toFormState(config: AdminRuntimeConfigForm): ConfigFormState {
  return {
    ...config,
    bankBaseAmount: String(config.bankBaseAmount),
    bankDiamond: String(config.bankDiamond),
    bankStar: String(config.bankStar),
    cardBaseAmount: String(config.cardBaseAmount),
    cardDiamond: String(config.cardDiamond),
    cardStar: String(config.cardStar),
  };
}

function hasActiveFilters(values: string[]) {
  return values.some((value) => value.trim());
}

function getEmptyBankFilters(): BankFilterState {
  return {
    status: "all",
    litmatchId: "",
    transferContent: "",
    updatedFrom: "",
    updatedTo: "",
  };
}

function getEmptyCardFilters(): CardFilterState {
  return {
    status: "all",
    litmatchId: "",
    updatedFrom: "",
    updatedTo: "",
  };
}

function getEmptyBlacklistFilters(): BlacklistFilterState {
  return {
    status: "all",
    litmatchId: "",
  };
}

function getEmptyDirectRechargeForm(): DirectRechargeFormState {
  return {
    litmatchId: "",
    rewardType: "diamond",
    rewardAmount: "",
    note: "",
  };
}

function paymentRangeLabel<TPayment>(data: AdminPaginatedPayments<TPayment>) {
  if (!data.total) {
    return "0";
  }

  const start = (data.page - 1) * data.pageSize + 1;
  const end = Math.min(data.page * data.pageSize, data.total);

  return `${formatNumber(start)}-${formatNumber(end)}`;
}

function Field({
  label,
  name,
  type = "text",
  value,
  placeholder,
  onChange,
  disabled = false,
}: {
  label: string;
  name: keyof ConfigFormState;
  type?: string;
  value: string;
  placeholder?: string;
  onChange: (name: keyof ConfigFormState, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(name, event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function CheckboxField({
  label,
  name,
  checked,
  onChange,
}: {
  label: string;
  name: keyof ConfigFormState;
  checked: boolean;
  onChange: (name: keyof ConfigFormState, value: boolean) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(name, event.target.checked)}
      />
    </label>
  );
}

function TextareaField({
  label,
  name,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  name: keyof ConfigFormState;
  value: string;
  placeholder?: string;
  onChange: (name: keyof ConfigFormState, value: string) => void;
}) {
  return (
    <label className={`${styles.field} ${styles.fullWidthField}`}>
      <span>{label}</span>
      <textarea
        name={name}
        value={value}
        placeholder={placeholder}
        rows={4}
        onChange={(event) => onChange(name, event.target.value)}
      />
    </label>
  );
}

function DateFilterField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterField}>
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function AdminDashboard({
  username,
  initialConfig,
  bankPayments,
  cardPayments,
  lifetimeQrReport,
  directRecharges,
  bankQrBlacklist,
}: AdminDashboardProps) {
  const [form, setForm] = useState<ConfigFormState>(() =>
    toFormState(initialConfig),
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("bank");
  const [bankPageData, setBankPageData] = useState(bankPayments);
  const [cardPageData, setCardPageData] = useState(cardPayments);
  const [reportData, setReportData] = useState(lifetimeQrReport);
  const [directPageData, setDirectPageData] = useState(directRecharges);
  const [blacklistPageData, setBlacklistPageData] = useState(bankQrBlacklist);
  const [bankPage, setBankPage] = useState(bankPayments.page);
  const [cardPage, setCardPage] = useState(cardPayments.page);
  const [directPage, setDirectPage] = useState(directRecharges.page);
  const [blacklistPage, setBlacklistPage] = useState(bankQrBlacklist.page);
  const [bankFilters, setBankFilters] =
    useState<BankFilterState>(getEmptyBankFilters);
  const [appliedBankFilters, setAppliedBankFilters] =
    useState<BankFilterState>(getEmptyBankFilters);
  const [cardFilters, setCardFilters] =
    useState<CardFilterState>(getEmptyCardFilters);
  const [appliedCardFilters, setAppliedCardFilters] =
    useState<CardFilterState>(getEmptyCardFilters);
  const [reportFilters, setReportFilters] =
    useState<BankFilterState>(getEmptyBankFilters);
  const [appliedReportFilters, setAppliedReportFilters] =
    useState<BankFilterState>(getEmptyBankFilters);
  const [blacklistFilters, setBlacklistFilters] =
    useState<BlacklistFilterState>(getEmptyBlacklistFilters);
  const [appliedBlacklistFilters, setAppliedBlacklistFilters] =
    useState<BlacklistFilterState>(getEmptyBlacklistFilters);
  const [bankError, setBankError] = useState("");
  const [cardError, setCardError] = useState("");
  const [reportError, setReportError] = useState("");
  const [blacklistError, setBlacklistError] = useState("");
  const [blacklistMessage, setBlacklistMessage] = useState("");
  const [blacklistUpdatingId, setBlacklistUpdatingId] = useState("");
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportPreview, setExportPreview] = useState<ReportExportPreview | null>(
    null,
  );
  const [bankDeleteMessage, setBankDeleteMessage] = useState("");
  const [bankDeleteError, setBankDeleteError] = useState("");
  const [bankDeleting, setBankDeleting] = useState(false);
  const [cardDeleteMessage, setCardDeleteMessage] = useState("");
  const [cardDeleteError, setCardDeleteError] = useState("");
  const [cardDeleting, setCardDeleting] = useState(false);
  const [rechargePreview, setRechargePreview] =
    useState<AdminRechargePreview | null>(null);
  const [rechargeSubmitting, setRechargeSubmitting] = useState(false);
  const [rechargeMessage, setRechargeMessage] = useState("");
  const [rechargeError, setRechargeError] = useState("");
  const [directForm, setDirectForm] = useState<DirectRechargeFormState>(
    getEmptyDirectRechargeForm,
  );
  const [directError, setDirectError] = useState("");
  const [directMessage, setDirectMessage] = useState("");
  const [directLoading, setDirectLoading] = useState(false);
  const hasBankFilters =
    appliedBankFilters.status !== "all" ||
    hasActiveFilters([
      appliedBankFilters.litmatchId,
      appliedBankFilters.transferContent,
      appliedBankFilters.updatedFrom,
      appliedBankFilters.updatedTo,
    ]);
  const hasCardFilters =
    appliedCardFilters.status !== "all" ||
    hasActiveFilters([
      appliedCardFilters.litmatchId,
      appliedCardFilters.updatedFrom,
      appliedCardFilters.updatedTo,
    ]);
  const hasReportFilters =
    appliedReportFilters.status !== "all" ||
    hasActiveFilters([
      appliedReportFilters.litmatchId,
      appliedReportFilters.transferContent,
      appliedReportFilters.updatedFrom,
      appliedReportFilters.updatedTo,
    ]);
  const hasBlacklistFilters =
    appliedBlacklistFilters.status !== "all" ||
    hasActiveFilters([appliedBlacklistFilters.litmatchId]);
  const canDeleteBankIncomplete =
    appliedBankFilters.status === "all" ||
    appliedBankFilters.status === "incomplete";
  const canDeleteCardIncomplete =
    appliedCardFilters.status === "all" ||
    appliedCardFilters.status === "incomplete";
  const exportableReportIds = reportData.rows
    .filter((row) => row.exportStatus !== "exported")
    .map((row) => row.id);
  const cancelableReportIds = reportData.rows
    .filter((row) => row.exportStatus === "exported")
    .map((row) => row.id);
  const selectableReportIds = reportData.rows.map((row) => row.id);
  const selectedExportableCount = selectedReportIds.filter((id) =>
    exportableReportIds.includes(id),
  ).length;
  const selectedCancelableCount = selectedReportIds.filter((id) =>
    cancelableReportIds.includes(id),
  ).length;
  const rechargeAvatarUrl = buildLitmatchAvatarUrl(
    rechargePreview?.verifiedUser.avatar,
  );
  const allReportRowsSelected =
    selectableReportIds.length > 0 &&
    selectableReportIds.every((id) => selectedReportIds.includes(id));

  function setPaymentPageData<TPayment>(
    type: PaymentKind,
    data: AdminPaginatedPayments<TPayment>,
  ) {
    if (type === "bank") {
      setBankPageData(data as AdminPaginatedPayments<AdminBankPaymentRow>);
      setBankPage(data.page);
    } else {
      setCardPageData(data as AdminPaginatedPayments<AdminCardPaymentRow>);
      setCardPage(data.page);
    }
  }

  async function fetchPaymentPage<TPayment>({
    type,
    page,
    status,
    litmatchId,
    transferContent,
    updatedFrom,
    updatedTo,
    signal,
  }: {
    type: PaymentKind;
    page: number;
    status: StatusFilter;
    litmatchId: string;
    transferContent?: string;
    updatedFrom: string;
    updatedTo: string;
    signal?: AbortSignal;
  }) {
    const params = new URLSearchParams({
      type,
      page: String(page),
      status,
      litmatchId: litmatchId.replace(/\D/g, ""),
      updatedFrom,
      updatedTo,
    });

    if (transferContent) {
      params.set("transferContent", transferContent.trim().toUpperCase());
    }

    const response = await fetch(
      `/api/admin/payments?${params.toString()}`,
      signal ? { signal } : undefined,
    );
    const payload = (await response.json()) as PaymentsResponse<TPayment>;

    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Không tải được giao dịch.");
    }

    return payload.data;
  }

  async function reloadBankPayments(page = bankPage) {
    const data = await fetchPaymentPage<AdminBankPaymentRow>({
      type: "bank",
      page,
      status: appliedBankFilters.status,
      litmatchId: appliedBankFilters.litmatchId,
      transferContent: appliedBankFilters.transferContent,
      updatedFrom: appliedBankFilters.updatedFrom,
      updatedTo: appliedBankFilters.updatedTo,
    });

    setBankError("");
    setPaymentPageData("bank", data);
  }

  async function reloadCardPayments(page = cardPage) {
    const data = await fetchPaymentPage<AdminCardPaymentRow>({
      type: "card",
      page,
      status: appliedCardFilters.status,
      litmatchId: appliedCardFilters.litmatchId,
      updatedFrom: appliedCardFilters.updatedFrom,
      updatedTo: appliedCardFilters.updatedTo,
    });

    setCardError("");
    setPaymentPageData("card", data);
  }

  async function fetchDirectRecharges(page: number, signal?: AbortSignal) {
    const response = await fetch(
      `/api/admin/direct-recharges?page=${page}`,
      signal ? { signal } : undefined,
    );
    const payload =
      (await response.json()) as PaymentsResponse<AdminDirectRechargeRow>;

    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Không tải được lịch sử nạp trực tiếp.");
    }

    return payload.data;
  }

  async function reloadDirectRecharges(page = directPage) {
    const data = await fetchDirectRecharges(page);

    setDirectError("");
    setDirectPageData(data);
    setDirectPage(data.page);
  }

  const fetchBankQrBlacklist = useCallback(async (page: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      page: String(page),
      status: appliedBlacklistFilters.status,
      litmatchId: appliedBlacklistFilters.litmatchId.replace(/\D/g, ""),
    });
    const response = await fetch(
      `/api/admin/bank-qr-blacklist?${params.toString()}`,
      signal ? { signal } : undefined,
    );
    const payload =
      (await response.json()) as PaymentsResponse<AdminBankQrBlacklistRow>;

    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Không tải được danh sách đen QR.");
    }

    return payload.data;
  }, [
    appliedBlacklistFilters,
  ]);

  const fetchLifetimeQrReport = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({
      status: appliedReportFilters.status,
      litmatchId: appliedReportFilters.litmatchId.replace(/\D/g, ""),
      transferContent: appliedReportFilters.transferContent.trim().toUpperCase(),
      updatedFrom: appliedReportFilters.updatedFrom,
      updatedTo: appliedReportFilters.updatedTo,
    });
    const response = await fetch(
      `/api/admin/lifetime-qr-report?${params.toString()}`,
      signal ? { signal } : undefined,
    );
    const payload = (await response.json()) as LifetimeQrReportResponse;

    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Không tải được báo cáo.");
    }

    return payload.data;
  }, [
    appliedReportFilters,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    fetchPaymentPage<AdminBankPaymentRow>({
      type: "bank",
      page: bankPage,
      status: appliedBankFilters.status,
      litmatchId: appliedBankFilters.litmatchId,
      transferContent: appliedBankFilters.transferContent,
      updatedFrom: appliedBankFilters.updatedFrom,
      updatedTo: appliedBankFilters.updatedTo,
      signal: controller.signal,
    })
      .then((data) => {
        setBankError("");
        setPaymentPageData("bank", data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setBankError(
          error instanceof Error ? error.message : "Không tải được giao dịch.",
        );
      });

    return () => controller.abort();
  }, [
    appliedBankFilters,
    bankPage,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    fetchPaymentPage<AdminCardPaymentRow>({
      type: "card",
      page: cardPage,
      status: appliedCardFilters.status,
      litmatchId: appliedCardFilters.litmatchId,
      updatedFrom: appliedCardFilters.updatedFrom,
      updatedTo: appliedCardFilters.updatedTo,
      signal: controller.signal,
    })
      .then((data) => {
        setCardError("");
        setPaymentPageData("card", data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setCardError(
          error instanceof Error ? error.message : "Không tải được giao dịch.",
        );
      });

    return () => controller.abort();
  }, [
    appliedCardFilters,
    cardPage,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    fetchDirectRecharges(directPage, controller.signal)
      .then((data) => {
        setDirectError("");
        setDirectPageData(data);
        setDirectPage(data.page);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setDirectError(
          error instanceof Error
            ? error.message
            : "Không tải được lịch sử nạp trực tiếp.",
        );
      });

    return () => controller.abort();
  }, [
    directPage,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    fetchBankQrBlacklist(blacklistPage, controller.signal)
      .then((data) => {
        setBlacklistError("");
        setBlacklistPageData(data);
        setBlacklistPage(data.page);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setBlacklistError(
          error instanceof Error
            ? error.message
            : "Không tải được danh sách đen QR.",
        );
      });

    return () => controller.abort();
  }, [
    appliedBlacklistFilters,
    blacklistPage,
    fetchBankQrBlacklist,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    fetchLifetimeQrReport(controller.signal)
      .then((data) => {
        setReportError("");
        setReportData(data);
        setSelectedReportIds((current) => {
          const availableIds = new Set(
            data.rows.map((row) => row.id),
          );

          return current.filter((id) => availableIds.has(id));
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setReportError(
          error instanceof Error ? error.message : "Không tải được báo cáo.",
        );
      });

    return () => controller.abort();
  }, [
    fetchLifetimeQrReport,
  ]);

  function updateField(name: keyof ConfigFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
    setSaveMessage("");
    setSaveError("");
  }

  function applyBankFilters() {
    setAppliedBankFilters(bankFilters);
    setBankPage(1);
  }

  function clearBankFilters() {
    const emptyFilters = getEmptyBankFilters();

    setBankFilters(emptyFilters);
    setAppliedBankFilters(emptyFilters);
    setBankPage(1);
  }

  function applyCardFilters() {
    setAppliedCardFilters(cardFilters);
    setCardPage(1);
  }

  function clearCardFilters() {
    const emptyFilters = getEmptyCardFilters();

    setCardFilters(emptyFilters);
    setAppliedCardFilters(emptyFilters);
    setCardPage(1);
  }

  function applyReportFilters() {
    setAppliedReportFilters(reportFilters);
  }

  function clearReportFilters() {
    const emptyFilters = getEmptyBankFilters();

    setReportFilters(emptyFilters);
    setAppliedReportFilters(emptyFilters);
  }

  function applyBlacklistFilters() {
    setAppliedBlacklistFilters(blacklistFilters);
    setBlacklistPage(1);
  }

  function clearBlacklistFilters() {
    const emptyFilters = getEmptyBlacklistFilters();

    setBlacklistFilters(emptyFilters);
    setAppliedBlacklistFilters(emptyFilters);
    setBlacklistPage(1);
  }

  function toggleReportRow(id: string, checked: boolean) {
    setSelectedReportIds((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((selectedId) => selectedId !== id),
    );
  }

  function toggleAllReportRows(checked: boolean) {
    setSelectedReportIds(checked ? selectableReportIds : []);
  }

  function previewReportAction(action: ReportExportPreview["action"]) {
    if (!selectedReportIds.length) {
      setReportError("Vui lòng chọn giao dịch cần xử lý.");
      return;
    }

    const selectedIdSet = new Set(selectedReportIds);
    const selectedRows = reportData.rows.filter(
      (row) => {
        if (!selectedIdSet.has(row.id)) {
          return false;
        }

        return action === "export"
          ? row.exportStatus !== "exported"
          : row.exportStatus === "exported";
      },
    );

    if (!selectedRows.length) {
      setReportError(
        action === "export"
          ? "Không có giao dịch chưa xuất trong danh sách đã chọn."
          : "Không có giao dịch đã xuất trong danh sách đã chọn.",
      );
      return;
    }

    const preview = selectedRows.reduce(
      (current, row) => ({
        ...current,
        exportedCount: current.exportedCount + 1,
        totalAmount: current.totalAmount + row.amount,
        diamondRewardAmount:
          current.diamondRewardAmount +
          (row.rewardType === "diamond" ? row.rewardAmount : 0),
        starRewardAmount:
          current.starRewardAmount +
          (row.rewardType === "star" ? row.rewardAmount : 0),
      }),
      {
        action,
        paymentIds: selectedRows.map((row) => row.id),
        exportedCount: 0,
        totalAmount: 0,
        diamondRewardAmount: 0,
        starRewardAmount: 0,
      },
    );

    setReportError("");
    setExportPreview(preview);
  }

  async function confirmExportReport() {
    if (!exportPreview) {
      return;
    }

    setExportingReport(true);
    setReportError("");

    try {
      const response = await fetch("/api/admin/lifetime-qr-report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: exportPreview.action,
          paymentIds: exportPreview.paymentIds,
        }),
      });
      const payload = (await response.json()) as LifetimeQrExportResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(
          payload.error ??
            (exportPreview.action === "cancel_export"
              ? "Không hủy xuất được báo cáo."
              : "Không xuất được báo cáo."),
        );
      }

      setExportPreview(null);
      setSelectedReportIds([]);
      setReportData(await fetchLifetimeQrReport());
    } catch (error) {
      setReportError(
        error instanceof Error
          ? error.message
          : exportPreview.action === "cancel_export"
            ? "Không hủy xuất được báo cáo."
            : "Không xuất được báo cáo.",
      );
    } finally {
      setExportingReport(false);
    }
  }

  async function handleSaveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage("");
    setSaveError("");

    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          bankBaseAmount: Number(form.bankBaseAmount),
          bankDiamond: Number(form.bankDiamond),
          bankStar: Number(form.bankStar),
          cardBaseAmount: Number(form.cardBaseAmount),
          cardDiamond: Number(form.cardDiamond),
          cardStar: Number(form.cardStar),
        }),
      });
      const payload = (await response.json()) as SaveSettingsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setSaveError(payload.error ?? "Không lưu được cấu hình.");
        return;
      }

      setForm(toFormState(payload.data));
      setSaveMessage("Đã lưu cấu hình.");
    } catch {
      setSaveError("Không lưu được cấu hình.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteIncompletePayments(type: PaymentKind) {
    const isBank = type === "bank";
    const label = isBank ? "chuyển khoản" : "nạp thẻ";
    const canDelete = isBank
      ? canDeleteBankIncomplete
      : canDeleteCardIncomplete;

    if (!canDelete) {
      const message =
        "Chỉ có thể xóa khi bộ lọc trạng thái là Tất cả hoặc Chưa thanh toán.";

      if (isBank) {
        setBankDeleteError(message);
      } else {
        setCardDeleteError(message);
      }

      return;
    }

    const confirmed = window.confirm(
      `Xóa các giao dịch ${label} chưa thanh toán đang khớp bộ lọc hiện tại? Thao tác này không thể hoàn tác.`,
    );

    if (!confirmed) {
      return;
    }

    if (isBank) {
      setBankDeleting(true);
      setBankDeleteMessage("");
      setBankDeleteError("");
    } else {
      setCardDeleting(true);
      setCardDeleteMessage("");
      setCardDeleteError("");
    }

    try {
      const response = await fetch("/api/admin/payments", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type,
          confirm: "delete_incomplete",
          filters: isBank
            ? {
                status: appliedBankFilters.status,
                litmatchId: appliedBankFilters.litmatchId,
                transferContent: appliedBankFilters.transferContent,
                updatedFrom: appliedBankFilters.updatedFrom,
                updatedTo: appliedBankFilters.updatedTo,
              }
            : {
                status: appliedCardFilters.status,
                litmatchId: appliedCardFilters.litmatchId,
                updatedFrom: appliedCardFilters.updatedFrom,
                updatedTo: appliedCardFilters.updatedTo,
              },
        }),
      });
      const payload =
        (await response.json()) as DeleteIncompletePaymentsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "Không xóa được giao dịch.");
      }

      if (isBank) {
        setBankDeleteMessage(
          `Đã xóa ${formatNumber(
            payload.data.deletedCount,
          )} giao dịch chuyển khoản chưa thanh toán.`,
        );
        setBankPage(1);
        await reloadBankPayments(1);
      } else {
        setCardDeleteMessage(
          `Đã xóa ${formatNumber(
            payload.data.deletedCount,
          )} giao dịch nạp thẻ chưa thanh toán.`,
        );
        setCardPage(1);
        await reloadCardPayments(1);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không xóa được giao dịch.";

      if (isBank) {
        setBankDeleteError(message);
      } else {
        setCardDeleteError(message);
      }
    } finally {
      if (isBank) {
        setBankDeleting(false);
      } else {
        setCardDeleting(false);
      }
    }
  }

  async function handleUnblockBankQrBlacklist(id: string) {
    setBlacklistUpdatingId(id);
    setBlacklistError("");
    setBlacklistMessage("");

    try {
      const response = await fetch("/api/admin/bank-qr-blacklist/unblock", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as BankQrBlacklistResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "Không mở khóa được ID Litmatch.");
      }

      setBlacklistPageData((current) => ({
        ...current,
        rows: current.rows.map((row) =>
          row.id === id ? payload.data as AdminBankQrBlacklistRow : row,
        ),
      }));
      setBlacklistMessage(`Đã mở khóa ID ${payload.data.litmatchId}.`);
    } catch (error) {
      setBlacklistError(
        error instanceof Error
          ? error.message
          : "Không mở khóa được ID Litmatch.",
      );
    } finally {
      setBlacklistUpdatingId("");
    }
  }

  async function previewFailedRecharge(type: PaymentKind, paymentId: string) {
    setRechargeSubmitting(true);
    setRechargeMessage("");
    setRechargeError("");

    try {
      const response = await fetch("/api/admin/recharges/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ type, paymentId }),
      });
      const payload = (await response.json()) as RechargePreviewResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "Không xác minh được giao dịch.");
      }

      setRechargePreview(payload.data);
    } catch (error) {
      setRechargeError(
        error instanceof Error ? error.message : "Không xác minh được giao dịch.",
      );
    } finally {
      setRechargeSubmitting(false);
    }
  }

  async function previewDirectRecharge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDirectLoading(true);
    setDirectError("");
    setDirectMessage("");
    setRechargeError("");
    setRechargeMessage("");

    try {
      const response = await fetch("/api/admin/direct-recharges/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          litmatchId: directForm.litmatchId,
          rewardType: directForm.rewardType,
          rewardAmount: Number(directForm.rewardAmount),
          note: directForm.note,
        }),
      });
      const payload = (await response.json()) as RechargePreviewResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "Không xác minh được ID Litmatch.");
      }

      setRechargePreview(payload.data);
    } catch (error) {
      setDirectError(
        error instanceof Error ? error.message : "Không xác minh được ID Litmatch.",
      );
    } finally {
      setDirectLoading(false);
    }
  }

  function markPaymentRechargeCompleted(type: PaymentKind, paymentId: string) {
    const completedAt = new Date().toISOString();

    if (type === "bank") {
      setBankPageData((current) => ({
        ...current,
        rows: current.rows.map((payment) =>
          payment.id === paymentId
            ? {
                ...payment,
                status: "completed",
                rechargeStatus: "completed",
                rechargeError: null,
                rechargeCompletedAt: completedAt,
                updatedAt: completedAt,
                canRetryRecharge: false,
              }
            : payment,
        ),
      }));
      return;
    }

    setCardPageData((current) => ({
      ...current,
      rows: current.rows.map((payment) =>
        payment.id === paymentId
          ? {
              ...payment,
              status: "completed",
              rechargeStatus: "completed",
              rechargeError: null,
              rechargeCompletedAt: completedAt,
              updatedAt: completedAt,
              canRetryRecharge: false,
            }
          : payment,
      ),
    }));
  }

  async function confirmRecharge() {
    if (!rechargePreview) {
      return;
    }

    setRechargeSubmitting(true);
    setRechargeError("");
    setRechargeMessage("");

    try {
      const isDirect = rechargePreview.paymentType === "direct";
      const retryPaymentType: PaymentKind | null = isDirect
        ? null
        : rechargePreview.paymentType === "bank"
          ? "bank"
          : "card";
      const response = await fetch(
        isDirect ? "/api/admin/direct-recharges" : "/api/admin/recharges/retry",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(
            isDirect
              ? {
                  litmatchId: rechargePreview.litmatchId,
                  rewardType: rechargePreview.rewardType,
                  rewardAmount: rechargePreview.rewardAmount,
                  note: rechargePreview.note,
                }
              : {
                  type: rechargePreview.paymentType,
                  paymentId: rechargePreview.paymentId,
                },
          ),
        },
      );
      const payload = (await response.json()) as RechargeResultResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "Không thực hiện được lệnh nạp.");
      }

      if (payload.data.status === "completed") {
        setRechargeMessage(payload.data.message);
      } else {
        setRechargeError(payload.data.message);
      }

      setRechargePreview(null);

      if (isDirect) {
        if (payload.data.status === "completed") {
          setDirectMessage(payload.data.message);
        } else {
          setDirectError(payload.data.message);
        }

        setDirectForm(getEmptyDirectRechargeForm());
        await reloadDirectRecharges(1);
      } else if (
        retryPaymentType &&
        rechargePreview.paymentId &&
        payload.data.status === "completed"
      ) {
        markPaymentRechargeCompleted(retryPaymentType, rechargePreview.paymentId);
      }

      if (isDirect) {
        return;
      }

      if (rechargePreview.paymentType === "bank") {
        await reloadBankPayments();
      } else {
        await reloadCardPayments();
      }
    } catch (error) {
      setRechargeError(
        error instanceof Error ? error.message : "Không thực hiện được lệnh nạp.",
      );
    } finally {
      setRechargeSubmitting(false);
    }
  }

  return (
    <main className={styles.adminPage}>
      <aside className={styles.sidebar} aria-label="Điều hướng quản trị">
        <div className={styles.sidebarBrand}>
          <p className={styles.kicker}>Quản trị Thành Thái</p>
          <strong>Admin</strong>
          <span>{username}</span>
        </div>

        <nav className={styles.sidebarNav}>
          <button
            className={`${styles.sidebarButton} ${
              activeSection === "bank" ? styles.sidebarButtonActive : ""
            }`}
            type="button"
            onClick={() => setActiveSection("bank")}
          >
            <span>Giao dịch chuyển khoản</span>
            <small>{formatNumber(bankPageData.total)}</small>
          </button>
          <button
            className={`${styles.sidebarButton} ${
              activeSection === "card" ? styles.sidebarButtonActive : ""
            }`}
            type="button"
            onClick={() => setActiveSection("card")}
          >
            <span>Giao dịch nạp thẻ</span>
            <small>{formatNumber(cardPageData.total)}</small>
          </button>
          <button
            className={`${styles.sidebarButton} ${
              activeSection === "direct" ? styles.sidebarButtonActive : ""
            }`}
            type="button"
            onClick={() => setActiveSection("direct")}
          >
            <span>Nạp trực tiếp</span>
            <small>{formatNumber(directPageData.total)}</small>
          </button>
          <button
            className={`${styles.sidebarButton} ${
              activeSection === "blacklist" ? styles.sidebarButtonActive : ""
            }`}
            type="button"
            onClick={() => setActiveSection("blacklist")}
          >
            <span>Danh sách đen QR</span>
            <small>{formatNumber(blacklistPageData.total)}</small>
          </button>
          <button
            className={`${styles.sidebarButton} ${
              activeSection === "report" ? styles.sidebarButtonActive : ""
            }`}
            type="button"
            onClick={() => setActiveSection("report")}
          >
            <span>Báo cáo thống kê</span>
            <small>{formatNumber(reportData.summary.paymentCount)}</small>
          </button>
          <button
            className={`${styles.sidebarButton} ${
              activeSection === "settings" ? styles.sidebarButtonActive : ""
            }`}
            type="button"
            onClick={() => setActiveSection("settings")}
          >
            <span>Cấu hình hệ thống</span>
          </button>
        </nav>

        <form action="/api/admin/logout" method="post">
          <button className={styles.secondaryButton} type="submit">
            Đăng xuất
          </button>
        </form>
      </aside>

      <div className={styles.adminContent}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Bảng điều khiển</p>
            <h1>{sectionTitle(activeSection)}</h1>
            <p>Quản lý cấu hình và theo dõi giao dịch mới nhất.</p>
          </div>
        </header>

        {rechargeError ? (
          <p className={styles.errorText} role="alert">
            {rechargeError}
          </p>
        ) : null}
        {rechargeMessage ? (
          <p className={styles.successText} role="status">
            {rechargeMessage}
          </p>
        ) : null}

        {activeSection === "settings" ? (
          <section className={styles.panel} aria-labelledby="settings-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="settings-title">Cấu hình hệ thống</h2>
                <p>
                  VietQR và tỉ giá lưu trong DB. TOTP, Litmatch agent,
                DATABASE_URL, SEPAY_WEBHOOK_API_KEY, PAY1S_* và
                  ADMIN_SESSION_SECRET giữ trong env.
                </p>
              </div>
            </div>

            <form className={styles.settingsForm} onSubmit={handleSaveConfig}>
              <div className={styles.formSection}>
                <h3>Website & liên hệ</h3>
                <div className={styles.formGrid}>
                  <Field
                    label="Tên đại lý"
                    name="dealerName"
                    value={form.dealerName}
                    onChange={updateField}
                  />
                  <Field
                    label="Số Zalo"
                    name="zaloPhone"
                    value={form.zaloPhone}
                    placeholder="Ví dụ: 0367430001"
                    onChange={updateField}
                  />
                  <Field
                    label="URL Facebook"
                    name="facebookUrl"
                    value={form.facebookUrl}
                    placeholder="https://facebook.com/..."
                    onChange={updateField}
                  />
                  <Field
                    label="Số điện thoại"
                    name="phoneNumber"
                    value={form.phoneNumber}
                    placeholder="Ví dụ: 0367430001"
                    onChange={updateField}
                  />
                </div>
              </div>

              <div className={styles.formSection}>
                <h3>Thông báo website</h3>
                <div className={styles.formGrid}>
                  <CheckboxField
                    label="Bật thông báo đầu trang"
                    name="announcementEnabled"
                    checked={form.announcementEnabled}
                    onChange={updateField}
                  />
                  <TextareaField
                    label="Nội dung thông báo"
                    name="announcementText"
                    value={form.announcementText}
                    placeholder={"Nhập thông báo hiển thị trên website\nEnter để xuống dòng"}
                    onChange={updateField}
                  />
                </div>
              </div>

              <div className={styles.formSection}>
                <h3>VietQR</h3>
                <div className={styles.formGrid}>
                  <Field
                    label="Mã ngân hàng"
                    name="bankId"
                    value={form.bankId}
                    onChange={updateField}
                  />
                  <Field
                    label="Tên ngân hàng"
                    name="bankName"
                    value={form.bankName}
                    onChange={updateField}
                  />
                  <Field
                    label="Số tài khoản"
                    name="accountNo"
                    value={form.accountNo}
                    onChange={updateField}
                  />
                  <Field
                    label="Chủ tài khoản"
                    name="accountName"
                    value={form.accountName}
                    onChange={updateField}
                  />
                  <Field
                    label="Prefix mã thanh toán"
                    name="paymentCodePrefix"
                    value={form.paymentCodePrefix}
                    onChange={updateField}
                  />
                  <Field
                    label="Template QR"
                    name="template"
                    value={form.template}
                    onChange={updateField}
                    disabled={true}
                  />
                </div>
              </div>

              <div className={styles.formSection}>
                <h3>Tỷ lệ chuyển khoản</h3>
                <div className={styles.formGrid}>
                  <Field
                    label="Mốc tiền"
                    name="bankBaseAmount"
                    type="number"
                    value={form.bankBaseAmount}
                    onChange={updateField}
                  />
                  <Field
                    label="Kim cương mỗi mốc"
                    name="bankDiamond"
                    type="number"
                    value={form.bankDiamond}
                    onChange={updateField}
                  />
                  <Field
                    label="Sao mỗi mốc"
                    name="bankStar"
                    type="number"
                    value={form.bankStar}
                    onChange={updateField}
                  />
                </div>
              </div>

              <div className={styles.formSection}>
                <h3>Tỷ lệ nạp thẻ</h3>
                <div className={styles.formGrid}>
                  <Field
                    label="Mốc tiền"
                    name="cardBaseAmount"
                    type="number"
                    value={form.cardBaseAmount}
                    onChange={updateField}
                  />
                  <Field
                    label="Kim cương mỗi mốc"
                    name="cardDiamond"
                    type="number"
                    value={form.cardDiamond}
                    onChange={updateField}
                  />
                  <Field
                    label="Sao mỗi mốc"
                    name="cardStar"
                    type="number"
                    value={form.cardStar}
                    onChange={updateField}
                  />
                </div>
              </div>

              <div className={styles.formActions}>
                {saveError ? (
                  <p className={styles.errorText} role="alert">
                    {saveError}
                  </p>
                ) : null}
                {saveMessage ? (
                  <p className={styles.successText} role="status">
                    {saveMessage}
                  </p>
                ) : null}
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Đang lưu..." : "Lưu cấu hình"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {activeSection === "bank" ? (
          <section
            className={styles.panel}
            aria-labelledby="bank-payments-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <h2 id="bank-payments-title">Giao dịch chuyển khoản</h2>
                <p>
                  Đang hiển thị {paymentRangeLabel(bankPageData)}/
                  {formatNumber(bankPageData.total)} bản ghi, 20 giao dịch mỗi
                  trang.
                </p>
              </div>
            </div>

            <div className={styles.filters} aria-label="Bộ lọc chuyển khoản">
              <label className={styles.filterField}>
                <span>Trạng thái</span>
                <select
                  value={bankFilters.status}
                  onChange={(event) => {
                    setBankFilters((current) => ({
                      ...current,
                      status: event.target.value as StatusFilter,
                    }));
                  }}
                >
                  <option value="all">Tất cả</option>
                  <option value="incomplete">Chưa thanh toán</option>
                  <option value="processing">Đang xử lý</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="completed">Đã nạp</option>
                  <option value="recharge_failed">Lỗi nạp</option>
                </select>
              </label>
              <label className={styles.filterField}>
                <span>ID Litmatch</span>
                <input
                  inputMode="numeric"
                  value={bankFilters.litmatchId}
                  placeholder="Nhập ID Litmatch"
                  onChange={(event) => {
                    setBankFilters((current) => ({
                      ...current,
                      litmatchId: event.target.value,
                    }));
                  }}
                />
              </label>
              <label className={styles.filterField}>
                <span>Nội dung chuyển khoản</span>
                <input
                  value={bankFilters.transferContent}
                  placeholder="Tên CTV hoặc nội dung CK"
                  onChange={(event) => {
                    setBankFilters((current) => ({
                      ...current,
                      transferContent: event.target.value,
                    }));
                  }}
                />
              </label>
              <DateFilterField
                label="Cập nhật từ ngày"
                value={bankFilters.updatedFrom}
                onChange={(value) => {
                  setBankFilters((current) => ({
                    ...current,
                    updatedFrom: value,
                  }));
                }}
              />
              <DateFilterField
                label="Cập nhật đến ngày"
                value={bankFilters.updatedTo}
                onChange={(value) => {
                  setBankFilters((current) => ({
                    ...current,
                    updatedTo: value,
                  }));
                }}
              />
              <button
                className={styles.applyFilterButton}
                type="button"
                onClick={applyBankFilters}
              >
                Áp dụng
              </button>
              <button
                className={styles.clearFilterButton}
                type="button"
                onClick={clearBankFilters}
              >
                Xóa lọc
              </button>
            </div>

            <div className={styles.dangerZone}>
              <div>
                <strong>Xóa giao dịch chưa thanh toán</strong>
                <p>
                  Xóa các giao dịch chuyển khoản trạng thái Chưa thanh toán đang
                  khớp ID Litmatch, nội dung chuyển khoản và khoảng ngày cập
                  nhật.
                </p>
              </div>
              <button
                className={styles.dangerButton}
                type="button"
                disabled={bankDeleting || !canDeleteBankIncomplete}
                onClick={() => handleDeleteIncompletePayments("bank")}
              >
                {bankDeleting ? "Đang xóa..." : "Xóa giao dịch chưa thanh toán"}
              </button>
            </div>

            {bankDeleteError ? (
              <p className={styles.errorText} role="alert">
                {bankDeleteError}
              </p>
            ) : null}
            {bankDeleteMessage ? (
              <p className={styles.successText} role="status">
                {bankDeleteMessage}
              </p>
            ) : null}

            {bankError ? (
              <p className={styles.errorText} role="alert">
                {bankError}
              </p>
            ) : null}

            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>Loại CK</th>
                    <th>ID Litmatch</th>
                    <th>Loại nhận</th>
                    <th>Số tiền</th>
                    <th>Thực nhận</th>
                    <th>Nạp Litmatch</th>
                    <th>Lỗi nạp</th>
                    <th>Thao tác</th>
                    <th>Nội dung CK</th>
                    <th>SePay</th>
                    <th>Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {bankPageData.rows.length ? (
                    bankPageData.rows.map((payment) => (
                      <tr key={payment.id}>
                        <td data-label="Trạng thái">
                          <span
                            className={`${styles.statusBadge} ${statusClassName(
                              payment.status,
                            )}`}
                          >
                            {statusLabel(payment.status)}
                          </span>
                        </td>
                        <td data-label="Loại CK">
                          {bankModeLabel(payment.bankMode)}
                        </td>
                        <td data-label="ID Litmatch">{payment.litmatchId}</td>
                        <td data-label="Loại nhận">
                          {rewardLabel(payment.rewardType)}
                        </td>
                        <td data-label="Số tiền">
                          {formatNumber(payment.amount)} đ
                        </td>
                        <td data-label="Thực nhận">
                          {formatNumber(payment.rewardAmount)}
                        </td>
                        <td data-label="Nạp Litmatch">
                          {payment.rechargeTransferType &&
                          payment.rechargeTransferNum ? (
                            <span>
                              {formatNumber(payment.rechargeTransferNum)}{" "}
                              {transferAssetLabel(payment.rechargeTransferType)}
                              {payment.rechargeStatus
                                ? ` (${rechargeStatusLabel(
                                    payment.rechargeStatus,
                                  )})`
                                : ""}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td data-label="Lỗi nạp" className={styles.errorCell}>
                          {payment.rechargeError ?? "-"}
                        </td>
                        <td data-label="Thao tác">
                          {payment.canRetryRecharge ? (
                            <button
                              className={styles.inlineActionButton}
                              type="button"
                              disabled={rechargeSubmitting}
                              onClick={() =>
                                previewFailedRecharge("bank", payment.id)
                              }
                            >
                              Nạp lại
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td
                          data-label="Nội dung CK"
                          className={styles.monoCell}
                        >
                          {payment.transferContent}
                        </td>
                        <td data-label="SePay">
                          {payment.sepayId
                            ? `${payment.sepayId} / ${formatNumber(
                                payment.sepayAmount ?? 0,
                              )} đ`
                            : "-"}
                        </td>
                        <td data-label="Cập nhật">
                          {formatDate(payment.updatedAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12} className={styles.emptyCell}>
                        {hasBankFilters
                          ? "Không có giao dịch chuyển khoản phù hợp bộ lọc."
                          : "Chưa có giao dịch chuyển khoản."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div
              className={styles.pagination}
              aria-label="Phân trang chuyển khoản"
            >
              <span>
                Trang {formatNumber(bankPageData.page)}/
                {formatNumber(bankPageData.totalPages)}
              </span>
              <div className={styles.paginationActions}>
                <button
                  type="button"
                  disabled={bankPageData.page <= 1}
                  onClick={() =>
                    setBankPage((current) => Math.max(1, current - 1))
                  }
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={bankPageData.page >= bankPageData.totalPages}
                  onClick={() =>
                    setBankPage((current) =>
                      Math.min(bankPageData.totalPages, current + 1),
                    )
                  }
                >
                  Sau
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "direct" ? (
          <section
            className={styles.panel}
            aria-labelledby="direct-recharge-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <h2 id="direct-recharge-title">Nạp trực tiếp</h2>
                <p>
                  Xác minh ID Litmatch, kiểm tra thông tin trong modal rồi mới
                  nạp kim cương hoặc sao.
                </p>
              </div>
            </div>

            <form
              className={styles.directRechargeForm}
              onSubmit={previewDirectRecharge}
            >
              <label className={styles.field}>
                <span>ID Litmatch</span>
                <input
                  inputMode="numeric"
                  value={directForm.litmatchId}
                  placeholder="Nhập ID Litmatch"
                  onChange={(event) =>
                    setDirectForm((current) => ({
                      ...current,
                      litmatchId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Loại nhận</span>
                <select
                  value={directForm.rewardType}
                  onChange={(event) =>
                    setDirectForm((current) => ({
                      ...current,
                      rewardType: event.target.value as RewardType,
                    }))
                  }
                >
                  <option value="diamond">Kim cương</option>
                  <option value="star">Sao</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Số lượng</span>
                <input
                  min="1"
                  type="number"
                  value={directForm.rewardAmount}
                  placeholder="Nhập số cần nạp"
                  onChange={(event) =>
                    setDirectForm((current) => ({
                      ...current,
                      rewardAmount: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={`${styles.field} ${styles.fullWidthField}`}>
                <span>Ghi chú</span>
                <input
                  value={directForm.note}
                  placeholder="Mã giao dịch ngoài hoặc lý do xử lý"
                  onChange={(event) =>
                    setDirectForm((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                />
              </label>
              <div className={styles.formActions}>
                {directError ? (
                  <p className={styles.errorText} role="alert">
                    {directError}
                  </p>
                ) : null}
                {directMessage ? (
                  <p className={styles.successText} role="status">
                    {directMessage}
                  </p>
                ) : null}
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={directLoading || rechargeSubmitting}
                >
                  {directLoading ? "Đang xác minh..." : "Kiểm tra và nạp"}
                </button>
              </div>
            </form>

            <div className={styles.panelHeader}>
              <div>
                <h2>Lịch sử nạp trực tiếp</h2>
                <p>
                  Đang hiển thị {paymentRangeLabel(directPageData)}/
                  {formatNumber(directPageData.total)} bản ghi.
                </p>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>ID Litmatch</th>
                    <th>Người dùng</th>
                    <th>Loại nhận</th>
                    <th>Số lượng</th>
                    <th>Admin</th>
                    <th>Ghi chú</th>
                    <th>Lỗi</th>
                    <th>Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {directPageData.rows.length ? (
                    directPageData.rows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Trạng thái">
                          <span
                            className={`${styles.statusBadge} ${
                              row.status === "completed"
                                ? styles.statusCompleted
                                : row.status === "failed"
                                  ? styles.statusFailed
                                  : styles.statusProcessing
                            }`}
                          >
                            {row.status === "completed"
                              ? "Đã nạp"
                              : row.status === "failed"
                                ? "Lỗi"
                                : "Đang xử lý"}
                          </span>
                        </td>
                        <td data-label="ID Litmatch">{row.litmatchId}</td>
                        <td data-label="Người dùng">
                          {row.verifiedUser?.nickname ?? "-"}
                        </td>
                        <td data-label="Loại nhận">
                          {rewardLabel(row.rewardType)}
                        </td>
                        <td data-label="Số lượng">
                          {formatNumber(row.rewardAmount)}
                        </td>
                        <td data-label="Admin">{row.adminUsername}</td>
                        <td data-label="Ghi chú">{row.note ?? "-"}</td>
                        <td data-label="Lỗi" className={styles.errorCell}>
                          {row.rechargeError ?? "-"}
                        </td>
                        <td data-label="Cập nhật">
                          {formatDate(row.updatedAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className={styles.emptyCell}>
                        Chưa có lịch sử nạp trực tiếp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div
              className={styles.pagination}
              aria-label="Phân trang nạp trực tiếp"
            >
              <span>
                Trang {formatNumber(directPageData.page)}/
                {formatNumber(directPageData.totalPages)}
              </span>
              <div className={styles.paginationActions}>
                <button
                  type="button"
                  disabled={directPageData.page <= 1}
                  onClick={() =>
                    setDirectPage((current) => Math.max(1, current - 1))
                  }
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={directPageData.page >= directPageData.totalPages}
                  onClick={() =>
                    setDirectPage((current) =>
                      Math.min(directPageData.totalPages, current + 1),
                    )
                  }
                >
                  Sau
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "blacklist" ? (
          <section
            className={styles.panel}
            aria-labelledby="bank-qr-blacklist-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <h2 id="bank-qr-blacklist-title">Danh sách đen QR</h2>
                <p>
                  Các ID bị chặn tạo QR chuyển khoản vì có 5 giao dịch chưa
                  thanh toán liên tiếp.
                </p>
              </div>
            </div>

            <div className={styles.filters} aria-label="Bộ lọc danh sách đen">
              <label className={styles.filterField}>
                <span>Trạng thái</span>
                <select
                  value={blacklistFilters.status}
                  onChange={(event) => {
                    setBlacklistFilters((current) => ({
                      ...current,
                      status: event.target.value as BlacklistStatusFilter,
                    }));
                  }}
                >
                  <option value="all">Tất cả</option>
                  <option value="active">Đang chặn</option>
                  <option value="unblocked">Đã mở</option>
                </select>
              </label>
              <label className={styles.filterField}>
                <span>ID Litmatch</span>
                <input
                  inputMode="numeric"
                  value={blacklistFilters.litmatchId}
                  placeholder="Nhập ID Litmatch"
                  onChange={(event) => {
                    setBlacklistFilters((current) => ({
                      ...current,
                      litmatchId: event.target.value,
                    }));
                  }}
                />
              </label>
              <button
                className={styles.applyFilterButton}
                type="button"
                onClick={applyBlacklistFilters}
              >
                Áp dụng
              </button>
              <button
                className={styles.clearFilterButton}
                type="button"
                onClick={clearBlacklistFilters}
              >
                Xóa lọc
              </button>
            </div>

            {blacklistError ? (
              <p className={styles.errorText} role="alert">
                {blacklistError}
              </p>
            ) : null}
            {blacklistMessage ? (
              <p className={styles.successText} role="status">
                {blacklistMessage}
              </p>
            ) : null}

            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>ID Litmatch</th>
                    <th>Lý do</th>
                    <th>Giao dịch gây khóa</th>
                    <th>Ngày khóa</th>
                    <th>Người mở</th>
                    <th>Ngày mở</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {blacklistPageData.rows.length ? (
                    blacklistPageData.rows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Trạng thái">
                          <span
                            className={`${styles.statusBadge} ${
                              row.status === "active"
                                ? styles.statusFailed
                                : styles.statusCompleted
                            }`}
                          >
                            {row.status === "active" ? "Đang chặn" : "Đã mở"}
                          </span>
                        </td>
                        <td data-label="ID Litmatch">{row.litmatchId}</td>
                        <td data-label="Lý do">{row.reason}</td>
                        <td data-label="Giao dịch gây khóa">
                          <span className={styles.wrapCell}>
                            {row.triggeredByPaymentIds.join(", ")}
                          </span>
                        </td>
                        <td data-label="Ngày khóa">
                          {formatDate(row.blockedAt)}
                        </td>
                        <td data-label="Người mở">
                          {row.unblockedBy ?? "-"}
                        </td>
                        <td data-label="Ngày mở">
                          {formatDate(row.unblockedAt)}
                        </td>
                        <td data-label="Thao tác">
                          {row.status === "active" ? (
                            <button
                              className={styles.inlineActionButton}
                              type="button"
                              disabled={blacklistUpdatingId === row.id}
                              onClick={() =>
                                handleUnblockBankQrBlacklist(row.id)
                              }
                            >
                              {blacklistUpdatingId === row.id
                                ? "Đang mở..."
                                : "Mở khóa"}
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className={styles.emptyCell}>
                        {hasBlacklistFilters
                          ? "Không có ID nào khớp bộ lọc."
                          : "Chưa có ID nào trong danh sách đen QR."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div
              className={styles.pagination}
              aria-label="Phân trang danh sách đen QR"
            >
              <span>
                Trang {formatNumber(blacklistPageData.page)}/
                {formatNumber(blacklistPageData.totalPages)}
              </span>
              <div className={styles.paginationActions}>
                <button
                  type="button"
                  disabled={blacklistPageData.page <= 1}
                  onClick={() =>
                    setBlacklistPage((current) => Math.max(1, current - 1))
                  }
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={
                    blacklistPageData.page >= blacklistPageData.totalPages
                  }
                  onClick={() =>
                    setBlacklistPage((current) =>
                      Math.min(blacklistPageData.totalPages, current + 1),
                    )
                  }
                >
                  Sau
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "report" ? (
          <section
            className={styles.panel}
            aria-labelledby="lifetime-qr-report-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <h2 id="lifetime-qr-report-title">
                  Báo cáo QR dùng trọn đời
                </h2>
                <p>
                  Thống kê các giao dịch chuyển khoản phát sinh từ mã QR trọn
                  đời để đối soát số tiền nạp và tính hoa hồng cộng tác viên.
                </p>
              </div>
            </div>

            <div className={styles.reportGuide}>
              <strong>Hướng dẫn</strong>
              <p>
                Chọn khoảng ngày bằng ô lịch, nhập ID Litmatch hoặc nội dung
                chuyển khoản để lọc. Tích các giao dịch cần tính hoa hồng rồi
                bấm Xuất để xem tổng. Chỉ khi xác nhận trong modal, hệ thống
                mới đánh dấu các dòng đó là Đã xuất để tránh tính lại. Khi tính
                hoa hồng, ưu tiên lọc trạng thái Đã nạp.
              </p>
            </div>

            <div className={styles.filters} aria-label="Bộ lọc báo cáo QR">
              <label className={styles.filterField}>
                <span>Trạng thái</span>
                <select
                  value={reportFilters.status}
                  onChange={(event) =>
                    setReportFilters((current) => ({
                      ...current,
                      status: event.target.value as StatusFilter,
                    }))
                  }
                >
                  <option value="all">Tất cả</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="completed">Đã nạp</option>
                  <option value="recharge_failed">Lỗi nạp</option>
                </select>
              </label>
              <label className={styles.filterField}>
                <span>ID Litmatch</span>
                <input
                  inputMode="numeric"
                  value={reportFilters.litmatchId}
                  placeholder="Nhập ID Litmatch"
                  onChange={(event) =>
                    setReportFilters((current) => ({
                      ...current,
                      litmatchId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.filterField}>
                <span>Nội dung QR</span>
                <input
                  value={reportFilters.transferContent}
                  placeholder="Tên CTV hoặc nội dung QR"
                  onChange={(event) =>
                    setReportFilters((current) => ({
                      ...current,
                      transferContent: event.target.value,
                    }))
                  }
                />
              </label>
              <DateFilterField
                label="Từ ngày"
                value={reportFilters.updatedFrom}
                onChange={(value) =>
                  setReportFilters((current) => ({
                    ...current,
                    updatedFrom: value,
                  }))
                }
              />
              <DateFilterField
                label="Đến ngày"
                value={reportFilters.updatedTo}
                onChange={(value) =>
                  setReportFilters((current) => ({
                    ...current,
                    updatedTo: value,
                  }))
                }
              />
              <button
                className={styles.applyFilterButton}
                type="button"
                onClick={applyReportFilters}
              >
                Áp dụng
              </button>
              <button
                className={styles.clearFilterButton}
                type="button"
                onClick={clearReportFilters}
              >
                Xóa lọc
              </button>
            </div>

            {reportError ? (
              <p className={styles.errorText} role="alert">
                {reportError}
              </p>
            ) : null}

            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span>Lượt nạp</span>
                <strong>
                  {formatNumber(reportData.summary.paymentCount)}
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Đã xuất</span>
                <strong>
                  {formatNumber(reportData.summary.exportedCount)}
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Tổng tiền</span>
                <strong>
                  {formatNumber(reportData.summary.totalAmount)} đ
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Tổng thực nhận</span>
                <strong>
                  {formatNumber(reportData.summary.totalRewardAmount)}
                </strong>
              </div>
            </div>

            <div className={styles.reportActions}>
              <span>
                Đã chọn {formatNumber(selectedReportIds.length)} giao dịch
              </span>
              <button
                className={styles.applyFilterButton}
                type="button"
                disabled={exportingReport || !selectedExportableCount}
                onClick={() => previewReportAction("export")}
              >
                Xuất
              </button>
              <button
                className={styles.clearFilterButton}
                type="button"
                disabled={exportingReport || !selectedCancelableCount}
                onClick={() => previewReportAction("cancel_export")}
              >
                Hủy xuất
              </button>
            </div>

            <div className={`${styles.tableWrap} ${styles.reportTableWrap}`}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>
                      <input
                        aria-label="Chọn tất cả giao dịch chưa xuất"
                        type="checkbox"
                        checked={allReportRowsSelected}
                        disabled={!selectableReportIds.length}
                        onChange={(event) =>
                          toggleAllReportRows(event.target.checked)
                        }
                      />
                    </th>
                    <th>ID Litmatch</th>
                    <th>Nội dung QR</th>
                    <th>Loại nhận</th>
                    <th>Số tiền</th>
                    <th>Thực nhận</th>
                    <th>Trạng thái</th>
                    <th>Xuất</th>
                    <th>Ngày nạp</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.rows.length ? (
                    reportData.rows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Chọn">
                          <input
                            aria-label={`Chọn giao dịch ${row.id}`}
                            type="checkbox"
                            checked={selectedReportIds.includes(row.id)}
                            onChange={(event) =>
                              toggleReportRow(row.id, event.target.checked)
                            }
                          />
                        </td>
                        <td data-label="ID Litmatch">{row.litmatchId}</td>
                        <td data-label="Nội dung QR" className={styles.monoCell}>
                          {row.transferContent}
                        </td>
                        <td data-label="Loại nhận">
                          {rewardLabel(row.rewardType)}
                        </td>
                        <td data-label="Số tiền">
                          {formatNumber(row.amount)} đ
                        </td>
                        <td data-label="Thực nhận">
                          {formatNumber(row.rewardAmount)}
                        </td>
                        <td data-label="Trạng thái">
                          <span
                            className={`${styles.statusBadge} ${statusClassName(
                              row.status,
                            )}`}
                          >
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td data-label="Xuất">
                          {row.exportStatus === "exported" ? (
                            <span className={styles.exportedBadge}>
                              Đã xuất
                            </span>
                          ) : (
                            <span className={styles.notExportedBadge}>
                              Chưa xuất
                            </span>
                          )}
                        </td>
                        <td data-label="Ngày nạp">
                          {formatDate(row.paidAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className={styles.emptyCell}>
                        {hasReportFilters
                          ? "Không có giao dịch QR trọn đời phù hợp bộ lọc."
                          : "Chưa có giao dịch QR trọn đời."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeSection === "card" ? (
          <section
            className={styles.panel}
            aria-labelledby="card-payments-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <h2 id="card-payments-title">Giao dịch nạp thẻ</h2>
                <p>
                  Đang hiển thị {paymentRangeLabel(cardPageData)}/
                  {formatNumber(cardPageData.total)} bản ghi, 20 giao dịch mỗi
                  trang.
                </p>
              </div>
            </div>

            <div className={styles.filters} aria-label="Bộ lọc nạp thẻ">
              <label className={styles.filterField}>
                <span>Trạng thái</span>
                <select
                  value={cardFilters.status}
                  onChange={(event) => {
                    setCardFilters((current) => ({
                      ...current,
                      status: event.target.value as StatusFilter,
                    }));
                  }}
                >
                  <option value="all">Tất cả</option>
                  <option value="incomplete">Chưa thanh toán</option>
                  <option value="processing">Đang xử lý</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="completed">Đã nạp</option>
                  <option value="recharge_failed">Lỗi nạp</option>
                </select>
              </label>
              <label className={styles.filterField}>
                <span>ID Litmatch</span>
                <input
                  inputMode="numeric"
                  value={cardFilters.litmatchId}
                  placeholder="Nhập ID Litmatch"
                  onChange={(event) => {
                    setCardFilters((current) => ({
                      ...current,
                      litmatchId: event.target.value,
                    }));
                  }}
                />
              </label>
              <DateFilterField
                label="Cập nhật từ ngày"
                value={cardFilters.updatedFrom}
                onChange={(value) => {
                  setCardFilters((current) => ({
                    ...current,
                    updatedFrom: value,
                  }));
                }}
              />
              <DateFilterField
                label="Cập nhật đến ngày"
                value={cardFilters.updatedTo}
                onChange={(value) => {
                  setCardFilters((current) => ({
                    ...current,
                    updatedTo: value,
                  }));
                }}
              />
              <button
                className={styles.applyFilterButton}
                type="button"
                onClick={applyCardFilters}
              >
                Áp dụng
              </button>
              <button
                className={styles.clearFilterButton}
                type="button"
                onClick={clearCardFilters}
              >
                Xóa lọc
              </button>
            </div>

            <div className={styles.dangerZone}>
              <div>
                <strong>Xóa giao dịch chưa thanh toán</strong>
                <p>
                  Xóa các giao dịch nạp thẻ trạng thái Chưa thanh toán đang khớp
                  ID Litmatch và khoảng ngày cập nhật.
                </p>
              </div>
              <button
                className={styles.dangerButton}
                type="button"
                disabled={cardDeleting || !canDeleteCardIncomplete}
                onClick={() => handleDeleteIncompletePayments("card")}
              >
                {cardDeleting ? "Đang xóa..." : "Xóa giao dịch chưa thanh toán"}
              </button>
            </div>

            {cardDeleteError ? (
              <p className={styles.errorText} role="alert">
                {cardDeleteError}
              </p>
            ) : null}
            {cardDeleteMessage ? (
              <p className={styles.successText} role="status">
                {cardDeleteMessage}
              </p>
            ) : null}

            {cardError ? (
              <p className={styles.errorText} role="alert">
                {cardError}
              </p>
            ) : null}

            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>Request ID</th>
                    <th>ID Litmatch</th>
                    <th>Loại nhận</th>
                    <th>Loại thẻ</th>
                    <th>MG khai báo</th>
                    <th>MG thực tế</th>
                    <th>Tiền nhận</th>
                    <th>Provider</th>
                    <th>Thực nhận</th>
                    <th>Nạp Litmatch</th>
                    <th>Lỗi nạp</th>
                    <th>Thao tác</th>
                    <th>Mã thẻ</th>
                    <th>Seri</th>
                    <th>Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {cardPageData.rows.length ? (
                    cardPageData.rows.map((payment) => (
                      <tr key={payment.id}>
                        <td data-label="Trạng thái">
                          <span
                            className={`${styles.statusBadge} ${statusClassName(
                              payment.status,
                            )}`}
                          >
                            {statusLabel(payment.status)}
                          </span>
                        </td>
                        <td data-label="Request ID" className={styles.monoCell}>
                          {payment.requestId ?? "-"}
                        </td>
                        <td data-label="ID Litmatch">{payment.litmatchId}</td>
                        <td data-label="Loại nhận">
                          {rewardLabel(payment.rewardType)}
                        </td>
                        <td data-label="Loại thẻ">{payment.cardProvider}</td>
                        <td data-label="MG khai báo">
                          {formatNumber(payment.cardDenomination)} đ
                        </td>
                        <td data-label="MG thực tế">
                          {payment.actualValue !== null
                            ? `${formatNumber(payment.actualValue)} đ`
                            : "-"}
                        </td>
                        <td data-label="Tiền nhận">
                          {payment.providerAmount !== null
                            ? `${formatNumber(payment.providerAmount)} đ`
                            : "-"}
                        </td>
                        <td data-label="Provider" className={styles.errorCell}>
                          {payment.providerStatus !== null
                            ? `${payment.providerStatus}${
                                payment.providerMessage
                                  ? ` - ${payment.providerMessage}`
                                  : ""
                              }${
                                payment.providerDiscountPercent !== null
                                  ? ` - CK ${formatNumber(
                                      payment.providerDiscountPercent,
                                    )}%`
                                  : ""
                              }`
                            : "-"}
                        </td>
                        <td data-label="Thực nhận">
                          {formatNumber(payment.rewardAmount)}
                        </td>
                        <td data-label="Nạp Litmatch">
                          {payment.rechargeTransferType &&
                          payment.rechargeTransferNum ? (
                            <span>
                              {formatNumber(payment.rechargeTransferNum)}{" "}
                              {transferAssetLabel(payment.rechargeTransferType)}
                              {payment.rechargeStatus
                                ? ` (${rechargeStatusLabel(
                                    payment.rechargeStatus,
                                  )})`
                                : ""}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td data-label="Lỗi nạp" className={styles.errorCell}>
                          {payment.rechargeError ?? "-"}
                        </td>
                        <td data-label="Thao tác">
                          {payment.canRetryRecharge ? (
                            <button
                              className={styles.inlineActionButton}
                              type="button"
                              disabled={rechargeSubmitting}
                              onClick={() =>
                                previewFailedRecharge("card", payment.id)
                              }
                            >
                              Nạp lại
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td data-label="Mã thẻ" className={styles.monoCell}>
                          {payment.cardCode}
                        </td>
                        <td data-label="Seri" className={styles.monoCell}>
                          {payment.cardSerial}
                        </td>
                        <td data-label="Cập nhật">
                          {formatDate(payment.updatedAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={16} className={styles.emptyCell}>
                        {hasCardFilters
                          ? "Không có giao dịch nạp thẻ phù hợp bộ lọc."
                          : "Chưa có giao dịch nạp thẻ."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination} aria-label="Phân trang nạp thẻ">
              <span>
                Trang {formatNumber(cardPageData.page)}/
                {formatNumber(cardPageData.totalPages)}
              </span>
              <div className={styles.paginationActions}>
                <button
                  type="button"
                  disabled={cardPageData.page <= 1}
                  onClick={() =>
                    setCardPage((current) => Math.max(1, current - 1))
                  }
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={cardPageData.page >= cardPageData.totalPages}
                  onClick={() =>
                    setCardPage((current) =>
                      Math.min(cardPageData.totalPages, current + 1),
                    )
                  }
                >
                  Sau
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {rechargePreview ? (
          <div className={styles.modalBackdrop} role="presentation">
            <div
              className={styles.modalPanel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="recharge-confirm-title"
            >
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.kicker}>Xác nhận nạp</p>
                  <h2 id="recharge-confirm-title">
                    {rechargePreview.sourceLabel}
                  </h2>
                </div>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="Đóng"
                  disabled={rechargeSubmitting}
                  onClick={() => setRechargePreview(null)}
                >
                  x
                </button>
              </div>

              <div className={styles.userPreview}>
                <span className={styles.userPreviewAvatarSlot}>
                  <span
                    className={styles.userPreviewFallback}
                    aria-hidden="true"
                  >
                    {userInitial(rechargePreview.verifiedUser.nickname)}
                  </span>
                  {rechargeAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`Avatar của ${rechargePreview.verifiedUser.nickname}`}
                      src={rechargeAvatarUrl}
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                </span>
                <div>
                  <strong>{rechargePreview.verifiedUser.nickname}</strong>
                  <span>ID {rechargePreview.litmatchId}</span>
                </div>
              </div>

              <div className={styles.modalSummary}>
                <div className={styles.summaryItem}>
                  <span>Loại nhận</span>
                  <strong>{rewardLabel(rechargePreview.rewardType)}</strong>
                </div>
                <div className={styles.summaryItem}>
                  <span>Số lượng</span>
                  <strong>{formatNumber(rechargePreview.rewardAmount)}</strong>
                </div>
                {rechargePreview.amount !== null ? (
                  <div className={styles.summaryItem}>
                    <span>Số tiền</span>
                    <strong>{formatNumber(rechargePreview.amount)} đ</strong>
                  </div>
                ) : null}
                {rechargePreview.transferContent ? (
                  <div className={styles.summaryItem}>
                    <span>Nội dung CK</span>
                    <strong className={styles.compactValue}>
                      {rechargePreview.transferContent}
                    </strong>
                  </div>
                ) : null}
                {rechargePreview.requestId ? (
                  <div className={styles.summaryItem}>
                    <span>Request ID</span>
                    <strong>{rechargePreview.requestId}</strong>
                  </div>
                ) : null}
                {rechargePreview.note ? (
                  <div className={styles.summaryItem}>
                    <span>Ghi chú</span>
                    <strong className={styles.compactValue}>
                      {rechargePreview.note}
                    </strong>
                  </div>
                ) : null}
              </div>

              <div className={styles.modalActions}>
                <button
                  className={styles.clearFilterButton}
                  type="button"
                  disabled={rechargeSubmitting}
                  onClick={() => setRechargePreview(null)}
                >
                  Hủy
                </button>
                <button
                  className={styles.applyFilterButton}
                  type="button"
                  disabled={rechargeSubmitting}
                  onClick={confirmRecharge}
                >
                  {rechargeSubmitting ? "Đang nạp..." : "Xác nhận nạp"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {exportPreview ? (
          <div className={styles.modalBackdrop} role="presentation">
            <div
              className={styles.modalPanel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="export-result-title"
            >
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.kicker}>
                    {exportPreview.action === "export"
                      ? "Xác nhận xuất"
                      : "Xác nhận hủy xuất"}
                  </p>
                  <h2 id="export-result-title">
                    {exportPreview.action === "export"
                      ? "Tổng giao dịch sẽ xuất"
                      : "Tổng giao dịch sẽ hủy xuất"}
                  </h2>
                </div>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="Đóng"
                  disabled={exportingReport}
                  onClick={() => setExportPreview(null)}
                >
                  x
                </button>
              </div>

              <div className={styles.modalSummary}>
                <div className={styles.summaryItem}>
                  <span>Giao dịch</span>
                  <strong>{formatNumber(exportPreview.exportedCount)}</strong>
                </div>
                <div className={styles.summaryItem}>
                  <span>Tổng tiền nạp</span>
                  <strong>{formatNumber(exportPreview.totalAmount)} đ</strong>
                </div>
                <div className={styles.summaryItem}>
                  <span>Kim cương</span>
                  <strong>
                    {formatNumber(exportPreview.diamondRewardAmount)}
                  </strong>
                </div>
                <div className={styles.summaryItem}>
                  <span>Sao</span>
                  <strong>
                    {formatNumber(exportPreview.starRewardAmount)}
                  </strong>
                </div>
              </div>

              <div className={styles.modalActions}>
                <button
                  className={styles.clearFilterButton}
                  type="button"
                  disabled={exportingReport}
                  onClick={() => setExportPreview(null)}
                >
                  Hủy
                </button>
                <button
                  className={styles.applyFilterButton}
                  type="button"
                  disabled={exportingReport}
                  onClick={confirmExportReport}
                >
                  {exportingReport
                    ? "Đang xác nhận..."
                    : exportPreview.action === "export"
                      ? "Xác nhận xuất"
                      : "Xác nhận hủy xuất"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
