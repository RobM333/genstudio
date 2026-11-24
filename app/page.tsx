import type { Metadata } from "next";
import Landing from "@/components/Landing";
import { BRAND_NAME } from "@/lib/founding";

// The public landing page: a wall of real results first. The studio itself
// moved to /studio (still behind the app password).
export const metadata: Metadata = {
  title: `${BRAND_NAME} · Pictures and video ads from one sentence`,
  description: `Scroll through real pictures and videos made with ${BRAND_NAME}, then start from a template or describe your own.`,
};

export default function Home() {
  return <Landing />;
}
