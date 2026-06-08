import type { AdminNavCounts } from "@/lib/admin-navigation";
import { listCtvs } from "./ctv-repository";
import { getCollection } from "./mongo";
import { getLifetimeQrReport } from "./payment-repository";

export async function getAdminNavCounts(): Promise<AdminNavCounts> {
  const [
    bankPayments,
    cardPayments,
    directRecharges,
    bankQrBlacklist,
    ctvs,
    reportData,
  ] = await Promise.all([
    getCollection("bank_payments"),
    getCollection("card_payments"),
    getCollection("admin_direct_recharges"),
    getCollection("bank_qr_blacklist"),
    listCtvs(),
    getLifetimeQrReport(),
  ]);

  const [bank, card, direct, blacklist] = await Promise.all([
    bankPayments.countDocuments({}),
    cardPayments.countDocuments({}),
    directRecharges.countDocuments({}),
    bankQrBlacklist.countDocuments({}),
  ]);

  return {
    bank,
    card,
    direct,
    blacklist,
    report: reportData.summary.paymentCount,
    ctvs: ctvs.total,
  };
}
