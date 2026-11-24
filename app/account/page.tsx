import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountPage from "@/components/account/AccountPage";
import { accountsOn } from "@/lib/accounts/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account · ToastyFly" };

export default function Page() {
  if (!accountsOn()) redirect("/studio");
  return <AccountPage />;
}
