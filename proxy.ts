import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./lib/publicPaths";

// Simple password gate. When APP_PASSWORD is set, the browser asks for it
// before showing the app (any username works). Keeps strangers from
// spending your fal.ai credit.
//
// A few pages are public so people can sign up before the app opens: the
// founding sign-up page, its small API, the policies it links to, and the
// Netlify Forms copy of the sign-up form (see lib/publicPaths.ts). Nothing
// public can spend credit.
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.next();
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

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
    headers: { "WWW-Authenticate": 'Basic realm="GenStudio", charset="UTF-8"' },
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
