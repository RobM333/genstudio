import { NextResponse } from "next/server";
import { googleOn } from "@/lib/accounts/config";
import { checkClaims, exchangeCode, GOOGLE_COOKIE, readGoogleCookie } from "@/lib/accounts/google";
import { signInWithEmail } from "@/lib/accounts/store";
import { cookieFrom } from "@/lib/accounts/session";
import { setSignedIn } from "@/lib/accounts/signin";

export const dynamic = "force-dynamic";

// Google sends the person back here. Same invite-only rules as the emailed code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: Record<string, string>) => {
    const to = new URL("/signin", url);
    for (const [k, v] of Object.entries(q)) to.searchParams.set(k, v);
    const res = NextResponse.redirect(to);
    res.cookies.set(GOOGLE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/auth/google", maxAge: 0 });
    return res;
  };
  if (!googleOn()) return back({});
  // They pressed Cancel on Google's page.
  if (url.searchParams.get("error")) return back({ google: "cancelled" });

  const flow = readGoogleCookie(cookieFrom(req.headers.get("cookie"), GOOGLE_COOKIE));
  const code = url.searchParams.get("code");
  if (!flow || !code || url.searchParams.get("state") !== flow.state) return back({ google: "again" });

  const claims = await exchangeCode(code, flow.verifier, url.origin);
  const checked = claims ? checkClaims(claims, flow.nonce) : null;
  if (!checked?.ok) {
    if (checked && !checked.ok) console.error("google sign-in refused:", checked.why);
    return back({ google: "again" });
  }

  const r = await signInWithEmail(checked.email, "google");
  if (!r) return back({ google: "not-invited", email: checked.email });

  const done = new URL("/signin", url);
  done.searchParams.set("signedin", "google");
  done.searchParams.set("next", flow.next);
  if (r.user.passkeys?.length) done.searchParams.set("pk", "1");
  const res = await setSignedIn(req, NextResponse.redirect(done), r.user);
  res.cookies.set(GOOGLE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/auth/google", maxAge: 0 });
  return res;
}
