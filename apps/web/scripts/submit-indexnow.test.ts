import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "bun:test";
import { readCatalogEntries } from "@/lib/catalog";
import { buildIndexNowUrlList, selectIndexNowPreviewSlugs, type IndexNowPayload } from "@/lib/indexnow";
import { entrySlug } from "@/lib/route-slug";

test("submission CLI includes preview pages and sends every bounded batch even if one is rejected", async () => {
  const payloads: IndexNowPayload[] = [];
  const server = createServer(async (request, response) => {
    const body: Buffer[] = [];
    for await (const chunk of request) body.push(Buffer.from(chunk));
    payloads.push(JSON.parse(Buffer.concat(body).toString()));
    response.writeHead(payloads.length === 1 ? 500 : 200).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  try {
    const proc = spawn(process.execPath, ["run", "scripts/submit-indexnow.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, INDEXNOW_ENDPOINT: `http://127.0.0.1:${address.port}/indexnow`, INDEXNOW_SITE_URL: "https://adxdls.saop.cc", INDEXNOW_KEY: "integration-key", INDEXNOW_BASE_REF: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const [code] = await once(proc, "exit");
    expect(code).toBe(0);
    const entries = await readCatalogEntries();
    const expected = buildIndexNowUrlList("https://adxdls.saop.cc", entries.map(entrySlug), selectIndexNowPreviewSlugs(entries, [], true));
    expect(payloads.flatMap((payload) => payload.urlList)).toEqual(expected);
    expect(payloads.length).toBe(Math.ceil(expected.length / 10000));
    expect(payloads.every((payload) => payload.urlList.length <= 10000 && payload.key === "integration-key")).toBe(true);
    expect(stdout).toContain("preview URLs");
    expect(stderr).toContain("status 500");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
