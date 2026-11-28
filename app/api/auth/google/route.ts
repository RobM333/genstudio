import { NextResponse } from "next/server";
import { googleOn } from "@/lib/accounts/config";
import { GOOGLE_COOKIE, startGoogle } from "@/lib/accounts/google";
import { isHttps, safeNext } from "@/lib/accounts/signin";

export const dynamic = "force-dynamic";

// "Continue with Google": off to Google's own sign-in page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleOn()) return NextResponse.redirect(new URL("/signin", url));
  const { url: to, cookie } = startGoogle(url.origin, safeNext(url.searchParams.get("next")));
  const res = NextResponse.redirect(to);
  res.cookies.set(GOOGLE_COOKIE, cookie, { httpOnly: true, secure: isHttps(req), sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
