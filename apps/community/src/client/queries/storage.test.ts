import { expect, test } from "bun:test";
import { createApiClient } from "@/shared/api-client";
import { storageApi, uploadQuery, fileQuery } from "./storage";
test("actual hc adapter sends stable replay keys, binary Blob and JSON CSRF headers", async () => {
  const requests: Request[] = [];
  let lost = true;
  const api = storageApi(
    createApiClient("https://community.test", {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        requests.push(req);
        if (req.method === "POST" && req.url.endsWith("/uploads")) {
          if (lost) {
            lost = false;
            throw new TypeError("lost response after commit");
          }
          return Response.json({ id: "upload", state: "receiving" });
        }
        if (req.url.endsWith("/complete")) return Response.json({ id: "upload", state: "processing" });
        return new Response(null, { status: 204 });
      },
    }),
  );
  const signal = new AbortController().signal;
  await api.init({ purpose: "avatar", name: "a.png", size: 3, sha256: "a".repeat(64) }, "stable-key", signal);
  await api.part("upload", 0, new Blob(["abc"]), "b".repeat(64), signal);
  await api.complete("upload", signal);
  await api.cancel("upload");
  await api.deleteFile("file");
  expect(requests[0]!.headers.get("idempotency-key")).toBe("stable-key");
  expect(requests[1]!.headers.get("idempotency-key")).toBe("stable-key");
  expect(await requests[0]!.text()).toBe(await requests[1]!.text());
  expect(requests[2]!.headers.get("content-type")).toBe("application/octet-stream");
  expect(requests[2]!.headers.get("x-part-sha256")).toBe("b".repeat(64));
  expect(await requests[2]!.text()).toBe("abc");
  expect(requests[2]!.headers.has("content-length")).toBe(false);
  for (const req of requests.slice(3)) expect(req.headers.get("content-type")).toBe("application/json");
  expect([...uploadQuery(api, "u").queryKey]).toEqual(["me", "uploads", "u"]);
  expect([...fileQuery(api, "f").queryKey]).toEqual(["me", "files", "f"]);
});
