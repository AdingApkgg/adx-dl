import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CUSTOM_DOWNLOAD_SOURCE_ID,
  getDownloadSource,
} from "@/lib/download-sources";
import { getDictionary } from "@/lib/i18n";
import { AdxDownloadButton } from "./adx-download-button";
import { DownloadDock } from "./downloads/download-dock";
import { singleJobId, useDownloadsStore, type DownloadJob } from "./downloads/downloads-store";
import {
  DownloadSourceSummary,
  downloadSourceStatusClass,
  downloadSourceStatusText,
} from "./downloads/download-source-selector";

describe("AdxDownloadButton", () => {
  const files = [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }];

  test("renders localized idle copy", () => {
    const html = renderToStaticMarkup(
      <AdxDownloadButton spec={{ dir: "39", files, groupDir: "00 maimai" }} locale="en" />
    );

    expect(html).toContain("Onsite Download");
    expect(html).toContain('data-download-source="r2"');
    expect(html).toContain("R2");
    expect(html).toContain("Recommended");
    expect(html).toContain("-- ms");
  });

  test("keeps support inline and the manager reachable for inline jobs", () => {
    const initial = useDownloadsStore.getInitialState();
    const previousJobs = initial.jobs;
    const previousPresented = initial.presented;
    const job: DownloadJob = {
      id: singleJobId("39"), kind: "single", title: "39", sourceId: "r2", format: "adx",
      status: "success", completed: 1, total: 1, receivedBytes: 10, totalBytes: 10,
      totalBytesEstimated: false, speedBps: 0, etaMs: null, fileProgress: [],
      archiveCurrentFile: null, error: null, errorKind: null, errorDetail: null,
      skippedFiles: [], autoSwitchedTo: null, startedAt: 0,
    };
    try {
      // The manager must include jobs even if an older inline presenter claims them.
      initial.jobs = [job];
      initial.presented = { [job.id]: 1 };
      for (const locale of ["zh", "en", "ja"] as const) {
        const html = renderToStaticMarkup(
          <AdxDownloadButton spec={{ dir: "39", files, groupDir: "00 maimai" }} locale={locale} />
        );
        const hint = getDictionary(locale).donate.downloadThanks;
        expect(html).toContain(hint);
        expect(html).toContain(`href="${locale === "zh" ? "/donate" : `/${locale}/donate`}"`);
        const dock = renderToStaticMarkup(<DownloadDock locale={locale} />);
        expect(dock).toContain(getDictionary(locale).downloads.jobsCount(1));
      }
      initial.jobs = [{ ...job, status: "ready", archives: [{ fileName: "39.adx", bytes: 10, requested: false, error: false }] }];
      const ready = renderToStaticMarkup(<AdxDownloadButton spec={{ dir: "39", files }} locale="zh" />);
      const primary = ready.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0];
      expect(primary).toContain(getDictionary("zh").downloads.saveArchive);
      expect(primary).not.toMatch(/\sdisabled(?:=|\s|>)/);
      initial.jobs = [{ ...job, status: "packing" }];
      const packing = renderToStaticMarkup(<AdxDownloadButton spec={{ dir: "39", files }} locale="zh" />);
      expect(packing.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0]).toContain(getDictionary("zh").downloads.pause);
      for (const status of ["queued", "packing", "archiving", "ready", "paused", "error"] as const) {
        initial.jobs = [{ ...job, status }];
        const html = renderToStaticMarkup(
          <AdxDownloadButton spec={{ dir: "39", files, groupDir: "00 maimai" }} locale="zh" />
        );
        expect(html).not.toContain(getDictionary("zh").donate.downloadThanks);
      }
    } finally {
      initial.jobs = previousJobs;
      initial.presented = previousPresented;
    }
  });

  test("renders pending copy when there are no files", () => {
    const html = renderToStaticMarkup(<AdxDownloadButton spec={undefined} locale="zh" />);

    expect(html).toContain("站内下载待接入");
    expect(html).toContain("disabled");
  });

  test("renders the shared backup-source status and badge", () => {
    const html = renderToStaticMarkup(
      <DownloadSourceSummary
        sourceId="alice"
        copy={getDictionary("zh").downloads.sourcePicker}
      />
    );

    expect(html).toContain('data-download-source="alice"');
    expect(html).toContain("Alice");
    expect(html).toContain("备用");
    expect(html).toContain("-- ms");
  });

  test("renders the measured source latency in milliseconds", () => {
    const source = getDownloadSource("alice");
    const probe = { state: "ok" as const, latencyMs: 38, measuredAt: Date.now() };
    const copy = getDictionary("zh").downloads.sourcePicker;

    expect(downloadSourceStatusText(source, probe, copy)).toBe("38 ms");
    expect(downloadSourceStatusClass(source, probe)).toBe("bg-emerald-500");
  });

  test("renders a custom job from its saved route snapshot", () => {
    const html = renderToStaticMarkup(
      <DownloadSourceSummary
        sourceId={CUSTOM_DOWNLOAD_SOURCE_ID}
        sourceBaseUrl="https://mirror.example.com/charts"
        sourceName="My mirror"
        copy={getDictionary("en").downloads.sourcePicker}
      />
    );

    expect(html).toContain(
      `data-download-source="${CUSTOM_DOWNLOAD_SOURCE_ID}"`
    );
    expect(html).toContain("My mirror");
    expect(html).toContain("https://mirror.example.com/charts");
    expect(html).toContain("-- ms");
  });

});
