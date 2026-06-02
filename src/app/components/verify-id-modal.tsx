"use client";

import styles from "../page.module.css";
import { buildLitmatchAvatarUrl } from "@/lib/litmatch-avatar";

export type VerifiedUserInfo = {
  targetUid: string;
  nickname: string;
  bio: string;
  avatar?: string;
};

type VerifyIdModalProps = {
  user: VerifiedUserInfo;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function VerifyIdModal({
  user,
  onConfirm,
  onCancel,
}: VerifyIdModalProps) {
  const avatarUrl = buildLitmatchAvatarUrl(user.avatar);
  const initial = user.nickname.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={styles.verifyModalOverlay} role="presentation">
      <div
        className={styles.verifyModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-modal-title"
      >
        <p className={styles.verifyModalEyebrow}>Xác minh ID Litmatch</p>

        <div className={styles.verifyModalProfile}>
          <div className={styles.verifyModalAvatarWrap}>
            <span className={styles.verifyModalAvatarFallback} aria-hidden="true">
              {initial}
            </span>
            {avatarUrl ? (
              <img
                className={styles.verifyModalAvatar}
                src={avatarUrl}
                alt={`Avatar của ${user.nickname}`}
                width={88}
                height={88}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}
          </div>
          <h2 className={styles.verifyModalTitle} id="verify-modal-title">
            {user.nickname}
          </h2>
          <p className={styles.verifyModalId}>
            <span>ID Litmatch</span>
            <strong>{user.targetUid}</strong>
          </p>
        </div>

        {user.bio ? (
          <div className={styles.verifyModalBioCard}>
            <p className={styles.verifyModalBio}>{user.bio}</p>
          </div>
        ) : null}
        <p className={styles.verifyModalHint}>
          Vui lòng xác nhận đúng tài khoản trước khi tiếp tục nạp.
        </p>
        <div className={styles.verifyModalActions}>
          <button
            className={styles.verifyModalCancel}
            type="button"
            onClick={onCancel}
          >
            Hủy
          </button>
          <button
            className={styles.verifyModalConfirm}
            type="button"
            onClick={onConfirm}
          >
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  );
}
