import { describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createS3Driver } from "./s3";
import { parseStorageEnv } from "./env";
import { StorageUnavailableError } from "./errors";
const hash = "a".repeat(64);
function config(endpoint: string) {
  return parseStorageEnv(
    {
      PUBLIC_ORIGIN: "https://community.example.test",
      STORAGE_S3_ENDPOINT: endpoint,
      STORAGE_TEMP_DIR: "/storage/tmp",
      STORAGE_RECIPE_BUILD: "test",
      STORAGE_WEB_ACCESS_KEY_ID: "local-test-access",
      STORAGE_WEB_SECRET_ACCESS_KEY: "local-test-secret",
      STORAGE_INTERNAL_MEDIA_SECRET: "local-internal-secret-0123456789abcdef",
    },
    "web",
  );
}
async function localServer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
const headers = {
  "content-length": "8",
  "content-type": "image/jpeg",
  "x-amz-meta-sha256": hash,
};
const input = (key: string) => ({ bucket: "original" as const, key });
describe("S3 transport bounds", () => {
  test("slow headers hit deadline and release read permit", async () => {
    let slow = true;
    const server = await localServer((_request, response) => {
      if (slow) return;
      response.writeHead(200, headers);
      response.end();
    });
    try {
      const driver = createS3Driver(config(server.endpoint), {
        readLimit: 1,
        requestTimeoutMs: 1000,
      });
      await expect(driver.head(input("slow"))).rejects.toBeInstanceOf(StorageUnavailableError);
      slow = false;
      expect((await driver.head(input("next")))?.size).toBe(8);
    } finally {
      server.close();
    }
  });
  test("unconsumed GET reaches deadline, errors body and releases read permit", async () => {
    const server = await localServer((request, response) => {
      response.writeHead(200, headers);
      response.flushHeaders();
      if (request.method === "HEAD") response.end();
      else response.write(new Uint8Array([1]));
    });
    try {
      const driver = createS3Driver(config(server.endpoint), {
        readLimit: 1,
        requestTimeoutMs: 1000,
      });
      const read = await driver.get(input("stall"));
      await Bun.sleep(1300);
      expect((await driver.head(input("next")))?.size).toBe(8);
      await expect(new Response(read.body).arrayBuffer()).rejects.toBeInstanceOf(StorageUnavailableError);
    } finally {
      server.close();
    }
  });
  test("transport disconnects after headers trip breaker and release permits", async () => {
    const server = await localServer((request, response) => {
      response.writeHead(200, headers);
      response.flushHeaders();
      if (request.method === "HEAD") response.end();
      else {
        response.write(new Uint8Array([1]));
        setTimeout(() => response.destroy(), 40);
      }
    });
    try {
      let time = 0;
      const driver = createS3Driver(config(server.endpoint), {
        readLimit: 1,
        requestTimeoutMs: 1000,
        now: () => time,
      });
      for (let i = 0; i < 5; i++) {
        const read = await driver.get(input(`broken-${i}`));
        await expect(new Response(read.body).arrayBuffer()).rejects.toBeInstanceOf(StorageUnavailableError);
      }
      await expect(driver.head(input("blocked"))).rejects.toBeInstanceOf(StorageUnavailableError);
      time = 15_000;
      expect((await driver.head(input("probe")))?.size).toBe(8);
    } finally {
      server.close();
    }
  });
  test("PUT saturation and deadline cancel stalled source and restore write capacity", async () => {
    const server = await localServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200);
        response.end();
      });
    });
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    try {
      const driver = createS3Driver(config(server.endpoint), {
        putLimit: 1,
        requestTimeoutMs: 1000,
      });
      const put = (body: ReadableStream<Uint8Array>, size: number) =>
        driver.put({
          ...input("upload"),
          body,
          size,
          mime: "image/jpeg",
          sha256: hash,
        });
      const stalled = put(source, 8);
      await expect(put(new Blob([new Uint8Array(8)]).stream(), 8)).rejects.toBeInstanceOf(
        StorageUnavailableError,
      );
      await expect(stalled).rejects.toBeInstanceOf(StorageUnavailableError);
      await Bun.sleep(10);
      expect(cancelled).toBe(true);
      await put(new Blob([new Uint8Array(8)]).stream(), 8);
    } finally {
      server.close();
    }
  });
});
test("missing buckets are storage outages rather than missing objects", async () => {
  const server = await localServer((_request, response) => {
    response.writeHead(404, { "content-type": "application/xml" });
    response.end("<Error><Code>NoSuchBucket</Code><Message>private upstream detail</Message></Error>");
  });
  try {
    const driver = createS3Driver(config(server.endpoint), { requestTimeoutMs: 1000 });
    await expect(driver.ready()).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(driver.get(input("object"))).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(driver.head(input("object"))).rejects.toBeInstanceOf(StorageUnavailableError);
  } finally {
    server.close();
  }
});

test("list honors bounded page size and rejects invalid bounds before sending request", async () => {
  const seen: number[] = [];
  const server = await localServer((req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    seen.push(Number(new URL(req.url ?? "/", "http://localhost").searchParams.get("max-keys")));
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(
      '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated></ListBucketResult>',
    );
  });
  try {
    const driver = createS3Driver(config(server.endpoint));
    await driver.list({ ...input("unused"), prefix: "sha256/", maxKeys: 100 });
    expect(seen).toEqual([100]);
    for (const maxKeys of [0, 1001, 1.5])
      await expect(driver.list({ bucket: "original", prefix: "tmp/", maxKeys })).rejects.toThrow();
    expect(seen).toEqual([100]);
  } finally {
    server.close();
  }
});

test("first DELETE object404 is idempotent only after signed existing-bucket proof", async () => {
  const requests: { method: string; path: string; signed: boolean }[] = [];
  const server = await localServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      signed: !!request.headers.authorization,
    });
    if (request.method === "DELETE") {
      response.writeHead(404, { "content-type": "application/xml" });
      response.end("<Error><Code>NoSuchKey</Code></Error>");
    } else {
      response.writeHead(200);
      response.end();
    }
  });
  try {
    await createS3Driver(config(server.endpoint)).delete(input("absent"));
    expect(requests.map((r) => r.method)).toEqual(["DELETE", "HEAD"]);
    expect(requests.every((r) => r.signed)).toBe(true);
    expect(requests[1].path).toMatch(/^\/blobs\/?(?:\?.*)?$/);
  } finally {
    server.close();
  }
});
test("DELETE404 with missing or forbidden bucket remains a storage failure", async () => {
  for (const bucketStatus of [404, 403]) {
    const server = await localServer((request, response) => {
      if (request.method === "DELETE") {
        response.writeHead(404, { "content-type": "application/xml" });
        response.end("<Error><Code>NoSuchKey</Code></Error>");
      } else {
        response.writeHead(bucketStatus);
        response.end();
      }
    });
    try {
      await expect(
        createS3Driver(config(server.endpoint)).delete(input("absent")),
      ).rejects.toBeInstanceOf(StorageUnavailableError);
    } finally {
      server.close();
    }
  }
});
