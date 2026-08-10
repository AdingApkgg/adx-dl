import { describe, expect, test } from "bun:test";

import { getDictionary } from "@/lib/i18n";
import {
  downloadJobMetricsText,
  downloadJobStateText,
  downloadJobStatusText,
  formatEtaClock,
} from "./download-status-text";
import type { DownloadJob } from "./downloads-store";

const dictionary = getDictionary("zh");

function job(patch: Partial<DownloadJob>): DownloadJob {
  return {
    id: "batch:AstroDX Charts",
    kind: "batch",
    title: "AstroDX Charts",
    sourceId: "r2",
    format: "adx",
    status: "packing",
    completed: 3,
    total: 12,
    receivedBytes: 0,
    totalBytes: 0,
    totalBytesEstimated: false,
    speedBps: 0,
    etaMs: null,
    fileProgress: [],
    archiveCurrentFile: null,
    error: null,
    errorKind: null,
    errorDetail: null,
    skippedFiles: [],
    autoSwitchedTo: null,
    startedAt: 0,
    ...patch,
  };
}

describe("formatEtaClock", () => {
  test("renders m:ss below an hour and h:mm:ss above it", () => {
    expect(formatEtaClock(80_000)).toBe("1:20");
    expect(formatEtaClock(5_000)).toBe("0:05");
    expect(formatEtaClock(3_750_000)).toBe("1:02:30");
  });

  test("never renders a negative clock", () => {
    expect(formatEtaClock(-1)).toBe("0:00");
  });
});

describe("downloadJobStatusText", () => {
  test("includes archive progress details while locally packing", () => {
    expect(
      downloadJobStatusText(
        job({
          status: "archiving",
          receivedBytes: 2048,
          totalBytes: 8192,
          archiveCurrentFile: "25 CiRCLE/Same Song/maidata.txt",
        }),
        dictionary.detail,
        dictionary.downloads
      )
    ).toBe("正在打包归档… · 25% · 3/12 · 2.0 KB / 8.0 KB · 25 CiRCLE/Same Song/maidata.txt");
  });

  test("marks an extrapolated total with a tilde and appends the ETA", () => {
    // With six-way concurrency most files have not declared a Content-Length at
    // any instant, so the total is an extrapolation and must say so.
    expect(
      downloadJobMetricsText(
        job({
          receivedBytes: 1024,
          totalBytes: 4096,
          totalBytesEstimated: true,
          speedBps: 2048,
          etaMs: 80_000,
        }),
        dictionary.downloads
      )
    ).toBe("1.0 KB / ~4.0 KB · 2.0 KB/s · 剩余 1:20");
  });

  test("keeps the live region text free of per-frame numbers", () => {
    const packing = job({ receivedBytes: 1024, totalBytes: 4096, speedBps: 9000 });
    expect(downloadJobStateText(packing, dictionary.detail, dictionary.downloads)).toBe(
      dictionary.detail.downloadPacking(3, 12)
    );
    expect(
      downloadJobStateText(job({ status: "success" }), dictionary.detail, dictionary.downloads)
    ).toBe(dictionary.downloads.completed);
  });

  test("distinguishes a permanent 4xx from a flaky connection", () => {
    const kinds = ["missing", "server", "network", "offline"] as const;
    const texts = kinds.map((errorKind) =>
      downloadJobStateText(
        job({ status: "error", errorKind }),
        dictionary.detail,
        dictionary.downloads
      )
    );
    expect(new Set(texts).size).toBe(kinds.length);
    expect(texts[0]).toBe(dictionary.downloads.errorMissing);
    expect(texts[1]).toBe(dictionary.downloads.errorServer);
  });

  test("reports skipped optional assets alongside a successful finish", () => {
    expect(
      downloadJobStateText(
        job({
          status: "success",
          skippedFiles: [{ name: "0/pv.mp4", url: "https://x/pv.mp4", status: 404 }],
        }),
        dictionary.detail,
        dictionary.downloads
      )
    ).toBe(`${dictionary.downloads.completed} · ${dictionary.downloads.skippedSummary(1)}`);
  });
});
