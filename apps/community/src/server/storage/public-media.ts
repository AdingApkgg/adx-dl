import { and, eq } from "drizzle-orm";
import { derivedObjects, mediaPublications } from "../db/schema";
import type { StorageContext } from "./contracts";
import type { MediaDrain, MediaRegistration } from "./drain";
import { hasPublicRepresentation } from "./references";
import { mediaDenial, representationResponse } from "./files";
/** Raw URL validation is reusable without auth or normal app bootstrap. */
export function canonicalMediaHash(request: Request, rawTarget?: string): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const raw = rawTarget ?? request.url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  const match = /^\/media\/([0-9a-f]{64})\.jpg$/.exec(raw);
  return match?.[1] ?? null;
}
/** Route encoded aliases into canonical denial before session or page middleware. */
export function isMediaRequest(request: Request, rawTarget?: string): boolean {
  const urlPath = request.url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  return [rawTarget ?? urlPath, urlPath].some((target) => {
    const raw = target.split(/[?#]/, 1)[0];
    let path = raw;
    try {
      path = decodeURIComponent(raw);
    } catch {
      /* canonical handler denies malformed encoding */
    }
    return (
      raw === "/media" ||
      raw.startsWith("/media/") ||
      path === "/media" ||
      path.startsWith("/media/")
    );
  });
}
export function createPublicMediaHandler(ctx: StorageContext, drain: MediaDrain) {
  return async (request: Request, rawTarget?: string): Promise<Response> => {
    const hash = canonicalMediaHash(request, rawTarget);
    if (!hash) return mediaDenial();
    // Registration precedes every asynchronous permission lookup.
    let ticket: MediaRegistration | null;
    try {
      ticket = drain.register(hash);
    } catch {
      return mediaDenial(503, "STORAGE_UNAVAILABLE");
    }
    if (!ticket) return mediaDenial();
    const signal = AbortSignal.any([request.signal, ticket.signal]);
    let stream = false;
    try {
      const [row] = await ctx.db
        .select({ output: derivedObjects })
        .from(mediaPublications)
        .innerJoin(derivedObjects, eq(derivedObjects.outputSha256, mediaPublications.outputSha256))
        .where(
          and(
            eq(mediaPublications.outputSha256, hash),
            eq(mediaPublications.state, "public"),
            eq(derivedObjects.state, "ready"),
          ),
        );
      if (
        signal.aborted ||
        !row ||
        !(await hasPublicRepresentation(ctx.db, hash)) ||
        signal.aborted
      )
        return mediaDenial();
      const output = row.output;
      const response = await representationResponse(
        ctx,
        { bucket: "derived", key: output.key, size: output.size, mime: output.mime, sha256: hash },
        request,
        signal,
        ticket.release,
        true,
      );
      stream = response.body !== null && response.status < 300;
      return response;
    } catch {
      return mediaDenial(503, "STORAGE_UNAVAILABLE");
    } finally {
      if (!stream) ticket.release();
    }
  };
}
