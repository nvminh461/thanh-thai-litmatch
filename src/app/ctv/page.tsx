import { redirect } from "next/navigation";
import { getCtvSession } from "@/server/ctv-auth";
import { listCtvTransactions } from "@/server/ctv-repository";
import CtvDashboard from "./ctv-dashboard";

export const dynamic = "force-dynamic";

export default async function CtvPage() {
  const session = await getCtvSession();

  if (!session) {
    redirect("/ctv/login");
  }

  const initialTransactions = await listCtvTransactions({
    ctvId: session.id,
    page: 1,
    pageSize: 20,
    type: "all",
    status: "all",
  });

  return (
    <CtvDashboard
      profile={session}
      initialTransactions={initialTransactions}
    />
  );
}
