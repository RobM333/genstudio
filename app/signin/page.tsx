import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SignIn from "@/components/account/SignIn";
import { accountsOn, googleOn } from "@/lib/accounts/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · ToastyFly" };

export default function SignInPage() {
  if (!accountsOn()) redirect("/studio");
  return <SignIn google={googleOn()} />;
}
