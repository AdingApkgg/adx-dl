import { expect, test } from "bun:test";
import { unzipSync, zipSync } from "fflate";
import { buildChartAdx, chartExportName } from "./chart-export";

const encode = (value: string) => new TextEncoder().encode(value);
function upload(files: Record<string, Uint8Array>) {
  return new Blob([zipSync(files).buffer as ArrayBuffer], { type: "application/zip" });
}

test("ADX uses a single song folder, normalizes asset names and preserves every file's bytes", async () => {
  const files = {
    "Upload/song.txt": encode("&title=潮汐来信"),
    "Upload/song.ogg": new Uint8Array([1, 2, 3]),
    "Upload/art.png": new Uint8Array([4, 5, 6]),
    "Upload/video.webm": new Uint8Array([7]),
    "Upload/readme.md": encode("Credits"),
    "__MACOSX/metadata": new Uint8Array([8, 9]),
  };
  const adx = await buildChartAdx(upload(files), "潮汐来信");
  expect(adx.type).toBe("application/octet-stream");
  expect(unzipSync(new Uint8Array(await adx.arrayBuffer()))).toEqual({
    "潮汐来信/maidata.txt": files["Upload/song.txt"],
    "潮汐来信/track.ogg": files["Upload/song.ogg"],
    "潮汐来信/bg.png": files["Upload/art.png"],
    "潮汐来信/pv.webm": files["Upload/video.webm"],
    "潮汐来信/readme.md": files["Upload/readme.md"],
  });
});

test("rejects unsafe paths and multiple song folders instead of building an unusable ADX", async () => {
  await expect(buildChartAdx(upload({ "../maidata.txt": encode("score") }), "chart")).rejects.toThrow("Invalid chart path");
  await expect(buildChartAdx(upload({ "one/maidata.txt": encode("one"), "two/maidata.txt": encode("two") }), "chart")).rejects.toThrow("Expected one chart folder");
  expect(chartExportName("../an:x", "42")).toBe("_an_x");
  expect(chartExportName("CON", "42")).toBe("42");
});
