// Pages anyone can open without the app password. Only add pages that can't
// spend AI credit. The owner's sign-up download (/api/founding/list) stays private.
const PUBLIC_PATHS = new Set(["/", "/founding", "/api/founding", "/privacy", "/terms", "/acceptable-use", "/__forms.html", "/icon.svg"]);

// With accounts on, the sign-in page and its two steps are public too (they can't spend credit).
const SIGN_IN_PATHS = new Set(["/signin", "/api/auth/start", "/api/auth/verify", "/api/auth/signout"]);

export function isSignInPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SIGN_IN_PATHS.has(path);
}

export function isPublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.has(path);
}
