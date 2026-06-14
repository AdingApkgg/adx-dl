import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AdxDownloadButton } from "./adx-download-button";

describe("AdxDownloadButton", () => {
  const files = [{ name: "maidata.txt", url: "https://example.test/maidata.txt" }];

  test("renders localized idle copy", () => {
    const html = renderToStaticMarkup(
      <AdxDownloadButton files={files} fileName="39" locale="en" />
    );

    expect(html).toContain("Onsite Download");
  });

  test("renders pending copy when there are no files", () => {
    const html = renderToStaticMarkup(
      <AdxDownloadButton files={[]} fileName={undefined} locale="zh" />
    );

    expect(html).toContain("站内下载待接入");
    expect(html).toContain("disabled");
  });
});
