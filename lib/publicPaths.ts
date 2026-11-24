// Pages anyone can open without the app password. Only add pages that can't
// spend AI credit. The owner's sign-up download (/api/founding/list) stays private.
const PUBLIC_PATHS = new Set(["/", "/founding", "/api/founding", "/privacy", "/terms", "/acceptable-use", "/__forms.html", "/icon.svg"]);

export function isPublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.has(path);
}
