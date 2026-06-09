import { redirect } from "next/navigation";
import { parseAdminSection } from "@/lib/admin-navigation";
import { getAdminSession } from "@/server/admin-auth";
import { toAdminRuntimeConfigForm } from "@/server/admin-view";
import {
  getLifetimeQrReport,
  listDirectAdminRecharges,
  listBankQrBlacklist,
  listBankPayments,
  listCardPayments,
} from "@/server/payment-repository";
import { listCtvs } from "@/server/ctv-repository";
import { getRuntimeConfig } from "@/server/runtime-config";
import AdminDashboard from "./admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const initialSection = parseAdminSection(params.section) ?? "bank";

  const [
    runtimeConfig,
    bankPayments,
    cardPayments,
    lifetimeQrReport,
    directRecharges,
    bankQrBlacklist,
    ctvs,
  ] =
    await Promise.all([
      getRuntimeConfig(),
      listBankPayments(),
      listCardPayments(),
      getLifetimeQrReport(),
      listDirectAdminRecharges(),
      listBankQrBlacklist(),
      listCtvs(),
    ]);

  return (
    <AdminDashboard
      username={session.username}
      initialSection={initialSection}
      initialConfig={toAdminRuntimeConfigForm(runtimeConfig)}
      bankPayments={bankPayments}
      cardPayments={cardPayments}
      lifetimeQrReport={lifetimeQrReport}
      directRecharges={directRecharges}
      bankQrBlacklist={bankQrBlacklist}
      ctvs={ctvs}
    />
  );
}
