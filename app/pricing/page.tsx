import type { Metadata } from "next";
import Pricing from "@/components/Pricing";
import { BRAND_NAME } from "@/lib/appBrand";

export const metadata: Metadata = { title: `Pricing · ${BRAND_NAME}` };

export default function PricingPage() {
  return <Pricing />;
}
