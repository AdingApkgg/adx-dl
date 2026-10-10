import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { mediaPublications } from "../db/schema";
import { hasPublicRepresentation } from "./references";
import { STORAGE_LIMITS } from "./rules";
import { StorageUnavailableError } from "./errors";
import { withStorageTransaction } from "./transactions";
const hashPattern = /^[0-9a-f]{64}$/;
const denied = () =>
  Response.json(
    { error: { code: "NOT_FOUND", message: "NOT_FOUND" } },
    { status: 404, headers: { "cache-control": "private, no-store" } },
  );
export type MediaRegistration = { signal: AbortSignal; release(): void };
export type MediaDrain = {
  shutdown(): void;
  register(hash: string): MediaRegistration | null;
  drain(hash: string, generation: number): Promise<{ generation: number; drained: true }>;
  resume(hash: string, generation: number): Promise<boolean>;
  handle(request: Request): Promise<Response>;
};
export function createMediaDrain({ db, secret }: { db: Db; secret: string }): MediaDrain {
  const latches = new Map<string, number>();
  let registrations = 0;
  let closed = false;
  const active = new Map<string, Set<AbortController>>();
  // Resume's async PG check and drain's synchronous admission update share this epoch.
  const epochs = new Map<string, number>();
  const api: MediaDrain = {
    shutdown() { closed = true; for(const controllers of active.values()) for(const controller of [...controllers]) controller.abort(); },
    register(hash) {
      if (closed || latches.has(hash)) return null;
      if (registrations >= STORAGE_LIMITS.readConcurrency) throw new StorageUnavailableError();
      registrations++;
      const controller = new AbortController();
      let released = false;
      const set = active.get(hash) ?? new Set<AbortController>();
      active.set(hash, set);
      set.add(controller);
      const release = () => {
        if (released) return;
        released = true;
        registrations--;
        set.delete(controller);
        if (!set.size) active.delete(hash);
        controller.signal.removeEventListener("abort", release);
      };
      controller.signal.addEventListener("abort", release, { once: true });
      return { signal: controller.signal, release };
    },
    async drain(hash, generation) {
      if (!hashPattern.test(hash) || !Number.isSafeInteger(generation) || generation < 0)
        throw new Error("Invalid drain generation");
      return withStorageTransaction(db, async (tx) => {
        // Publication transitions and this local admission boundary serialize
        // on the same row. A delayed SELECT cannot latch a newer generation.
        const [pub] = await tx
          .select()
          .from(mediaPublications)
          .where(eq(mediaPublications.outputSha256, hash))
          .for("update");
        if (
          !pub ||
          pub.generation !== generation ||
          !(pub.state === "revoking" || pub.state === "blocked")
        )
          throw new Error("Stale drain");
        latches.set(hash, Math.max(generation, latches.get(hash) ?? 0));
        epochs.set(hash, (epochs.get(hash) ?? 0) + 1);
        // Abort dispatch is synchronous; never await stream/network cancellation
        // while holding the publication row or maintenance admission locks.
        for (const controller of [...(active.get(hash) ?? [])]) controller.abort();
        return { generation, drained: true as const };
      });
    },
    async resume(hash, generation) {
      const epoch = epochs.get(hash) ?? 0;
      const latch = latches.get(hash);
      if (latch !== undefined && generation <= latch) return false;
      const [pub] = await db
        .select()
        .from(mediaPublications)
        .where(
          and(
            eq(mediaPublications.outputSha256, hash),
            eq(mediaPublications.generation, generation),
            eq(mediaPublications.state, "public"),
          ),
        );
      if (!pub || !(await hasPublicRepresentation(db, hash)) || (epochs.get(hash) ?? 0) !== epoch)
        return false;
      latches.delete(hash);
      return true;
    },
    async handle(request) {
      const supplied = request.headers.get("authorization") ?? "",
        expected = `Bearer ${secret}`;
      const suppliedBytes = Buffer.from(supplied),
        expectedBytes = Buffer.from(expected);
      if (
        suppliedBytes.length !== expectedBytes.length ||
        !timingSafeEqual(suppliedBytes, expectedBytes)
      )
        return denied();
      const url = new URL(request.url);
      if (
        request.method !== "POST" ||
        url.search ||
        request.url.includes("?") ||
        !["/internal/media/drain", "/internal/media/resume"].includes(url.pathname)
      )
        return denied();
      try {
        // Internal control JSON is tiny and bounded even without a declared length.
        const reader = request.body?.getReader();
        let text = "",
          count = 0;
        if (reader)
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            count += value.length;
            if (count > 1024) {
              await reader.cancel();
              return denied();
            }
            text += new TextDecoder().decode(value);
          }
        const body = JSON.parse(text);
        if (
          !hashPattern.test(body.hash) ||
          !Number.isSafeInteger(body.generation) ||
          body.generation < 0 ||
          Object.keys(body).sort().join(",") !== "generation,hash"
        )
          return denied();
        const result = url.pathname.endsWith("/drain")
          ? await api.drain(body.hash, body.generation)
          : { generation: body.generation, resumed: await api.resume(body.hash, body.generation) };
        if ("resumed" in result && !result.resumed) return denied();
        return Response.json(result, { headers: { "cache-control": "private, no-store" } });
      } catch {
        return denied();
      }
    },
  };
  return api;
}
