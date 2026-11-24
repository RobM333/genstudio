import type { Metadata } from "next";
import Studio from "@/components/Studio";
import { AccountGate } from "@/components/account/Account";
import { getMode } from "@/lib/config";
import { accountsOn } from "@/lib/accounts/config";

// The studio (Home, Create, Templates, Gallery, Brand kit). Behind sign-in
// (or the shared app password before accounts are switched on); the public
// landing page lives at "/".
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Studio · GenStudio" };

export default function StudioPage() {
  const studio = <Studio mode={getMode()} />;
  return accountsOn() ? <AccountGate>{studio}</AccountGate> : studio;
}
