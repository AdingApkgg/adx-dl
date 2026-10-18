import { expect, test } from "bun:test";
import { createApiClient } from "@/shared/api-client";
import { socialApi } from "./community-social";
test("bodyless favorite writes satisfy the existing JSON CSRF contract", async () => {
  const requests: { method: string; contentType: string | null; cache: RequestCache | undefined }[] = [];
  const api = createApiClient("https://community.test", { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, contentType: request.headers.get("content-type"), cache: init?.cache });
    return Response.json({ favorited: request.method === "PUT" });
  } });
  await socialApi(api).addFavorite("1"); await socialApi(api).removeFavorite("1");
  expect(requests).toEqual([{ method: "PUT", contentType: "application/json", cache: "no-store" }, { method: "DELETE", contentType: "application/json", cache: "no-store" }]);
});
