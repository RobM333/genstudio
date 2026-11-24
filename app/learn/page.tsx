import type { Metadata } from "next";
import LearnPage from "@/components/LearnPage";

export const metadata: Metadata = { title: "What we've learned · ToastyFly", robots: { index: false } };

export default function Learn() {
  return <LearnPage />;
}
