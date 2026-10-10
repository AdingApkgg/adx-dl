import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processAvatar } from "./avatar";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "avatar-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
const fixture = (name: string) =>
  join(import.meta.dir, "../../test/storage/images", name);
for (const name of [
  "safe.jpeg",
  "safe.png",
  "safe.webp",
  "safe.avif",
  "own-cmyk.jpg",
  "own-gps-orientation6.jpg",
  "transparent.png",
  "oriented.jpg",
  "iptc.jpeg",
]) {
  test(`bounded recipe accepts ${name}`, async () => {
    const output = join(dir, `${name}.jpg`);
    const result = await processAvatar(fixture(name), output);
    expect(result).toMatchObject({
      width: 512,
      height: 512,
      mime: "image/jpeg",
    });
    expect(result.size).toBeLessThanOrEqual(524288);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });
}
for (const name of [
  "animated-own.apng",
  "animated.webp",
  "colors-animated-8bpc.avif",
]) {
  test(`reject actual animation ${name}`, async () => {
    await expect(
      processAvatar(fixture(name), join(dir, `${name}.jpg`)),
    ).rejects.toMatchObject({ code: "ANIMATED_IMAGE_NOT_ALLOWED" });
  });
}

for (const [name, code] of [
  ["own-solid-rgb32.heic", "TYPE_NOT_ALLOWED"],
  ["corrupt.jpg", "IMAGE_INVALID"],
  ["truncated.jpg", "IMAGE_INVALID"],
  ["pixel-excess.png", "IMAGE_TOO_LARGE"],
  ["side-excess.png", "IMAGE_TOO_LARGE"],
  ["animated.gif", "TYPE_NOT_ALLOWED"],
]) {
  test(`reject ${name} with ${code}`, async () => {
    await expect(
      processAvatar(fixture(name), join(dir, `${name}.jpg`)),
    ).rejects.toMatchObject({ code });
  });
}
test("disguised SVG rejects by real bytes", async () => {
  const path = join(dir, "svg.jpg");
  await Bun.write(
    path,
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
  );
  await expect(
    processAvatar(path, join(dir, "svg-output.jpg")),
  ).rejects.toMatchObject({ code: "TYPE_NOT_ALLOWED" });
});
test("recipe strips actual EXIF/ICC/XMP/IPTC, rotates, crops, and flattens white", async () => {
  const sharp = (await import("sharp")).default;
  for (const name of [
    "oriented.jpg",
    "iptc.jpeg",
    "transparent.png",
    "safe.png",
  ]) {
    const input = await sharp(fixture(name)).metadata();
    if (name === "oriented.jpg") {
      expect(input.orientation).toBe(6);
      expect(input.exif).toBeDefined();
      expect(input.icc).toBeDefined();
      expect(input.xmp).toBeDefined();
    }
    if (name === "iptc.jpeg") expect(input.iptc).toBeDefined();
    const out = join(dir, `metadata-${name}.jpg`);
    await processAvatar(fixture(name), out);
    const m = await sharp(out).metadata();
    expect(m).toMatchObject({
      format: "jpeg",
      width: 512,
      height: 512,
      space: "srgb",
      hasAlpha: false,
      isProgressive: false,
    });
    for (const key of ["exif", "xmp", "iptc", "icc"] as const)
      expect(m[key]).toBeUndefined();
    const { data, info } = await sharp(out)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [
      ...data.subarray(
        (y * 512 + x) * info.channels,
        (y * 512 + x) * info.channels + 3,
      ),
    ];
    if (name === "transparent.png")
      expect(pixel(256, 256)).toEqual([255, 255, 255]);
    if (name === "oriented.jpg") {
      expect(pixel(128, 256)[2]).toBeGreaterThan(240);
      expect(pixel(384, 256)[0]).toBeGreaterThan(240);
    }
    if (name === "safe.png")
      for (const [x, y] of [
        [10, 10],
        [256, 256],
        [500, 500],
      ])
        expect(pixel(x, y)[1]).toBeGreaterThan(245);
  }
});
test("BMFF normal and extended boxes are bounded and inspect every compatible brand", async () => {
  const { inspectContainer } = await import("./image-child");
  for (const extended of [false, true]) {
    const start = extended ? 16 : 8;
    const b = Buffer.alloc(start + 16);
    b.writeUInt32BE(extended ? 1 : b.length);
    b.write("ftyp", 4);
    if (extended) b.writeBigUInt64BE(BigInt(b.length), 8);
    b.write("avif", start);
    b.write("mif1", start + 8);
    b.write("avis", start + 12);
    const path = join(dir, `brands-${extended}`);
    await Bun.write(path, b);
    await expect(inspectContainer(path)).rejects.toMatchObject({
      code: "ANIMATED_IMAGE_NOT_ALLOWED",
    });
    b.write("avif", start + 12);
    await Bun.write(path, b);
    expect(await inspectContainer(path)).toBe("heif");
    if (extended) b.writeBigUInt64BE(2n ** 63n, 8);
    else b.writeUInt32BE(4100);
    await Bun.write(path, b);
    await expect(inspectContainer(path)).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });
  }
  for (const length of [0, 8, 17, 4100]) {
    const b = Buffer.alloc(Math.max(length, 16));
    b.writeUInt32BE(length);
    b.write("ftyp", 4);
    b.write("avif", 8);
    const path = join(dir, `bad-${length}`);
    await Bun.write(path, b);
    await expect(inspectContainer(path)).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });
  }
});
test("PNG chunk traversal fails closed on malformed, missing and excessive headers", async () => {
  const { inspectContainer } = await import("./image-child");
  const png = await Bun.file(fixture("safe.png")).bytes();
  for (const [name, bytes] of [
    ["missing", png.subarray(0, png.length - 12)],
    [
      "malformed",
      Buffer.concat([
        png.subarray(0, 8),
        Buffer.from([255, 255, 255, 255, 73, 72, 68, 82]),
      ]),
    ],
  ] as const) {
    const path = join(dir, name);
    await Bun.write(path, bytes);
    await expect(inspectContainer(path)).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });
  }
  const chunks = Buffer.alloc(12 * 513);
  for (let p = 0; p < chunks.length; p += 12) chunks.write("tEXt", p + 4);
  const path = join(dir, "too-many-chunks");
  await Bun.write(
    path,
    Buffer.concat([png.subarray(0, 33), chunks, png.subarray(33)]),
  );
  await expect(inspectContainer(path)).rejects.toMatchObject({
    code: "IMAGE_INVALID",
  });
});
test("actual native process cancellation kills blocked output and releases capacity", async () => {
  const fifo = join(dir, "cancel-fifo");
  expect(await Bun.spawn(["mkfifo", fifo]).exited).toBe(0);
  const controller = new AbortController();
  const pending = processAvatar(
    fifo,
    join(dir, "cancelled.jpg"),
    controller.signal,
  );
  await Bun.sleep(200);
  await expect(
    processAvatar(fixture("safe.png"), join(dir, "busy.jpg")),
  ).rejects.toMatchObject({ code: "STORAGE_BUSY" });
  controller.abort();
  await expect(pending).rejects.toBeDefined();
  await expect(
    processAvatar(fixture("safe.png"), join(dir, "after-cancel.jpg")),
  ).resolves.toMatchObject({ width: 512 });
});
test("actual native process hard timeout is 30 seconds and releases capacity", async () => {
  const fifo = join(dir, "timeout-fifo");
  expect(await Bun.spawn(["mkfifo", fifo]).exited).toBe(0);
  const started = Date.now();
  await expect(
    processAvatar(fifo, join(dir, "timed-out.jpg")),
  ).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  expect(Date.now() - started).toBeGreaterThanOrEqual(29900);
  expect(Date.now() - started).toBeLessThan(35000);
  await expect(
    processAvatar(fixture("safe.png"), join(dir, "after-timeout.jpg")),
  ).resolves.toMatchObject({ width: 512 });
}, 40000);

test("actual recipe build is accepted by production media env validation", async () => {
  const { parseStorageEnv } = await import("../server/storage/env");
  const { RECIPE_BUILD } = await import("./image-child");
  const config = parseStorageEnv(
    {
      PUBLIC_ORIGIN: "https://community.example.test",
      STORAGE_S3_ENDPOINT: "http://seaweedfs:8333",
      STORAGE_TEMP_DIR: "/storage/tmp",
      STORAGE_RECIPE_BUILD: RECIPE_BUILD,
      STORAGE_MEDIA_ACCESS_KEY_ID: "isolated-test",
      STORAGE_MEDIA_SECRET_ACCESS_KEY: "isolated-test",
    },
    "media",
  );
  expect(config.recipeBuild).toBe(RECIPE_BUILD);
});

test("a child spawn failure releases worker capacity for the next actual process", async () => {
  const { spyOn } = await import("bun:test");
  const spawn = spyOn(Bun, "spawn").mockImplementationOnce(() => {
    throw new Error("spawn failed");
  });
  try {
    await expect(
      processAvatar(fixture("safe.png"), join(dir, "spawn-fail.jpg")),
    ).rejects.toThrow("spawn failed");
  } finally {
    spawn.mockRestore();
  }
  await expect(
    processAvatar(fixture("safe.png"), join(dir, "after-spawn-fail.jpg")),
  ).resolves.toMatchObject({ width: 512 });
});

test("native CMYK conversion and synthetic GPS rotation strip all metadata", async () => {
  const sharp = (await import("sharp")).default;
  for (const name of ["own-cmyk.jpg", "own-gps-orientation6.jpg"]) {
    const input = await sharp(fixture(name)).metadata();
    if (name === "own-cmyk.jpg")
      expect(input).toMatchObject({ space: "cmyk", channels: 4 });
    else {
      expect(input.orientation).toBe(6);
      expect(input.exif).toBeDefined();
      const exif = input.exif!;
      const b = exif.subarray(6),
        little = b.toString("ascii", 0, 2) === "II";
      const u16 = (n: number) =>
          little ? b.readUInt16LE(n) : b.readUInt16BE(n),
        u32 = (n: number) => (little ? b.readUInt32LE(n) : b.readUInt32BE(n));
      const ifd = u32(4);
      let gps = 0;
      for (let i = 0; i < u16(ifd); i++) {
        const at = ifd + 2 + i * 12;
        if (u16(at) === 0x8825) gps = u32(at + 8);
      }
      expect(gps).toBeGreaterThan(0);
      const tags = new Map<number, number>();
      for (let i = 0; i < u16(gps); i++) {
        const at = gps + 2 + i * 12;
        tags.set(u16(at), at);
      }
      for (const tag of [2, 4]) {
        const at = tags.get(tag)!;
        expect(u16(at + 2)).toBe(5);
        expect(u32(at + 4)).toBe(3);
        const off = u32(at + 8);
        for (let j = 0; j < 3; j++) {
          expect(u32(off + j * 8)).toBe(0);
          expect(u32(off + j * 8 + 4)).toBe(1);
        }
      }
    }
    const out = join(dir, `synthetic-${name}`);
    await processAvatar(fixture(name), out);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({
      format: "jpeg",
      width: 512,
      height: 512,
      space: "srgb",
      isProgressive: false,
    });
    for (const key of ["exif", "icc", "xmp", "iptc"] as const)
      expect(meta[key]).toBeUndefined();
    const { data, info } = await sharp(out)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const points =
      name === "own-cmyk.jpg"
        ? [
            [256, 128],
            [256, 384],
          ]
        : [
            [128, 256],
            [384, 256],
          ];
    const expected =
      name === "own-cmyk.jpg"
        ? [
            [232, 0, 0],
            [28, 60, 139],
          ]
        : [
            [0, 0, 255],
            [255, 0, 0],
          ];
    points.forEach(([x, y], i) => {
      expected[i].forEach((value, c) => {
        expect(
          Math.abs(data[(y * 512 + x) * info.channels + c] - value),
        ).toBeLessThanOrEqual(4);
      });
    });
  }
});

test("output filesystem failure is retryable and releases capacity without classifying valid pixels as invalid",async()=>{
  await expect(processAvatar(fixture("safe.png"),join(dir,"absent-directory","out.jpg"))).rejects.toMatchObject({code:"PROCESSING_FAILED",status:503});
  await expect(processAvatar(fixture("safe.png"),join(dir,"after-write-error.jpg"))).resolves.toMatchObject({width:512});
});

test("valid large ancillary payload cannot hide APNG control beyond physical byte4096", async () => {
  const {inspectContainer}=await import("./image-child");
  const payload=Buffer.from(`own\0${"a".repeat(5000)}`),chunk=Buffer.alloc(payload.length+12);
  chunk.writeUInt32BE(payload.length);chunk.write("tEXt",4);payload.copy(chunk,8);
  let crc=0xffffffff;for(const byte of chunk.subarray(4,8+payload.length)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,8+payload.length);
  for(const name of ["animated-own.apng","safe.png"]){
    const original=await Bun.file(fixture(name)).bytes();const path=join(dir,`large-ancillary-${name}`);
    await Bun.write(path,Buffer.concat([original.subarray(0,33),chunk,original.subarray(33)]));
    if(name==="animated-own.apng")await expect(processAvatar(path,`${path}.jpg`)).rejects.toMatchObject({code:"ANIMATED_IMAGE_NOT_ALLOWED"});
    else {expect(await inspectContainer(path)).toBe("png");await expect(processAvatar(path,`${path}.jpg`)).resolves.toMatchObject({width:512});}
  }
});
