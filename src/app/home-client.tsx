"use client";

import Image from "next/image";
import { useId, useState } from "react";
import {
  calculateReceiveAmount,
  cardDenominations,
  cardProviders,
  getCurrencyRate,
  normalizeLitmatchId,
  packagePrices,
  type BankConfig,
  type RateConfig,
  type RewardType,
  type SiteConfig,
} from "@/lib/payment-config";
import VerifyIdModal, {
  type VerifiedUserInfo,
} from "./components/verify-id-modal";
import styles from "./page.module.css";

type CurrencyType = RewardType;
type TopUpMode = "bank" | "card";
type PaymentStatusKind = "bank" | "card" | "lifetime-bank-qr";
type PendingVerifyAction = "bank-qr" | "card" | "lifetime-qr";
type PublicCtvRef = {
  code: string;
  name: string;
};

type QrPayment = {
  id: string;
  amount: number;
  content: string;
  currency: CurrencyType;
  receiveAmount: number;
  qrUrl: string;
};

type LifetimeBankQr = {
  id: string;
  content: string;
  currency: CurrencyType;
  litmatchId: string;
  qrUrl: string;
};

type PaymentStatusValue =
  | "incomplete"
  | "processing"
  | "paid"
  | "completed"
  | "recharge_failed";

type BankPaymentResponse = {
  success: boolean;
  data?: {
    id: string;
    amount: number;
    rewardType: CurrencyType;
    rewardAmount: number;
    transferContent: string;
    qrUrl: string;
  };
  error?: string;
};

type LifetimeBankQrResponse = {
  success: boolean;
  data?: {
    id: string;
    litmatchId: string;
    rewardType: CurrencyType;
    transferContent: string;
    qrUrl: string;
  };
  existingLifetimeQr?: {
    id: string;
    litmatchId: string;
    rewardType: CurrencyType;
    transferContent: string;
    qrUrl: string;
  };
  error?: string;
};

type CardPaymentResponse = {
  success: boolean;
  data?: {
    id: string;
    status: PaymentStatusValue;
    providerStatus: number;
    message: string;
    rewardType: CurrencyType;
    cardProvider: string;
    cardDenomination: number;
    rewardAmount: number;
  };
  error?: string;
};

type PaymentStatusResponse = {
  success: boolean;
  data?: {
    id: string;
    type: "bank" | "card";
    bankMode?: "fixed" | "lifetime";
    status: PaymentStatusValue;
    litmatchId: string;
    rewardType: CurrencyType;
    rewardAmount: number;
    transferContent?: string;
    amount?: number;
    cardProvider?: string;
    cardDenomination?: number;
    providerStatus?: number | null;
    providerMessage?: string | null;
    actualValue?: number | null;
    providerAmount?: number | null;
    rechargeStatus?: "pending" | "completed" | "failed" | null;
    rechargeError?: string | null;
    updatedAt: string;
  };
  error?: string;
};

const numberFormatter = new Intl.NumberFormat("vi-VN");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function parseCurrencyInput(value: string) {
  return Number(value.replace(/\D/g, ""));
}

function normalizeLifetimeTransferContent(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseLifetimeTransferContent(value: string) {
  const normalized = normalizeLifetimeTransferContent(value);
  const parts = normalized.split(" ");
  const rewardType =
    parts[0] === "LMKC" ? "diamond" : parts[0] === "LMSAO" ? "star" : null;
  const litmatchId =
    parts.length === 2 ? parts[1] : parts.length === 3 ? parts[2] : "";
  const hasValidCtvCode =
    parts.length === 2 || (parts.length === 3 && /^[A-Z0-9]+$/.test(parts[1]));

  if (
    (parts.length !== 2 && parts.length !== 3) ||
    !rewardType ||
    !hasValidCtvCode ||
    !/^\d{5,20}$/.test(litmatchId)
  ) {
    return {
      normalized,
      litmatchId: "",
      valid: false,
    };
  }

  return {
    normalized,
    litmatchId,
    rewardType,
    valid: true,
  };
}

function getLifetimeTransferContentPrefix(rewardType: CurrencyType) {
  return rewardType === "diamond" ? "LMKC " : "LMSAO ";
}

function parseCtvLifetimeLitmatchId(
  value: string,
  rewardType: CurrencyType,
  ctvCode: string,
) {
  const litmatchId = normalizeLitmatchId(value);

  return {
    normalized: `${getLifetimeTransferContentPrefix(rewardType)}${ctvCode} ${
      litmatchId || ""
    }`.trim(),
    litmatchId,
    rewardType,
    valid: /^\d{5,20}$/.test(litmatchId),
  };
}

function paymentStatusLabel(status: PaymentStatusValue) {
  if (status === "completed") {
    return "Đã nạp thành công";
  }

  if (status === "recharge_failed") {
    return "Đã nhận tiền nhưng nạp lỗi";
  }

  if (status === "paid") {
    return "Đã nhận tiền, đang xử lý nạp";
  }

  if (status === "processing") {
    return "Đang xử lý thẻ";
  }

  return "Chưa thanh toán";
}

const defaultSiteConfig: SiteConfig = {
  dealerName: "Đại lý Thành Thái",
  zaloPhone: "",
  supportGroupUrl: "",
  facebookUrl: "",
  phoneNumber: "",
  announcementEnabled: false,
  announcementText: "",
};

const dealerAvatarUrl =
  "https://activity.static.ksztagent.com/4dc3d17e-746f-11f0-b306-5254007d7f21";

function getDealerName(siteConfig: SiteConfig) {
  return siteConfig.dealerName.trim() || defaultSiteConfig.dealerName;
}

function getZaloUrl(siteConfig: SiteConfig) {
  const zaloPhone = siteConfig.zaloPhone.replace(/\D/g, "");

  return zaloPhone ? `https://zalo.me/${zaloPhone}` : "";
}

function getPhoneUrl(siteConfig: SiteConfig) {
  const phoneNumber = siteConfig.phoneNumber.trim();

  return phoneNumber ? `tel:${phoneNumber}` : "";
}

function getSupportGroupUrl(siteConfig: SiteConfig) {
  return siteConfig.supportGroupUrl.trim();
}

function getContactLinks(siteConfig: SiteConfig) {
  return [
    {
      href: getZaloUrl(siteConfig),
      iconSrc: "/zalo.jpg",
      label: "Zalo",
      target: "_blank",
    },
    {
      href: siteConfig.facebookUrl.trim(),
      iconSrc: "/facebook.jpg",
      label: "Facebook",
      target: "_blank",
    },
    {
      href: getPhoneUrl(siteConfig),
      iconSrc: "/phone.jpg",
      label: "Điện thoại",
      target: undefined,
    },
  ].filter((link) => link.href);
}

const fallingItems = [
  { className: styles.fallOne, icon: "✦" },
  { className: styles.fallTwo, icon: "☄" },
  { className: styles.fallThree, icon: null },
  { className: styles.fallFour, icon: "✧" },
  { className: styles.fallFive, icon: "☾" },
  { className: styles.fallSix, icon: "✺" },
  { className: styles.fallSeven, icon: null },
  { className: styles.fallEight, icon: "✦" },
  { className: styles.fallNine, icon: "◆" },
  { className: styles.fallTen, icon: "☄" },
  { className: styles.fallEleven, icon: null },
  { className: styles.fallTwelve, icon: "✧" },
  { className: styles.fallThirteen, icon: "◌" },
  { className: styles.fallFourteen, icon: "✺" },
  { className: styles.fallFifteen, icon: "☾" },
  { className: styles.fallSixteen, icon: "✦" },
  { className: styles.fallSeventeen, icon: null },
  { className: styles.fallEighteen, icon: "◆" },
  { className: styles.fallNineteen, icon: "✧" },
  { className: styles.fallTwenty, icon: "☄" },
  { className: styles.fallTwentyOne, icon: null },
  { className: styles.fallTwentyTwo, icon: "✦" },
  { className: styles.fallTwentyThree, icon: "☾" },
  { className: styles.fallTwentyFour, icon: "✺" },
];

const currencyConfig = {
  diamond: {
    label: "Kim cương",
    title: "Kim Cương",
    icon: "💎",
    receiveLabel: "kim cương",
    packageAria: "Chọn gói kim cương",
    receiveAria: "Thực nhận kim cương",
    sectionAria: "Nạp kim cương Litmatch",
  },
  star: {
    label: "Xu sao",
    title: "Sao",
    icon: "★",
    receiveLabel: "xu sao",
    packageAria: "Chọn gói xu sao",
    receiveAria: "Thực nhận xu sao",
    sectionAria: "Nạp sao Litmatch",
  },
} as const;

type PaymentInfoRowProps = {
  copied: boolean;
  icon: string;
  label: string;
  value: string;
  onCopy: () => void;
};

type LitmatchIdFieldProps = {
  litmatchId: string;
  verifiedLitmatchId: string | null;
  verifyError: string;
  onChange: (value: string) => void;
  fieldClassName?: string;
};

function LitmatchIdField({
  litmatchId,
  verifiedLitmatchId,
  verifyError,
  onChange,
  fieldClassName = styles.field,
}: LitmatchIdFieldProps) {
  const normalizedId = normalizeLitmatchId(litmatchId);
  const isVerified =
    verifiedLitmatchId !== null && verifiedLitmatchId === normalizedId;

  return (
    <div className={fieldClassName}>
      <span>ID Litmatch</span>
      <input
        aria-label="ID Litmatch"
        placeholder="Nhập chính xác ID Litmatch"
        value={litmatchId}
        onChange={(event) => onChange(event.target.value)}
      />
      {verifyError ? (
        <p className={styles.verifyError} role="alert">
          {verifyError}
        </p>
      ) : null}
      {isVerified ? (
        <p className={styles.verifySuccess} role="status">
          Đã xác minh ID Litmatch.
        </p>
      ) : null}
    </div>
  );
}

function PaymentInfoRow({
  copied,
  icon,
  label,
  value,
  onCopy,
}: PaymentInfoRowProps) {
  return (
    <div className={styles.paymentInfoRow}>
      <span className={styles.paymentInfoIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.paymentInfoText}>
        <span>{label}</span>
        <strong>{value}</strong>
      </span>
      <button className={styles.copyButton} type="button" onClick={onCopy}>
        {copied ? "Đã chép" : "Sao chép"}
      </button>
    </div>
  );
}

function mapLifetimeBankQrResponse(data: {
  id: string;
  litmatchId: string;
  rewardType: CurrencyType;
  transferContent: string;
  qrUrl: string;
}): LifetimeBankQr {
  return {
    id: data.id,
    content: data.transferContent,
    currency: data.rewardType,
    litmatchId: data.litmatchId,
    qrUrl: data.qrUrl,
  };
}

type LifetimeBankQrModalProps = {
  bankConfig: BankConfig;
  bankRateConfig: RateConfig;
  copiedField: string;
  ctvRef: PublicCtvRef | null;
  currency: CurrencyType;
  error: string;
  existingLifetimeQr: LifetimeBankQr | null;
  lifetimeQr: LifetimeBankQr | null;
  lifetimeTransferContent: string;
  loading: boolean;
  statusLoading: boolean;
  statusMessage: string;
  verifiedLitmatchId: string | null;
  verifyError: string;
  verifyLoading: boolean;
  onCheckStatus: () => void;
  onClose: () => void;
  onCopy: (value: string, field: string) => void;
  onCreate: () => void;
  onDownloadQr: () => void;
  onOpenExistingQr: () => void;
  onLifetimeTransferContentChange: (value: string) => void;
  onCurrencyChange: (value: CurrencyType) => void;
  onResetQr: () => void;
};

function LifetimeBankQrModal({
  bankConfig,
  bankRateConfig,
  copiedField,
  ctvRef,
  currency,
  error,
  existingLifetimeQr,
  lifetimeQr,
  lifetimeTransferContent,
  loading,
  statusLoading,
  statusMessage,
  verifiedLitmatchId,
  verifyError,
  verifyLoading,
  onCheckStatus,
  onClose,
  onCopy,
  onCreate,
  onDownloadQr,
  onOpenExistingQr,
  onLifetimeTransferContentChange,
  onCurrencyChange,
  onResetQr,
}: LifetimeBankQrModalProps) {
  const active = currencyConfig[currency];
  const activeIconClass = `${styles.inlineIcon} ${
    currency === "star" ? styles.starIcon : styles.diamondIcon
  }`;
  const parsedLifetimeContent = ctvRef
    ? parseCtvLifetimeLitmatchId(lifetimeTransferContent, currency, ctvRef.code)
    : parseLifetimeTransferContent(lifetimeTransferContent);

  return (
    <div className={styles.lifetimeModalOverlay} role="presentation">
      <div
        className={styles.lifetimeModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifetime-qr-modal-title"
      >
        <div className={styles.lifetimeModalHeader}>
          <div>
            <p className={styles.verifyModalEyebrow}>
              QR chuyển khoản trọn đời
            </p>
            <h2
              className={styles.lifetimeModalTitle}
              id="lifetime-qr-modal-title"
            >
              {lifetimeQr ? "Lưu QR để nạp nhiều lần" : "Tạo mã QR trọn đời"}
            </h2>
          </div>
          <button
            className={styles.lifetimeCloseButton}
            type="button"
            aria-label="Đóng QR trọn đời"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {lifetimeQr ? (
          <div className={styles.lifetimeQrGrid}>
            <div className={styles.lifetimeQrStage}>
              <div className={styles.lifetimeQrFrame}>
                <Image
                  className={styles.lifetimeQrImage}
                  src={lifetimeQr.qrUrl}
                  alt={`Mã QR trọn đời cho ID Litmatch ${lifetimeQr.litmatchId}`}
                  width={420}
                  height={420}
                  unoptimized
                />
              </div>
              <div className={styles.lifetimeQrSummary}>
                <span>ID Litmatch {lifetimeQr.litmatchId}</span>
                <strong>
                  Nhận {currencyConfig[lifetimeQr.currency].label}{" "}
                  <span className={activeIconClass} aria-hidden="true">
                    {currencyConfig[lifetimeQr.currency].icon}
                  </span>
                </strong>
                <small>Người dùng tự nhập số tiền trong app ngân hàng.</small>
              </div>
            </div>

            <div className={styles.lifetimeReceipt}>
              <p className={styles.lifetimeNotice}>
                Hệ thống chờ webhook ngân hàng, lấy số tiền thực chuyển và tự
                tính số {currencyConfig[lifetimeQr.currency].receiveLabel} theo
                tỉ giá chuyển khoản tại thời điểm tiền về.
              </p>

              <div className={styles.paymentInfoCard}>
                <PaymentInfoRow
                  copied={copiedField === "lifetimeBank"}
                  icon="▦"
                  label="Chuyển khoản đến:"
                  value={bankConfig.bankName}
                  onCopy={() => onCopy(bankConfig.bankName, "lifetimeBank")}
                />
                <PaymentInfoRow
                  copied={copiedField === "lifetimeAccountNo"}
                  icon="#"
                  label="Số tài khoản:"
                  value={bankConfig.accountNo}
                  onCopy={() =>
                    onCopy(bankConfig.accountNo, "lifetimeAccountNo")
                  }
                />
                <PaymentInfoRow
                  copied={copiedField === "lifetimeAccountName"}
                  icon="●"
                  label="Chủ tài khoản:"
                  value={bankConfig.accountName}
                  onCopy={() =>
                    onCopy(bankConfig.accountName, "lifetimeAccountName")
                  }
                />
                <PaymentInfoRow
                  copied={copiedField === "lifetimeContent"}
                  icon="≡"
                  label="Nội dung chuyển khoản:"
                  value={lifetimeQr.content}
                  onCopy={() => onCopy(lifetimeQr.content, "lifetimeContent")}
                />
              </div>

              <div className={styles.lifetimeModalActions}>
                <button
                  className={styles.downloadButton}
                  type="button"
                  onClick={onDownloadQr}
                >
                  Tải mã QR
                </button>
                <button
                  className={styles.statusButton}
                  type="button"
                  disabled={statusLoading}
                  onClick={onCheckStatus}
                >
                  {statusLoading ? "Đang kiểm tra..." : "Kiểm tra giao dịch"}
                </button>
                <button
                  className={styles.backButton}
                  type="button"
                  onClick={onResetQr}
                >
                  Tạo mã khác
                </button>
              </div>

              {statusMessage ? (
                <p className={styles.statusMessage} role="status">
                  {statusMessage}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <form
            className={styles.lifetimeForm}
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <div
              className={styles.cardRewardTabs}
              role="tablist"
              aria-label="Loại nhận cho QR trọn đời"
            >
              {(Object.keys(currencyConfig) as CurrencyType[]).map((type) => {
                const isActive = currency === type;
                const config = currencyConfig[type];

                return (
                  <button
                    aria-selected={isActive}
                    className={`${styles.cardRewardButton}${
                      isActive ? ` ${styles.cardRewardButtonActive}` : ""
                    }`}
                    key={type}
                    role="tab"
                    type="button"
                    onClick={() => onCurrencyChange(type)}
                  >
                    <span
                      className={`${styles.inlineIcon} ${
                        type === "star" ? styles.starIcon : styles.diamondIcon
                      }`}
                      aria-hidden="true"
                    >
                      {config.icon}
                    </span>
                    Nhận {config.label}
                  </button>
                );
              })}
            </div>

            <label className={styles.cardTopupField}>
              <span>{ctvRef ? "ID Litmatch" : "Nội dung chuyển khoản"}</span>
              <input
                aria-label={
                  ctvRef
                    ? "ID Litmatch QR trọn đời"
                    : "Nội dung chuyển khoản QR trọn đời"
                }
                placeholder={
                  ctvRef
                    ? "123456789"
                    : currency === "diamond"
                      ? "LMKC 123456789"
                      : "LMSAO 123456789"
                }
                value={lifetimeTransferContent}
                onChange={(event) =>
                  onLifetimeTransferContentChange(event.target.value)
                }
              />
            </label>

            <div className={styles.lifetimeGuide}>
              {ctvRef ? (
                <>
                  <strong>
                    Link CTV {ctvRef.name}: hệ thống tự tạo nội dung{" "}
                    {getLifetimeTransferContentPrefix(currency)}
                    {ctvRef.code} IDLITMATCH.
                  </strong>
                  <span>
                    Khách chỉ cần nhập ID Litmatch. Khi tiền về, giao dịch được
                    ghi nhận cho CTV {ctvRef.name}.
                  </span>
                </>
              ) : (
                <>
                  <strong>
                    Format: LMKC IDLITMATCH hoặc LMSAO IDLITMATCH. Có thể thêm
                    TENCTV ở giữa.
                  </strong>
                  <span>
                    Ví dụ: LMKC 123456789 để nạp kim cương, LMSAO 123456789 để
                    nạp sao. Nếu có cộng tác viên, nhập LMKC THANHTHAI
                    123456789. Tên CTV chỉ dùng chữ/số không dấu, không khoảng
                    trắng. Hệ thống sẽ lấy ID ở cuối nội dung để kiểm tra và tự
                    nạp khi tiền về.
                  </span>
                </>
              )}
            </div>

            <div className={styles.lifetimeVerifyRow}>
              <div>
                <span>ID Litmatch sẽ nạp</span>
                <strong>
                  {parsedLifetimeContent.litmatchId || "Chưa đúng format"}
                </strong>
              </div>
            </div>

            {verifyError ? (
              <p className={styles.verifyError} role="alert">
                {verifyError}
              </p>
            ) : null}
            {verifiedLitmatchId &&
            verifiedLitmatchId === parsedLifetimeContent.litmatchId ? (
              <p className={styles.verifySuccess} role="status">
                Đã xác minh ID Litmatch.
              </p>
            ) : null}

            <p className={styles.lifetimeRateNote}>
              Tỷ lệ khi tiền về: 1.000 đ ={" "}
              {formatNumber(getCurrencyRate(bankRateConfig, currency))}{" "}
              {active.receiveLabel}{" "}
              <span className={activeIconClass} aria-hidden="true">
                {active.icon}
              </span>
            </p>

            {error ? (
              <div className={styles.lifetimeErrorBlock}>
                <p className={styles.formError} role="alert">
                  {error}
                </p>
                {existingLifetimeQr ? (
                  <button
                    className={styles.existingLifetimeQrButton}
                    type="button"
                    onClick={onOpenExistingQr}
                  >
                    Xem QR hiện có
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className={styles.verifyModalActions}>
              <button
                className={styles.verifyModalCancel}
                type="button"
                onClick={onClose}
              >
                Hủy
              </button>
              <button
                className={styles.verifyModalConfirm}
                type="submit"
                disabled={loading || verifyLoading}
              >
                {loading
                  ? "Đang tạo..."
                  : verifyLoading
                    ? "Đang kiểm..."
                    : "Tạo QR"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function HomeClient({
  bankConfig,
  bankRateConfig,
  cardRateConfig,
  ctvRef,
  siteConfig,
}: {
  bankConfig: BankConfig;
  bankRateConfig: RateConfig;
  cardRateConfig: RateConfig;
  ctvRef: PublicCtvRef | null;
  siteConfig: SiteConfig;
}) {
  const [topUpMode, setTopUpMode] = useState<TopUpMode>("bank");
  const [currency, setCurrency] = useState<CurrencyType>("diamond");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [selectedPackagePrice, setSelectedPackagePrice] = useState<
    number | null
  >(null);
  const [litmatchId, setLitmatchId] = useState("");
  const [cardCurrency, setCardCurrency] = useState<CurrencyType>("diamond");
  const [cardProvider, setCardProvider] = useState(cardProviders[0]);
  const [cardDenomination, setCardDenomination] = useState(50000);
  const [cardCode, setCardCode] = useState("");
  const [cardSerial, setCardSerial] = useState("");
  const [cardMessage, setCardMessage] = useState("");
  const [cardPaymentId, setCardPaymentId] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [cardLoading, setCardLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [qrPayment, setQrPayment] = useState<QrPayment | null>(null);
  const [showLifetimeQrModal, setShowLifetimeQrModal] = useState(false);
  const [lifetimeCurrency, setLifetimeCurrency] =
    useState<CurrencyType>("diamond");
  const [lifetimeQr, setLifetimeQr] = useState<LifetimeBankQr | null>(null);
  const [existingLifetimeQr, setExistingLifetimeQr] =
    useState<LifetimeBankQr | null>(null);
  const [lifetimeQrLoading, setLifetimeQrLoading] = useState(false);
  const [lifetimeQrError, setLifetimeQrError] = useState("");
  const [lifetimeTransferContent, setLifetimeTransferContent] = useState(
    ctvRef ? "" : getLifetimeTransferContentPrefix("diamond"),
  );
  const [lifetimeStatusMessage, setLifetimeStatusMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const [verifiedLitmatchId, setVerifiedLitmatchId] = useState<string | null>(
    null,
  );
  const [pendingUser, setPendingUser] = useState<VerifiedUserInfo | null>(null);
  const [pendingVerifyAction, setPendingVerifyAction] =
    useState<PendingVerifyAction | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const tabBaseId = useId();
  const mergedSiteConfig = {
    ...defaultSiteConfig,
    ...siteConfig,
  };
  const dealerName = getDealerName(mergedSiteConfig);
  const contactLinks = getContactLinks(mergedSiteConfig);
  const supportGroupUrl = getSupportGroupUrl(mergedSiteConfig);
  const announcementText = mergedSiteConfig.announcementText.trim();
  const shouldShowAnnouncement =
    showAnnouncement &&
    mergedSiteConfig.announcementEnabled &&
    Boolean(announcementText);
  const active = currencyConfig[currency];
  const receiveAmount = calculateReceiveAmount(
    paymentAmount,
    currency,
    bankRateConfig,
  );
  const cardActive = currencyConfig[cardCurrency];
  const cardReceiveAmount = calculateReceiveAmount(
    cardDenomination,
    cardCurrency,
    cardRateConfig,
  );
  const activeIconClass = `${styles.inlineIcon} ${
    currency === "star" ? styles.starIcon : styles.diamondIcon
  }`;
  const cardIconClass = `${styles.inlineIcon} ${
    cardCurrency === "star" ? styles.starIcon : styles.diamondIcon
  }`;
  const hasBankConfig =
    bankConfig.bankId.trim() &&
    bankConfig.accountNo.trim() &&
    bankConfig.accountName.trim();

  function getInitialLifetimeTransferContent(rewardType: CurrencyType) {
    return ctvRef ? "" : getLifetimeTransferContentPrefix(rewardType);
  }

  function getPreparedLifetimeContent(value = lifetimeTransferContent) {
    return ctvRef
      ? parseCtvLifetimeLitmatchId(value, lifetimeCurrency, ctvRef.code)
      : parseLifetimeTransferContent(value);
  }

  function handlePackageSelect(price: number) {
    setPaymentAmount(price);
    setSelectedPackagePrice(price);
    setFormError("");
  }

  function handlePaymentChange(value: string) {
    const nextAmount = parseCurrencyInput(value);

    setPaymentAmount(nextAmount);
    setSelectedPackagePrice(
      packagePrices.includes(nextAmount) ? nextAmount : null,
    );
    setFormError("");
    setStatusMessage("");
  }

  function handleLitmatchIdChange(value: string) {
    setLitmatchId(value);
    setVerifiedLitmatchId(null);
    setVerifyError("");
    setFormError("");
    setCardMessage("");
    setCardPaymentId(null);
    setStatusMessage("");
    setLifetimeQrError("");
    setLifetimeStatusMessage("");
  }

  function handleLifetimeTransferContentChange(value: string) {
    setLifetimeTransferContent(value);
    setLitmatchId(getPreparedLifetimeContent(value).litmatchId);
    setVerifiedLitmatchId(null);
    setVerifyError("");
    setLifetimeQrError("");
    setExistingLifetimeQr(null);
    setLifetimeStatusMessage("");
  }

  async function executeCreateQr() {
    const normalizedId = normalizeLitmatchId(litmatchId);

    setPaymentLoading(true);
    setFormError("");

    try {
      const response = await fetch("/api/payments/bank", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          litmatchId: normalizedId,
          amount: paymentAmount,
          rewardType: currency,
          ctvCode: ctvRef?.code,
        }),
      });
      const payload = (await response.json()) as BankPaymentResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setFormError(payload.error ?? "Không tạo được mã QR.");
        return;
      }

      setQrPayment({
        id: payload.data.id,
        amount: payload.data.amount,
        content: payload.data.transferContent,
        currency: payload.data.rewardType,
        receiveAmount: payload.data.rewardAmount,
        qrUrl: payload.data.qrUrl,
      });
      setStatusMessage("");
    } catch {
      setFormError("Không tạo được mã QR.");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handleCreateQr() {
    if (!paymentAmount) {
      setFormError("Vui lòng chọn gói hoặc nhập số tiền thanh toán.");
      return;
    }

    if (!hasBankConfig) {
      setFormError("Thiếu cấu hình VietQR.");
      return;
    }

    const normalizedId = normalizeLitmatchId(litmatchId);

    if (!normalizedId) {
      setFormError("Vui lòng nhập ID Litmatch.");
      return;
    }

    if (verifiedLitmatchId === normalizedId) {
      await executeCreateQr();
      return;
    }

    setPendingVerifyAction("bank-qr");
    await handleVerifyId();
  }

  function handleOpenLifetimeQrModal() {
    setShowLifetimeQrModal(true);
    setLifetimeQr(null);
    setExistingLifetimeQr(null);
    setLifetimeQrError("");
    setLifetimeStatusMessage("");
    setLifetimeTransferContent(
      getInitialLifetimeTransferContent(lifetimeCurrency),
    );
    setCopiedField("");
  }

  function handleCloseLifetimeQrModal() {
    setShowLifetimeQrModal(false);
    setLifetimeQr(null);
    setExistingLifetimeQr(null);
    setLifetimeQrError("");
    setLifetimeStatusMessage("");
    setLifetimeTransferContent(
      getInitialLifetimeTransferContent(lifetimeCurrency),
    );
    setCopiedField("");
  }

  function handleResetLifetimeQr() {
    setLifetimeQr(null);
    setExistingLifetimeQr(null);
    setLifetimeQrError("");
    setLifetimeStatusMessage("");
    setLifetimeTransferContent(
      getInitialLifetimeTransferContent(lifetimeCurrency),
    );
    setCopiedField("");
  }

  function handleOpenExistingLifetimeQr() {
    if (!existingLifetimeQr) {
      return;
    }

    setLifetimeQr(existingLifetimeQr);
    setExistingLifetimeQr(null);
    setLifetimeQrError("");
    setLifetimeStatusMessage("");
  }

  async function handleDownloadLifetimeQr() {
    if (!lifetimeQr) {
      return;
    }

    const filename = `litmatch-qr-${lifetimeQr.litmatchId}-${lifetimeQr.content.replace(
      /\s+/g,
      "-",
    )}.png`;

    try {
      const response = await fetch(lifetimeQr.qrUrl);

      if (!response.ok) {
        throw new Error("QR download failed");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setLifetimeStatusMessage("Đã tải mã QR.");
    } catch {
      const link = document.createElement("a");

      link.href = lifetimeQr.qrUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setLifetimeStatusMessage(
        "Đã mở mã QR trong tab mới. Nếu trình duyệt không tự tải, hãy lưu ảnh từ tab đó.",
      );
    }
  }

  function handleLifetimeCurrencyChange(value: CurrencyType) {
    setLifetimeCurrency(value);
    setLifetimeTransferContent((current) => {
      if (ctvRef) {
        return current;
      }

      const parsed = parseLifetimeTransferContent(current);

      if (!current.trim() || !parsed.valid) {
        return getLifetimeTransferContentPrefix(value);
      }

      const parts = parsed.normalized.split(" ");

      if (parts.length === 2) {
        return `${getLifetimeTransferContentPrefix(value)}${parts[1]}`;
      }

      return `${getLifetimeTransferContentPrefix(value)}${parts[1]} ${parts[2]}`;
    });
    setVerifiedLitmatchId(null);
    setVerifyError("");
    setLifetimeQrError("");
    setExistingLifetimeQr(null);
    setLifetimeStatusMessage("");
  }

  async function executeCreateLifetimeQr() {
    const parsedContent = getPreparedLifetimeContent();

    setLifetimeQrLoading(true);
    setLifetimeQrError("");
    setExistingLifetimeQr(null);
    setLifetimeStatusMessage("");

    try {
      const response = await fetch("/api/payments/lifetime-bank-qr", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          transferContent: parsedContent.normalized,
          rewardType: lifetimeCurrency,
          ctvCode: ctvRef?.code,
        }),
      });
      const payload = (await response.json()) as LifetimeBankQrResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setLifetimeQrError(payload.error ?? "Không tạo được QR trọn đời.");

        if (payload.existingLifetimeQr) {
          setExistingLifetimeQr(
            mapLifetimeBankQrResponse(payload.existingLifetimeQr),
          );
        }

        return;
      }

      setLifetimeQr(mapLifetimeBankQrResponse(payload.data));
    } catch {
      setLifetimeQrError("Không tạo được QR trọn đời.");
    } finally {
      setLifetimeQrLoading(false);
    }
  }

  async function handleCreateLifetimeQr() {
    if (!hasBankConfig) {
      setLifetimeQrError("Thiếu cấu hình VietQR.");
      return;
    }

    const parsedContent = getPreparedLifetimeContent();

    if (!parsedContent.valid) {
      setLifetimeQrError(
        ctvRef
          ? "Vui lòng nhập ID Litmatch hợp lệ từ 5-20 số."
          : "Nội dung QR trọn đời phải có dạng LMKC IDLITMATCH, LMSAO IDLITMATCH hoặc thêm TENCTV ở giữa.",
      );
      return;
    }

    if (parsedContent.rewardType !== lifetimeCurrency) {
      setLifetimeQrError(
        "Loại nhận không khớp nội dung chuyển khoản. LMKC dùng cho kim cương, LMSAO dùng cho sao.",
      );
      return;
    }

    if (verifiedLitmatchId === parsedContent.litmatchId) {
      await executeCreateLifetimeQr();
      return;
    }

    setPendingVerifyAction("lifetime-qr");
    await handleVerifyId();
  }

  function handleShowCardMode() {
    setTopUpMode("card");
    setQrPayment(null);
    setFormError("");
    setCardMessage("");
    setStatusMessage("");
  }

  function handleShowBankMode() {
    setTopUpMode("bank");
    setQrPayment(null);
    setFormError("");
    setCardMessage("");
    setCardPaymentId(null);
    setStatusMessage("");
  }

  async function executeCardSubmit() {
    const normalizedId = normalizeLitmatchId(litmatchId);

    setCardLoading(true);
    setFormError("");
    setCardMessage("");

    try {
      const response = await fetch("/api/payments/card", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          litmatchId: normalizedId,
          rewardType: cardCurrency,
          cardProvider,
          cardDenomination,
          cardCode,
          cardSerial,
          ctvCode: ctvRef?.code,
        }),
      });
      const payload = (await response.json()) as CardPaymentResponse;

      if (!response.ok || !payload.success || !payload.data) {
        setFormError(payload.error ?? "Không ghi nhận được thẻ cào.");
        return;
      }

      setCardMessage(
        `Đã gửi thẻ ${payload.data.cardProvider} ${formatNumber(
          payload.data.cardDenomination,
        )} đ. ${payload.data.message} Thực nhận dự kiến ${formatNumber(
          payload.data.rewardAmount,
        )} ${currencyConfig[payload.data.rewardType].receiveLabel}.`,
      );
      setCardPaymentId(payload.data.id);
      setStatusMessage("");
    } catch {
      setFormError("Không ghi nhận được thẻ cào.");
    } finally {
      setCardLoading(false);
    }
  }

  async function handleCardSubmit() {
    if (!cardCode.trim() || !cardSerial.trim() || !litmatchId.trim()) {
      setFormError("Vui lòng nhập đầy đủ mã thẻ, số seri và ID Litmatch.");
      setCardMessage("");
      return;
    }

    const normalizedId = normalizeLitmatchId(litmatchId);

    if (verifiedLitmatchId === normalizedId) {
      await executeCardSubmit();
      return;
    }

    setPendingVerifyAction("card");
    await handleVerifyId();
  }

  async function handleVerifyId() {
    const lifetimeContent = getPreparedLifetimeContent();
    const normalizedId = showLifetimeQrModal
      ? lifetimeContent.litmatchId
      : normalizeLitmatchId(litmatchId);

    if (!normalizedId) {
      setVerifyError(
        showLifetimeQrModal
          ? ctvRef
            ? "Vui lòng nhập ID Litmatch."
            : "Vui lòng nhập nội dung đúng dạng LMKC IDLITMATCH, LMSAO IDLITMATCH hoặc thêm TENCTV ở giữa."
          : "Vui lòng nhập ID Litmatch.",
      );
      setPendingVerifyAction(null);
      return;
    }

    setVerifyLoading(true);
    setVerifyError("");

    try {
      const response = await fetch("/api/litmatch/verify-id", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetUid: normalizedId }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        data?: VerifiedUserInfo;
        error?: string;
      };

      if (!response.ok || !payload.success || !payload.data) {
        setVerifyError(payload.error ?? "Không xác minh được ID Litmatch.");
        setPendingVerifyAction(null);
        return;
      }

      setPendingUser(payload.data);
    } catch {
      setVerifyError("Không xác minh được ID Litmatch.");
      setPendingVerifyAction(null);
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleCheckPaymentStatus(
    type: PaymentStatusKind,
    paymentId: string | null,
    onMessage: (message: string) => void = setStatusMessage,
  ) {
    if (!paymentId) {
      onMessage("Chưa có giao dịch để kiểm tra.");
      return;
    }

    setStatusLoading(true);
    onMessage("");

    try {
      const params = new URLSearchParams({ type, id: paymentId });
      const response = await fetch(`/api/payments/status?${params.toString()}`);
      const payload = (await response.json()) as PaymentStatusResponse;

      if (!response.ok || !payload.success || !payload.data) {
        onMessage(payload.error ?? "Không kiểm tra được trạng thái.");
        return;
      }

      const paymentType =
        payload.data.type === "card"
          ? "nạp thẻ"
          : payload.data.bankMode === "lifetime"
            ? "QR trọn đời"
            : "chuyển khoản";
      const rewardText = `${formatNumber(payload.data.rewardAmount)} ${
        currencyConfig[payload.data.rewardType].receiveLabel
      }`;
      const errorText = payload.data.rechargeError
        ? ` Lý do: ${payload.data.rechargeError}`
        : payload.data.providerMessage
          ? ` Ghi chú: ${payload.data.providerMessage}`
          : "";

      onMessage(
        `Giao dịch ${paymentType}: ${paymentStatusLabel(
          payload.data.status,
        )}. Thực nhận: ${rewardText}.${errorText}`,
      );
    } catch {
      onMessage("Không kiểm tra được trạng thái.");
    } finally {
      setStatusLoading(false);
    }
  }

  function handleConfirmVerify() {
    const action = pendingVerifyAction;

    if (pendingUser) {
      setVerifiedLitmatchId(pendingUser.targetUid);
      if (!showLifetimeQrModal) {
        setLitmatchId(pendingUser.targetUid);
      }
      setVerifyError("");
      setFormError("");
      setLifetimeQrError("");
    }

    setPendingUser(null);
    setPendingVerifyAction(null);

    if (!pendingUser || !action) {
      return;
    }

    if (action === "bank-qr") {
      void executeCreateQr();
      return;
    }

    if (action === "card") {
      void executeCardSubmit();
      return;
    }

    void executeCreateLifetimeQr();
  }

  function handleCancelVerify() {
    setPendingUser(null);
    setPendingVerifyAction(null);
  }

  async function handleCopy(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(""), 1600);
    } catch {
      setCopiedField("");
    }
  }

  function handleBackToForm() {
    setQrPayment(null);
    setCopiedField("");
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell} aria-hidden="true">
        {fallingItems.map((item, index) => (
          <span
            className={`${styles.fallingItem} ${
              item.icon ? styles.fallingIcon : styles.fallingBubble
            } ${item.className}`}
            key={index}
          >
            {item.icon}
          </span>
        ))}
        <span className={`${styles.wave} ${styles.waveLeft}`} />
        <span className={`${styles.wave} ${styles.waveRight}`} />
        <span className={`${styles.wave} ${styles.waveTop}`} />
      </div>

      <section
        className={styles.appFrame}
        aria-label={
          qrPayment
            ? "Xác nhận thanh toán QR"
            : topUpMode === "card"
              ? "Nạp thẻ cào Litmatch"
              : active.sectionAria
        }
      >
        <div className={styles.galaxyMasthead}>
          <div className={styles.mastheadActions}>
            <span className={styles.dealerBadge}>
              <span className={styles.dealerAvatar}>
                <Image
                  alt=""
                  className={styles.dealerAvatarImage}
                  height={128}
                  src={dealerAvatarUrl}
                  width={128}
                />
              </span>
              <span className={styles.dealerBadgeText}>
                <strong>{dealerName}</strong>
                <small>NẠP LITMATCH</small>
              </span>
            </span>
            <div className={styles.galaxySignals}>
              {supportGroupUrl ? (
                <a
                  aria-label="Group CSKH"
                  className={styles.galaxySignalLabeled}
                  href={supportGroupUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  title="Group CSKH"
                >
                  <Image
                    alt=""
                    className={styles.contactIcon}
                    height={22}
                    src="/zalo.jpg"
                    width={22}
                  />
                  <span>Group CSKH</span>
                </a>
              ) : (
                <span
                  aria-label="Group CSKH"
                  className={`${styles.galaxySignalLabeled} ${styles.galaxySignalStatic}`}
                  title="Group CSKH"
                >
                  <Image
                    alt=""
                    className={styles.contactIcon}
                    height={22}
                    src="/zalo.jpg"
                    width={22}
                  />
                  <span>Group CSKH</span>
                </span>
              )}
              {contactLinks.map((link) => (
                <a
                  aria-label={link.label}
                  href={link.href}
                  key={link.label}
                  rel={link.target ? "noopener noreferrer" : undefined}
                  target={link.target}
                >
                  <Image
                    alt=""
                    className={styles.contactIcon}
                    height={26}
                    src={link.iconSrc}
                    width={26}
                  />
                </a>
              ))}
            </div>
          </div>
        </div>

        {shouldShowAnnouncement ? (
          <div className={styles.internationalNotice} role="status">
            <div className={styles.internationalNoticeLink}>
              <span className={styles.noticeBadge}>Thông báo</span>
              <strong className={styles.announcementText}>
                {announcementText}
              </strong>
            </div>
            <button
              className={styles.noticeCloseButton}
              type="button"
              aria-label="Đóng thông báo"
              onClick={() => setShowAnnouncement(false)}
            >
              ×
            </button>
          </div>
        ) : null}

        {qrPayment ? (
          <div className={`${styles.arcadeBoard} ${styles.qrBoard}`}>
            <div className={styles.boardHeader}>
              <p className={styles.eyebrow}>Thanh toán QR</p>
              <h1 className={styles.boardTitle}>Quét QR để hoàn tất</h1>
              <p className={styles.boardLead}>
                Đơn nạp khớp theo số tiền và nội dung chuyển khoản bên dưới.
              </p>
            </div>

            <div className={styles.qrLayout}>
              <div className={styles.scanStage}>
                <span className={styles.scanPill}>QR sẵn sàng</span>
                <div className={styles.qrFrame}>
                  <span className={`${styles.qrSticker} ${styles.qrJellyLeft}`}>
                    ☾
                  </span>
                  <span
                    className={`${styles.qrSticker} ${styles.qrJellyRight}`}
                  >
                    ✦
                  </span>
                  <span
                    className={`${styles.qrSticker} ${styles.qrStarTopLeft}`}
                  >
                    ★
                  </span>
                  <span
                    className={`${styles.qrSticker} ${styles.qrStarTopRight}`}
                  >
                    ★
                  </span>
                  <span className={`${styles.qrSticker} ${styles.qrStarRight}`}>
                    ★
                  </span>
                  <span
                    className={`${styles.qrSticker} ${styles.qrStarBottomLeft}`}
                  >
                    ★
                  </span>
                  <span
                    className={`${styles.qrSticker} ${styles.qrStarBottomRight}`}
                  >
                    ★
                  </span>
                  <span className={`${styles.qrSticker} ${styles.qrFishLeft}`}>
                    ☄
                  </span>
                  <span
                    className={`${styles.qrSticker} ${styles.qrFishBottom}`}
                  >
                    ✧
                  </span>
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleOne}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleTwo}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleThree}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleFour}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleFive}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleSix}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleSeven}`}
                  />
                  <span
                    className={`${styles.qrBubble} ${styles.qrBubbleEight}`}
                  />
                  <Image
                    className={styles.qrImage}
                    src={qrPayment.qrUrl}
                    alt={`Mã QR thanh toán ${formatNumber(qrPayment.amount)} đồng`}
                    width={480}
                    height={480}
                    unoptimized
                  />
                </div>

                <div className={styles.scanSummary}>
                  <span>Thanh toán</span>
                  <strong>{formatNumber(qrPayment.amount)} đ</strong>
                  <small>
                    Nhận {formatNumber(qrPayment.receiveAmount)}{" "}
                    {currencyConfig[qrPayment.currency].receiveLabel}
                  </small>
                </div>
              </div>

              <aside className={styles.receiptPanel}>
                <div className={styles.sectionIntro}>
                  <span className={styles.dockStep}>PAY</span>
                  <div>
                    <h2>Phiếu chuyển khoản</h2>
                    <p>Thông tin khớp với mã QR hiện tại.</p>
                  </div>
                </div>

                <div className={styles.paymentInfoCard}>
                  <PaymentInfoRow
                    copied={copiedField === "bank"}
                    icon="▦"
                    label="Chuyển khoản đến:"
                    value={bankConfig.bankName}
                    onCopy={() => handleCopy(bankConfig.bankName, "bank")}
                  />
                  <PaymentInfoRow
                    copied={copiedField === "accountNo"}
                    icon="#"
                    label="Số tài khoản:"
                    value={bankConfig.accountNo}
                    onCopy={() => handleCopy(bankConfig.accountNo, "accountNo")}
                  />
                  <PaymentInfoRow
                    copied={copiedField === "accountName"}
                    icon="●"
                    label="Chủ tài khoản:"
                    value={bankConfig.accountName}
                    onCopy={() =>
                      handleCopy(bankConfig.accountName, "accountName")
                    }
                  />
                  <PaymentInfoRow
                    copied={copiedField === "amount"}
                    icon="₫"
                    label="Số tiền:"
                    value={`${formatNumber(qrPayment.amount)} đ`}
                    onCopy={() =>
                      handleCopy(String(qrPayment.amount), "amount")
                    }
                  />
                  <PaymentInfoRow
                    copied={copiedField === "content"}
                    icon="≡"
                    label="Nội dung chuyển khoản:"
                    value={qrPayment.content}
                    onCopy={() => handleCopy(qrPayment.content, "content")}
                  />
                </div>

                <button
                  className={styles.backButton}
                  type="button"
                  onClick={handleBackToForm}
                >
                  Quay lại chỉnh thông tin
                </button>
                <button
                  className={styles.statusButton}
                  type="button"
                  disabled={statusLoading}
                  onClick={() => handleCheckPaymentStatus("bank", qrPayment.id)}
                >
                  {statusLoading ? "Đang kiểm tra..." : "Kiểm tra trạng thái"}
                </button>
                {statusMessage ? (
                  <p className={styles.statusMessage} role="status">
                    {statusMessage}
                  </p>
                ) : null}
              </aside>
            </div>
          </div>
        ) : topUpMode === "card" ? (
          <div className={`${styles.arcadeBoard} ${styles.cardBoard}`}>
            <button
              className={styles.cardBackButton}
              type="button"
              onClick={handleShowBankMode}
            >
              <span aria-hidden="true">‹</span> Nạp Chuyển Khoản
            </button>

            <span className={`${styles.cardSeaDecor} ${styles.cardDolphinTop}`}>
              ☄
            </span>
            <span
              className={`${styles.cardSeaDecor} ${styles.cardDolphinLeft}`}
            >
              ✦
            </span>
            <span
              className={`${styles.cardSeaDecor} ${styles.cardDolphinRight}`}
            >
              ☾
            </span>

            <div className={`${styles.cardLayout} ${styles.cardLayoutCenter}`}>
              <div
                className={`${styles.guidedDock} ${styles.cardTopupDock}`}
                id={`${tabBaseId}-card-panel-${cardCurrency}`}
                role="tabpanel"
                aria-labelledby={`${tabBaseId}-card-${cardCurrency}`}
              >
                <div className={styles.packageHeader}>
                  <div className={styles.sectionIntro}>
                    <span className={styles.dockStep}>CARD</span>
                    <div>
                      <h2>Điền thông tin thẻ</h2>
                      <p>Mệnh giá, chiết khấu và phần nhận dự kiến.</p>
                    </div>
                  </div>

                  <div
                    className={styles.currencyIconTabs}
                    role="tablist"
                    aria-label="Loại nhận khi nạp thẻ cào"
                  >
                    {(Object.keys(currencyConfig) as CurrencyType[]).map(
                      (type) => {
                        const isActive = cardCurrency === type;
                        const config = currencyConfig[type];
                        const tabId = `${tabBaseId}-card-${type}`;
                        const panelId = `${tabBaseId}-card-panel-${type}`;

                        return (
                          <button
                            aria-controls={panelId}
                            aria-label={`Nhận ${config.label}`}
                            aria-selected={isActive}
                            className={`${styles.currencyIconTab}${
                              isActive ? ` ${styles.currencyIconTabActive}` : ""
                            }`}
                            id={tabId}
                            key={type}
                            role="tab"
                            tabIndex={isActive ? 0 : -1}
                            title={`Nhận ${config.label}`}
                            type="button"
                            onClick={() => setCardCurrency(type)}
                          >
                            <span
                              className={`${styles.currencyTabIcon}${
                                type === "star"
                                  ? ` ${styles.currencyTabIconStar}`
                                  : ""
                              }`}
                              aria-hidden="true"
                            >
                              {config.icon}
                            </span>
                            <span className={styles.visuallyHidden}>
                              {config.label}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                <form
                  className={styles.cardTopupForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCardSubmit();
                  }}
                >
                  <div className={styles.formTwin}>
                    <label className={styles.cardTopupField}>
                      <span>Chọn Loại Thẻ</span>
                      <select
                        value={cardProvider}
                        onChange={(event) =>
                          setCardProvider(event.target.value)
                        }
                      >
                        {cardProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.cardTopupField}>
                      <span>Chọn Mệnh Giá Thẻ</span>
                      <select
                        value={cardDenomination}
                        onChange={(event) =>
                          setCardDenomination(Number(event.target.value))
                        }
                      >
                        {cardDenominations.map((denomination) => (
                          <option key={denomination} value={denomination}>
                            {formatNumber(denomination)} đ
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className={styles.cardTopupSummary}>
                    <span>Mệnh giá: {formatNumber(cardDenomination)} đ</span>
                    <span>
                      Tỷ lệ:{" "}
                      {formatNumber(
                        getCurrencyRate(cardRateConfig, cardCurrency),
                      )}{" "}
                      {cardActive.receiveLabel}/1.000 đ
                    </span>
                    <strong>
                      Thực nhận: {formatNumber(cardReceiveAmount)}{" "}
                      {cardActive.receiveLabel}{" "}
                      <span className={cardIconClass} aria-hidden="true">
                        {cardActive.icon}
                      </span>
                    </strong>
                    <small>Chỉ hỗ trợ VIETTEL, MOBIFONE, VINAPHONE.</small>
                  </div>

                  <div className={styles.formTwin}>
                    <label className={styles.cardTopupField}>
                      <span className={styles.visuallyHidden}>Mã thẻ</span>
                      <input
                        aria-label="Mã thẻ"
                        inputMode="numeric"
                        placeholder="Mã thẻ"
                        value={cardCode}
                        onChange={(event) => {
                          setCardCode(event.target.value);
                          setFormError("");
                          setCardMessage("");
                        }}
                      />
                    </label>

                    <label className={styles.cardTopupField}>
                      <span className={styles.visuallyHidden}>Số seri</span>
                      <input
                        aria-label="Số seri"
                        inputMode="numeric"
                        placeholder="Số seri"
                        value={cardSerial}
                        onChange={(event) => {
                          setCardSerial(event.target.value);
                          setFormError("");
                          setCardMessage("");
                        }}
                      />
                    </label>
                  </div>

                  <LitmatchIdField
                    fieldClassName={styles.cardTopupField}
                    litmatchId={litmatchId}
                    verifiedLitmatchId={verifiedLitmatchId}
                    verifyError={verifyError}
                    onChange={handleLitmatchIdChange}
                  />

                  {formError ? (
                    <p className={styles.formError} role="alert">
                      {formError}
                    </p>
                  ) : null}

                  {cardMessage ? (
                    <p className={styles.cardMessage} role="status">
                      {cardMessage}
                    </p>
                  ) : null}

                  {cardPaymentId ? (
                    <>
                      <button
                        className={styles.statusButton}
                        type="button"
                        disabled={statusLoading}
                        onClick={() =>
                          handleCheckPaymentStatus("card", cardPaymentId)
                        }
                      >
                        {statusLoading
                          ? "Đang kiểm tra..."
                          : "Kiểm tra trạng thái giao dịch"}
                      </button>
                      {statusMessage ? (
                        <p className={styles.statusMessage} role="status">
                          {statusMessage}
                        </p>
                      ) : null}
                    </>
                  ) : null}

                  <button
                    className={styles.cardSubmitButton}
                    type="submit"
                    disabled={cardLoading || verifyLoading}
                  >
                    {cardLoading
                      ? "Đang gửi..."
                      : verifyLoading
                        ? "Đang kiểm..."
                        : "Nạp thẻ ngay"}{" "}
                    <span aria-hidden="true">✨</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.arcadeBoard}>
            <div className={`${styles.bankLayout} ${styles.bankLayoutCenter}`}>
              <div
                className={`${styles.guidedDock} ${styles.bankTopupDock}`}
                id={`${tabBaseId}-panel-${currency}`}
                role="tabpanel"
                aria-labelledby={`${tabBaseId}-${currency}`}
              >
                <div className={styles.packageHeader}>
                  <div className={styles.packageHeaderTop}>
                    <div className={styles.packageHeaderSide}>
                      <button
                        className={styles.pillLink}
                        type="button"
                        onClick={handleShowCardMode}
                      >
                        <span className={styles.pillIcon} aria-hidden="true">
                          ▥
                        </span>
                        Nạp thẻ cào
                      </button>
                    </div>

                    <div className={styles.packageHeaderSide}>
                      <button
                        className={styles.pillLink}
                        type="button"
                        onClick={handleOpenLifetimeQrModal}
                      >
                        <span className={styles.pillIcon} aria-hidden="true">
                          ∞
                        </span>
                        QR trọn đời
                      </button>
                    </div>
                  </div>

                  <div
                    className={styles.currencyIconTabs}
                    role="tablist"
                    aria-label="Loại nạp"
                  >
                    {(Object.keys(currencyConfig) as CurrencyType[]).map(
                      (type) => {
                        const config = currencyConfig[type];
                        const isActive = currency === type;
                        const tabId = `${tabBaseId}-${type}`;
                        const panelId = `${tabBaseId}-panel-${type}`;

                        return (
                          <button
                            key={type}
                            id={tabId}
                            aria-controls={panelId}
                            aria-label={`Nạp ${config.label}`}
                            aria-selected={isActive}
                            className={`${styles.currencyIconTab}${
                              isActive ? ` ${styles.currencyIconTabActive}` : ""
                            }`}
                            title={`Nạp ${config.label}`}
                            type="button"
                            role="tab"
                            tabIndex={isActive ? 0 : -1}
                            onClick={() => setCurrency(type)}
                          >
                            <span
                              className={`${styles.currencyTabIcon}${
                                type === "star"
                                  ? ` ${styles.currencyTabIconStar}`
                                  : ""
                              }`}
                              aria-hidden="true"
                            >
                              {config.icon}
                            </span>
                            <span className={styles.visuallyHidden}>
                              {config.label}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                <div
                  className={styles.packageGrid}
                  aria-label={active.packageAria}
                >
                  {packagePrices.map((price) => {
                    const isSelected = selectedPackagePrice === price;

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={`${styles.packageButton}${
                          isSelected ? ` ${styles.packageButtonSelected}` : ""
                        }`}
                        key={price}
                        type="button"
                        onClick={() => handlePackageSelect(price)}
                      >
                        <strong>
                          {formatNumber(
                            calculateReceiveAmount(
                              price,
                              currency,
                              bankRateConfig,
                            ),
                          )}{" "}
                          <span className={activeIconClass} aria-hidden="true">
                            {active.icon}
                          </span>
                        </strong>
                        <small>{formatNumber(price)} đ</small>
                      </button>
                    );
                  })}
                </div>

                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateQr();
                  }}
                >
                  <div className={styles.formTwin}>
                    <label className={styles.field}>
                      <span>Số tiền thanh toán (VND)</span>
                      <input
                        inputMode="numeric"
                        aria-label="Số tiền thanh toán"
                        value={paymentAmount ? formatNumber(paymentAmount) : ""}
                        onChange={(event) =>
                          handlePaymentChange(event.target.value)
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span>
                        Thực nhận{" "}
                        <b>
                          {active.receiveLabel}{" "}
                          <span className={activeIconClass} aria-hidden="true">
                            {active.icon}
                          </span>
                        </b>
                      </span>
                      <input
                        inputMode="numeric"
                        aria-label={active.receiveAria}
                        value={formatNumber(receiveAmount)}
                        readOnly
                      />
                    </label>
                  </div>

                  <LitmatchIdField
                    litmatchId={litmatchId}
                    verifiedLitmatchId={verifiedLitmatchId}
                    verifyError={verifyError}
                    onChange={handleLitmatchIdChange}
                  />

                  {formError ? (
                    <p className={styles.formError} role="alert">
                      {formError}
                    </p>
                  ) : null}

                  <nav className={styles.actionDock} aria-label="Hành động nạp">
                    <button
                      className={styles.submitButton}
                      type="submit"
                      disabled={paymentLoading || verifyLoading}
                    >
                      {paymentLoading
                        ? "Đang tạo..."
                        : verifyLoading
                          ? "Đang kiểm..."
                          : "Tạo mã QR"}{" "}
                      <span aria-hidden="true">⚡</span>
                    </button>
                  </nav>
                </form>
              </div>
            </div>
          </div>
        )}

        <p className={styles.footer}>© 2026 {dealerName}</p>
      </section>

      {showLifetimeQrModal ? (
        <LifetimeBankQrModal
          bankConfig={bankConfig}
          bankRateConfig={bankRateConfig}
          copiedField={copiedField}
          ctvRef={ctvRef}
          currency={lifetimeCurrency}
          error={lifetimeQrError}
          existingLifetimeQr={existingLifetimeQr}
          lifetimeQr={lifetimeQr}
          lifetimeTransferContent={lifetimeTransferContent}
          loading={lifetimeQrLoading}
          statusLoading={statusLoading}
          statusMessage={lifetimeStatusMessage}
          verifiedLitmatchId={verifiedLitmatchId}
          verifyError={verifyError}
          verifyLoading={verifyLoading}
          onCheckStatus={() =>
            handleCheckPaymentStatus(
              "lifetime-bank-qr",
              lifetimeQr?.id ?? null,
              setLifetimeStatusMessage,
            )
          }
          onClose={handleCloseLifetimeQrModal}
          onCopy={handleCopy}
          onCreate={handleCreateLifetimeQr}
          onDownloadQr={handleDownloadLifetimeQr}
          onOpenExistingQr={handleOpenExistingLifetimeQr}
          onLifetimeTransferContentChange={handleLifetimeTransferContentChange}
          onCurrencyChange={handleLifetimeCurrencyChange}
          onResetQr={handleResetLifetimeQr}
        />
      ) : null}

      {pendingUser ? (
        <VerifyIdModal
          user={pendingUser}
          onCancel={handleCancelVerify}
          onConfirm={handleConfirmVerify}
        />
      ) : null}
    </main>
  );
}
