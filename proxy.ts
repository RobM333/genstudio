import { NextResponse, type NextRequest } from "next/server";
import { isCronPath, isPublicPath, isSignInPath } from "./lib/publicPaths";
import { accountsOn } from "./lib/accounts/config";
import { readSession, SESSION_COOKIE } from "./lib/accounts/session";

// The gate in front of the app. Keeps strangers from spending fal.ai credit.
//
// With accounts on (see lib/accounts/config.ts), each person signs in with
// their email. Anyone not signed in is sent to the sign-in page, and the app's
// own requests get a "please sign in" answer.
//
// Before that, when APP_PASSWORD is set, the browser asks for the shared
// password before showing the app (any username works).
//
// A few pages are public so people can sign up before the app opens: the
// founding sign-up page, its small API, the policies it links to, and the
// Netlify Forms copy of the sign-up form (see lib/publicPaths.ts). Nothing
// public can spend credit.
export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isPublicPath(path) || isCronPath(path)) return NextResponse.next();

  if (accountsOn()) {
    if (isSignInPath(path)) return NextResponse.next();
    if (readSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Please sign in.", signIn: true }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    if (path !== "/signin") url.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (isSignInPath(path)) return NextResponse.redirect(new URL("/studio", req.url));

  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(given, password)) return NextResponse.next();
    } catch {
      // fall through to the login prompt
    }
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ToastyFly", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|showcase/|brand/).*)"],
};
