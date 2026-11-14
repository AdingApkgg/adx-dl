import { expect, test } from "bun:test";
import { DEFAULT_COVER_PALETTE } from "../src/lib/cover-palette";
import { refreshPalette, type CachedPalette } from "./enrich-cover-palettes";

const now = Date.parse("2026-11-14T00:00:00Z");
const source = "https://example.test/bg.webp";
const cached: CachedPalette = {
  source,
  fingerprint: "a",
  checkedAt: now,
  etag: '"old"',
  palette: DEFAULT_COVER_PALETTE,
};

test("warm cache does no HTTP request or image decoding", async () => {
  const fail = async () => {
    throw Error("cache hit must not do work");
  };
  expect(
    await refreshPalette({ source, fingerprint: "a", cached, now, request: fail, extract: fail }),
  ).toBe(cached);
});

test("unchanged conditional response refreshes age without decoding", async () => {
  let headers: Headers | undefined;
  const result = await refreshPalette({
    source,
    fingerprint: "a",
    cached,
    now: now + 8 * 86400000,
    request: async (_url, init) => {
      headers = new Headers(init?.headers);
      return new Response(null, { status: 304 });
    },
    extract: async () => {
      throw Error("304 must not decode");
    },
  });
  expect(headers?.get("if-none-match")).toBe('"old"');
  expect(result.palette).toEqual(cached.palette);
  expect(result.checkedAt).toBeGreaterThan(cached.checkedAt);
});

test("a changed source fingerprint regenerates the palette immediately", async () => {
  let decoded = 0;
  const result = await refreshPalette({
    source,
    fingerprint: "b",
    cached,
    now,
    request: async () => new Response(new Uint8Array([1, 2]), { headers: { etag: '"new"' } }),
    extract: async () => {
      decoded++;
      return DEFAULT_COVER_PALETTE;
    },
  });
  expect(decoded).toBe(1);
  expect(result.fingerprint).toBe("b");
  expect(result.etag).toBe('"new"');
});

test("HTTP failure keeps a previous usable palette instead of caching a fallback", async () => {
  const result = await refreshPalette({
    source,
    fingerprint: "a",
    cached,
    now,
    force: true,
    request: async () => new Response(null, { status: 503 }),
    extract: async () => DEFAULT_COVER_PALETTE,
  });
  expect(result).toBe(cached);
});

test("oversized responses never reach the decoder", async () => {
  await expect(
    refreshPalette({
      source,
      fingerprint: "a",
      now,
      request: async () =>
        new Response(new Uint8Array(3), { headers: { "content-length": "99999999" } }),
      extract: async () => {
        throw Error("must not decode");
      },
    }),
  ).rejects.toThrow("large");
});

test("the actual decoder handles a solid image and derives a readable palette", async () => {
  const sharp = (await import("sharp")).default;
  const { extractPalette } = await import("./enrich-cover-palettes");
  const image = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 25, g: 180, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const palette = await extractPalette(image);
  expect(parseInt(palette.accent.slice(3, 5), 16)).toBeGreaterThan(
    parseInt(palette.accent.slice(1, 3), 16),
  );
});
