import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DownloadDock, DownloadProgressBar } from "./download-dock";

describe("DownloadDock", () => {
  test("SSR renders the empty dock without hidden content", () => {
    const html = renderToStaticMarkup(<DownloadDock locale="en" />);

    // Static export rule: nothing content-bearing may serialize opacity:0.
    expect(html).not.toContain("opacity:0");
    expect(html).not.toContain("display:none");
  });
});

describe("DownloadProgressBar", () => {
  test("keeps aria values bound to the raw percent", () => {
    const html = renderToStaticMarkup(
      <DownloadProgressBar percent={37} active={false} label="chart.adx" />
    );

    expect(html).toContain('aria-valuenow="37"');
    expect(html).toContain('aria-label="chart.adx"');
  });

  test("omits aria-valuenow when indeterminate", () => {
    const html = renderToStaticMarkup(
      <DownloadProgressBar percent={null} active={false} label="track.mp3" />
    );

    expect(html).not.toContain("aria-valuenow");
  });
});
