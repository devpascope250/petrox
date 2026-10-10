/**
 * The address a stored upload is served at. Files are stored as paths
 * (`/uploads/plate-….png`) so the database does not depend on the domain;
 * this puts `STATIC_URL` in front for clients that need a full URL, such as
 * the POS. A path that is already a full URL, or no `STATIC_URL`, is left as is.
 */
export function staticUrl(base: string | undefined, path: string | null): string | null {
  if (!path) return null;
  if (!base || /^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}
