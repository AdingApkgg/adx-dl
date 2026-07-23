import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CUSTOM_DOWNLOAD_SOURCE_ID,
  getDownloadSource,
} from "@/lib/download-sources";
import { getDictionary } from "@/lib/i18n";
import { AdxDownloadButton } from "./adx-download-button";
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
