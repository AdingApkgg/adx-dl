import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AdxDownloadButton } from "./adx-download-button";

describe("AdxDownloadButton", () => {
  const files = [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }];

  test("renders localized idle copy", () => {
    const html = renderToStaticMarkup(
      <AdxDownloadButton spec={{ dir: "39", files, groupDir: "00 maimai" }} locale="en" />
    );

    expect(html).toContain("Onsite Download");
  });

  test("renders pending copy when there are no files", () => {
    const html = renderToStaticMarkup(<AdxDownloadButton spec={undefined} locale="zh" />);

    expect(html).toContain("站内下载待接入");
    expect(html).toContain("disabled");
  });
});
