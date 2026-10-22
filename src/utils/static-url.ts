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

/**
 * The address a browser can open a stored document at.
 *
 * Uploads are kept as paths (`/uploads/invoice.pdf`) and served by the API, so
 * a client on another origin — the web app in development, or any device —
 * cannot open one without the host in front of it. `STATIC_URL` is that public
 * address; `APP_URL` stands in when it is not configured. `null` stays `null`:
 * a record with no document must not come back with a URL that 404s.
 */
export function documentUrl(
  config: { STATIC_URL?: string; APP_URL: string },
  path: string | null | undefined,
): string | null {
  const base = (config.STATIC_URL ?? config.APP_URL).replace(/\/+$/, "");
  return staticUrl(base, path ?? null);
}
