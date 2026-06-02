import { redirect } from "next/navigation";
import { getAdminSession } from "@/server/admin-auth";
import { toAdminRuntimeConfigForm } from "@/server/admin-view";
import {
  getLifetimeQrReport,
  listDirectAdminRecharges,
  listBankQrBlacklist,
  listBankPayments,
  listCardPayments,
} from "@/server/payment-repository";
import { getRuntimeConfig } from "@/server/runtime-config";
import AdminDashboard from "./admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  const [
    runtimeConfig,
    bankPayments,
    cardPayments,
    lifetimeQrReport,
    directRecharges,
    bankQrBlacklist,
  ] =
    await Promise.all([
      getRuntimeConfig(),
      listBankPayments(),
      listCardPayments(),
      getLifetimeQrReport(),
      listDirectAdminRecharges(),
      listBankQrBlacklist(),
    ]);

  return (
    <AdminDashboard
      username={session.username}
      initialConfig={toAdminRuntimeConfigForm(runtimeConfig)}
      bankPayments={bankPayments}
      cardPayments={cardPayments}
      lifetimeQrReport={lifetimeQrReport}
      directRecharges={directRecharges}
      bankQrBlacklist={bankQrBlacklist}
    />
  );
}
