export type AdminSection =
  | "bank"
  | "card"
  | "direct"
  | "blacklist"
  | "report"
  | "ctv"
  | "settings";

export type AdminNavCounts = {
  bank: number;
  card: number;
  direct: number;
  blacklist: number;
  report: number;
  ctvs: number;
};

const ADMIN_SECTIONS: AdminSection[] = [
  "bank",
  "card",
  "direct",
  "blacklist",
  "report",
  "ctv",
  "settings",
];

export function parseAdminSection(value: string | undefined): AdminSection | null {
  if (!value) {
    return null;
  }

  return ADMIN_SECTIONS.includes(value as AdminSection)
    ? (value as AdminSection)
    : null;
}

export function adminSectionHref(section: AdminSection) {
  return `/admin?section=${section}`;
}
