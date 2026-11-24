import type { Metadata } from "next";
import Landing from "@/components/Landing";
import { BRAND_NAME } from "@/lib/founding";
import { accountsOn } from "@/lib/accounts/config";

// The public landing page: a wall of real results first. The studio itself
// moved to /studio (behind sign-in, or the app password before accounts).
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Pictures and video ads from one sentence`,
  description: `Scroll through real pictures and videos made with ${BRAND_NAME}, then start from a template or describe your own.`,
};

export default function Home() {
  // Invited members get a "Sign in" link once accounts are switched on.
  return <Landing signIn={accountsOn()} />;
}
