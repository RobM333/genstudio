// Pages anyone can open without the app password. Only add pages that can't
// spend AI credit. The owner's sign-up download (/api/founding/list) stays private.
const PUBLIC_PATHS = new Set(["/", "/founding", "/api/founding", "/privacy", "/terms", "/acceptable-use", "/__forms.html", "/icon.svg"]);

// With accounts on, the sign-in page and its steps are public too (they can't spend credit):
// the emailed code, "Continue with Google" and signing in with a passkey.
// Adding a passkey is not here: that needs you to be signed in already.
const SIGN_IN_PATHS = new Set([
  "/signin",
  "/api/auth/start",
  "/api/auth/verify",
  "/api/auth/signout",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/passkey/options",
  "/api/auth/passkey/verify",
]);

// The daily job's own address. It can't spend credit and checks its own key.
const CRON_PATHS = new Set(["/api/cron/founding"]);

export function isCronPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return CRON_PATHS.has(path);
}

export function isSignInPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SIGN_IN_PATHS.has(path);
}

export function isPublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.has(path);
}
