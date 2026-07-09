import { describe, expect, test } from "bun:test";

import { getDictionary } from "@/lib/i18n";
import { downloadJobStatusText } from "./download-status-text";
import type { DownloadJob } from "./downloads-store";

describe("downloadJobStatusText", () => {
  test("includes archive progress details while locally packing", () => {
    const dictionary = getDictionary("zh");
    const job: DownloadJob = {
      id: "batch:AstroDX Charts",
      kind: "batch",
      title: "AstroDX Charts",
      format: "adx",
      status: "archiving",
      completed: 3,
      total: 12,
      receivedBytes: 2048,
      totalBytes: 8192,
      speedBps: 0,
      fileProgress: [],
      archiveCurrentFile: "25 CiRCLE/Same Song/maidata.txt",
      error: null,
      errorKind: null,
      startedAt: 0,
    };

    expect(downloadJobStatusText(job, dictionary.detail, dictionary.downloads)).toBe(
      "正在打包归档… · 25% · 3/12 · 2.0 KB / 8.0 KB · 25 CiRCLE/Same Song/maidata.txt"
    );
  });
});
