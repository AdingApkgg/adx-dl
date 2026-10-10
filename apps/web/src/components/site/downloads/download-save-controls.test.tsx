import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DownloadJobNotes, DownloadJobStatusLine } from "./download-job-notes";
import type { DownloadJob } from "./downloads-store";

test("a finished mobile batch exposes each pending archive and retry action", () => {
  const job: DownloadJob = {
    id: "batch:mobile", kind: "batch", title: "maimai", sourceId: "r2", format: "zip",
    status: "ready", completed: 2, total: 2, receivedBytes: 10, totalBytes: 10,
    totalBytesEstimated: false, speedBps: 0, etaMs: null, fileProgress: [],
    archiveCurrentFile: null, error: null, errorKind: null, errorDetail: null,
    skippedFiles: [], autoSwitchedTo: null, startedAt: 0,
    archives: [
      { fileName: "maimai (1).zip", bytes: 5, requested: true, error: false },
      { fileName: "maimai (2).zip", bytes: 5, requested: false, error: true },
    ],
  };
  const html = renderToStaticMarkup(
    <><DownloadJobStatusLine job={job} locale="zh" /><DownloadJobNotes job={job} locale="zh" /></>
  );
  expect(html).toContain("打包完成，等待保存文件");
  expect(html).toContain("maimai (1).zip");
  expect(html).toContain("maimai (2).zip");
  expect(html.match(/<button /g)).toHaveLength(2);
  expect(html).toContain("再次保存");
  expect(html).toContain("保存文件");
  expect(html).toContain("保存未能发起");
});
