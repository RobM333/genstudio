import type { Metadata } from "next";
import Studio from "@/components/Studio";
import { getMode } from "@/lib/config";
import { BRAND_NAME } from "@/lib/appBrand";

// The studio (Home, Create, Templates, Gallery, Brand kit). Behind the app
// password; the public landing page lives at "/".
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `Studio · ${BRAND_NAME}` };

export default function StudioPage() {
  return <Studio mode={getMode()} />;
}
