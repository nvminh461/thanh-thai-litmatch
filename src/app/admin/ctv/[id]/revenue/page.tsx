import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/server/admin-auth";
import { getAdminNavCounts } from "@/server/admin-nav";
import { getCtvById, listCtvTransactions } from "@/server/ctv-repository";
import CtvRevenueView from "./ctv-revenue-view";

export const dynamic = "force-dynamic";

export default async function CtvRevenuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  const { id } = await params;
  const [ctv, navCounts, initialTransactions] = await Promise.all([
    getCtvById(id),
    getAdminNavCounts(),
    listCtvTransactions({
      ctvId: id,
      page: 1,
      pageSize: 20,
      type: "all",
      status: "all",
    }),
  ]);

  if (!ctv) {
    notFound();
  }

  return (
    <CtvRevenueView
      username={session.username}
      navCounts={navCounts}
      ctv={ctv}
      initialTransactions={initialTransactions}
    />
  );
}
