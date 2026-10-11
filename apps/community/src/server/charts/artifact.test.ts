import { expect, test } from "bun:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChartArtifactManifest, writeChartArtifact } from "./artifact";
import { summarizeMaidata } from "./maidata-summary";

test("private artifact rejects a corrupted header and never removes a pre-existing output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adxc-chart-artifact-test-"));
  try {
    const input = join(directory, "maidata"), output = join(directory, "preview");
    const bytes = Buffer.from("&inote_4=(120){4}1,E"); await writeFile(input, bytes);
    const summary = summarizeMaidata(bytes), assets = [{ role: "maidata" as const, path: "maidata.txt", mime: "text/plain; charset=utf-8", inputPath: input }];
    await writeFile(output, "existing owned by another attempt");
    await expect(writeChartArtifact(output, summary, assets)).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("existing owned by another attempt");
    await rm(output); await writeChartArtifact(output, summary, assets);
    const file = await open(output, "r+"); try { await file.write(Buffer.from("X"), 0, 1, 0); } finally { await file.close(); }
    await expect(readChartArtifactManifest(output)).rejects.toThrow("CHART_PACKAGE_INVALID");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
