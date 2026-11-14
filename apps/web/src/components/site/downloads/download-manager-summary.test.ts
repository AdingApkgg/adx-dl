import { expect, test } from "bun:test";
import { getDictionary } from "@/lib/i18n";
import type { DownloadJob } from "./downloads-store";
import { downloadManagerSummary } from "./download-manager-summary";

const job = (status: DownloadJob["status"]): DownloadJob => ({
  id: status, kind: "single", title: status, sourceId: "r2", format: "adx", status,
  completed: 0, total: 1, receivedBytes: 0, totalBytes: 1, totalBytesEstimated: false,
  speedBps: 0, etaMs: null, fileProgress: [], archiveCurrentFile: null, error: null,
  errorKind: null, errorDetail: null, skippedFiles: [], autoSwitchedTo: null, startedAt: 0,
});

test("surfaces pending user actions ahead of running and completed tasks", () => {
  const copy = getDictionary("zh").downloads;
  expect(downloadManagerSummary([job("success"), job("packing"), job("ready")], copy)).toBe(copy.readyToSave);
  expect(downloadManagerSummary([job("packing"), job("error")], copy)).toBe(copy.managerFailed);
  expect(downloadManagerSummary([job("packing"), job("paused")], copy)).toBe(copy.paused);
  expect(downloadManagerSummary([job("queued"), job("archiving")], copy)).toBe(copy.archiving);
});
test("does not label an empty manager as complete", () => {
  expect(downloadManagerSummary([], getDictionary("en").downloads)).toBe("");
});

test("keeps mobile save confirmation distinct from a pending file save", () => {
  const mobile = { ...job("success"), mobileBatch: true, archives: [{ fileName: "chart.adx", bytes: 1, requested: true, error: false }] };
  expect(downloadManagerSummary([mobile], getDictionary("zh").downloads)).toBe(getDictionary("zh").downloads.managerConfirmSave);
});

test("removing task data is named differently from closing a panel in every locale", () => {
  for (const locale of ["zh", "en", "ja"] as const) {
    const copy = getDictionary(locale);
    expect(copy.downloads.dismiss).not.toBe(copy.detail.closePanel);
  }
});
