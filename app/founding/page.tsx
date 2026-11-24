import type { Metadata } from "next";
import Founding from "@/components/Founding";
import { BRAND_NAME, TOTAL_SPOTS } from "@/lib/founding";

export const metadata: Metadata = {
  title: `Founding ${TOTAL_SPOTS} · ${BRAND_NAME}`,
  description: `Claim one of ${TOTAL_SPOTS} founding spots in ${BRAND_NAME}: a free month of the Creator plan and a founding price after that.`,
};

export default function FoundingPage() {
  return <Founding />;
}
