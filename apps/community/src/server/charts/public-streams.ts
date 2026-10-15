import { StorageError } from "../storage/errors";
/** Separate bounded pools for ZIP downloads and page assets; no waiting queue. */
export function createPublicStreamLimiter(limits = { global: 16, perIp: 2 }) {
  let total = 0;
  const ips = new Map<string, number>();
  return async (
    ip: string,
    request: Request,
    operation: () => Promise<Response>,
  ): Promise<Response> => {
    if (total >= limits.global || (ips.get(ip) ?? 0) >= limits.perIp)
      throw new StorageError(429, "STORAGE_BUSY", undefined, 2);
    total++;
    ips.set(ip, (ips.get(ip) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total--;
      const count = (ips.get(ip) ?? 1) - 1;
      if (count) ips.set(ip, count);
      else ips.delete(ip);
      request.signal.removeEventListener("abort", release);
    };
    request.signal.addEventListener("abort", release, { once: true });
    try {
      request.signal.throwIfAborted();
      const response = await operation();
      // The HTTP adapter suppresses HEAD bodies without consuming the stream.
      // Cancel error bodies here so a failed metadata HEAD cannot leak a ZIP slot.
      if (request.method === "HEAD") {
        try { await response.body?.cancel().catch(() => {}); } finally { release(); }
        return new Response(null, { status: response.status, headers: response.headers });
      }
      if (!response.body) {
        release();
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(c) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                release();
                c.close();
              } else c.enqueue(chunk.value);
            } catch (e) {
              release();
              c.error(e);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              release();
            }
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (e) {
      release();
      throw e;
    }
  };
}
