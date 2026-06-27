/**
 * Shared SWR fetchers. SWR is the project's standard client-side data layer:
 * every runtime (browser) read of dynamic data goes through `useSWR` so we get
 * request dedup, focus/interval revalidation and a shared cache for free. The
 * site itself is a static export, so there is no server runtime here — these
 * only ever run in the browser.
 */

/** Thrown by the fetchers below so callers can branch on the HTTP status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

/** Default fetcher: GET a URL and parse JSON. Used as the SWRConfig fallback. */
export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

/** GET a URL and return the raw text body (e.g. simai/maidata charts). */
export async function textFetcher(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}
