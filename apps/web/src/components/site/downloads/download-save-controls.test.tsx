import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DownloadJobNotes, DownloadJobStatusLine } from "./download-job-notes";
import type { DownloadJob } from "./downloads-store";
import { CHART_IMPORT_VIDEO_URL } from "@/lib/resource-links";

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
  expect(html.match(/<button /g)).toHaveLength(3);
  expect(html).toContain("浏览器诊断与兼容帮助");
  expect(html).toContain("再次保存");
  expect(html).toContain("保存文件");
  expect(html).toContain("保存未能发起");
  expect(html).toContain('href="/guide#import"');
  expect(html).toContain('href="/guide#troubleshooting"');
  expect(html).toContain(`href="${CHART_IMPORT_VIDEO_URL}"`);
  expect(html.indexOf(`href="${CHART_IMPORT_VIDEO_URL}"`)).toBeLessThan(html.indexOf('href="/guide#import"'));
});

test("releasing saved mobile files keeps import instructions without save controls", () => {
  const job: DownloadJob = {
    id: "batch:released", kind: "batch", mobileBatch: true, title: "maimai", sourceId: "r2", format: "adx",
    status: "success", completed: 3, total: 3, receivedBytes: 10, totalBytes: 10,
    totalBytesEstimated: false, speedBps: 0, etaMs: null, fileProgress: [],
    archiveCurrentFile: null, error: null, errorKind: null, errorDetail: null,
    skippedFiles: [], autoSwitchedTo: null, startedAt: 0,
    savedArchiveInfo: { fileNames: ["maimai.adx"], format: "adx", archiveCount: 1 },
  };
  const html = renderToStaticMarkup(<DownloadJobNotes job={job} locale="zh" />);
  expect(html).toContain("保存后，导入到 AstroDX");
  expect(html).toContain(`href="${CHART_IMPORT_VIDEO_URL}"`);
  expect(html).toContain('href="/guide#import"');
  expect(html).not.toContain("<button");
  expect(html).not.toContain("确认保存并释放缓存");
});
