import Link from "next/link";
import type { AdminNavCounts, AdminSection } from "@/lib/admin-navigation";
import { adminSectionHref } from "@/lib/admin-navigation";
import styles from "./admin.module.css";

type AdminSidebarProps = {
  username: string;
  activeSection: AdminSection;
  counts: AdminNavCounts;
};

const numberFormatter = new Intl.NumberFormat("vi-VN");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

const NAV_ITEMS: Array<{
  section: AdminSection;
  label: string;
  countKey?: keyof AdminNavCounts;
}> = [
  { section: "bank", label: "Giao dịch chuyển khoản", countKey: "bank" },
  { section: "card", label: "Giao dịch nạp thẻ", countKey: "card" },
  { section: "direct", label: "Nạp trực tiếp", countKey: "direct" },
  {
    section: "blacklist",
    label: "Danh sách đen giao dịch",
    countKey: "blacklist",
  },
  { section: "report", label: "Báo cáo thống kê", countKey: "report" },
  { section: "ctv", label: "Quản lý CTV", countKey: "ctvs" },
  { section: "settings", label: "Cấu hình hệ thống" },
];

export default function AdminSidebar({
  username,
  activeSection,
  counts,
}: AdminSidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="Điều hướng quản trị">
      <div className={styles.sidebarBrand}>
        <p className={styles.kicker}>Quản trị Thành Thái</p>
        <strong>Admin</strong>
        <span>{username}</span>
      </div>

      <nav className={styles.sidebarNav}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.section}
            className={`${styles.sidebarButton} ${
              activeSection === item.section ? styles.sidebarButtonActive : ""
            }`}
            href={adminSectionHref(item.section)}
          >
            <span>{item.label}</span>
            {item.countKey ? (
              <small>{formatNumber(counts[item.countKey])}</small>
            ) : null}
          </Link>
        ))}
      </nav>

      <form action="/api/admin/logout" method="post">
        <button className={styles.secondaryButton} type="submit">
          Đăng xuất
        </button>
      </form>
    </aside>
  );
}
