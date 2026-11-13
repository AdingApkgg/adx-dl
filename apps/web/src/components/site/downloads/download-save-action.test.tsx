import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadSaveAction, getDownloadSaveAction } from "./download-save-action";
import type { DownloadJob } from "./downloads-store";

function job(patch: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "batch:save", kind: "batch", title: "maimai", sourceId: "r2", format: "adx",
    status: "ready", completed: 2, total: 2, receivedBytes: 10, totalBytes: 10,
    totalBytesEstimated: false, speedBps: 0, etaMs: null, fileProgress: [],
    archiveCurrentFile: null, error: null, errorKind: null, errorDetail: null,
    skippedFiles: [], autoSwitchedTo: null, startedAt: 0, mobileBatch: true,
    archives: [
      { fileName: "1.adx", bytes: 5, requested: true, error: false },
      { fileName: "2.adx", bytes: 5, requested: false, error: false },
    ], ...patch,
  };
}

describe("next download action", () => {
  test("saves the next unrequested split before offering confirmation", () => {
    const pending = job();
    expect(getDownloadSaveAction([pending])).toMatchObject({ kind: "save", index: 1 });
    const html = renderToStaticMarkup(<DownloadSaveAction jobs={[pending]} locale="zh" />);
    expect(html).toContain("保存文件");
    expect(html).toContain("2/2");
    expect(html).not.toContain("文件已保存");
  });
  test("failed saves are retried even when previously requested", () => {
    const pending = job();
    pending.archives![0].error = true;
    expect(getDownloadSaveAction([pending])).toMatchObject({ kind: "save", index: 0 });
  });
  test("confirmation requires success with every archive requested", () => {
    const pending = job();
    pending.archives![1].requested = true;
    expect(getDownloadSaveAction([pending])).toBeNull();
    pending.status = "success";
    expect(getDownloadSaveAction([pending])).toMatchObject({ kind: "confirm" });
    pending.mobileBatch = false;
    expect(getDownloadSaveAction([pending])).toBeNull();
  });
  test("never offers an archive while still downloading or archiving", () => {
    for (const status of ["queued", "packing", "archiving", "paused", "error"] as const) {
      expect(getDownloadSaveAction([job({ status })])).toBeNull();
    }
  });
  test("finds a ready task behind a queued one and ignores released archives", () => {
    expect(getDownloadSaveAction([job({ status: "queued" }), job()])).toMatchObject({ kind: "save" });
    expect(getDownloadSaveAction([job({ status: "success", archives: undefined })])).toBeNull();
  });
});
