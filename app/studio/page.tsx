import type { Metadata } from "next";
import Studio from "@/components/Studio";
import { getMode } from "@/lib/config";

// The studio (Home, Create, Templates, Gallery, Brand kit). Behind the app
// password; the public landing page lives at "/".
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Studio · GenStudio" };

export default function StudioPage() {
  return <Studio mode={getMode()} />;
}
