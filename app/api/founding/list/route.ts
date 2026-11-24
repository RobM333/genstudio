import { NextResponse } from "next/server";
import { listSignups } from "@/lib/foundingStore";
import { TOTAL_SPOTS } from "@/lib/founding";
import { accountsOn } from "@/lib/accounts/config";
import { currentUser } from "@/lib/accounts/current";

// The owner's download of everyone who signed up, as a spreadsheet file (CSV).
// Behind the app password, like the rest of the app. Refuses to run when no
// password is set, so the list is never public.

export const dynamic = "force-dynamic";

const cell = (v: string) => `"${v.replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;

export async function GET(req: Request) {
  if (accountsOn()) {
    // With accounts on, only the owner (signed in) can download it.
    if (!(await currentUser(req))?.admin) return NextResponse.json({ error: "Only the owner can download this." }, { status: 403 });
  } else if (!process.env.APP_PASSWORD?.trim()) {
    return NextResponse.json({ error: "Set APP_PASSWORD first. The sign-up list is only shown behind the app password." }, { status: 403 });
  }
  const rows = await listSignups();
  const lines = [
    ["Number", "Founding spot", "Signed up (UTC)", "Email", "First name", "Wants to make"].map(cell).join(","),
    ...rows.map((r, i) =>
      [String(i + 1), i < TOTAL_SPOTS ? "Yes" : "Waitlist", r.at.replace("T", " ").slice(0, 16), r.email, r.name, r.makes].map(cell).join(","),
    ),
  ];
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="founding-signups.csv"',
      "Cache-Control": "no-store",
    },
  });
}
