import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminPage from "@/components/account/AdminPage";
import { accountsOn } from "@/lib/accounts/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Owner page · ToastyFly", robots: { index: false } };

export default function Page() {
  if (!accountsOn()) redirect("/studio");
  return <AdminPage />;
}
