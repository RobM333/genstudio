import Studio from "@/components/Studio";
import { getMode } from "@/lib/config";

// Read the mode on every request so changing settings on Vercel takes effect.
export const dynamic = "force-dynamic";

export default function Home() {
  return <Studio mode={getMode()} />;
}
