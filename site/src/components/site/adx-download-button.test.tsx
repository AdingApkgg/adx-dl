import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AdxDownloadButton } from "./adx-download-button";

describe("AdxDownloadButton", () => {
  test("renders localized idle copy", () => {
    const html = renderToStaticMarkup(<AdxDownloadButton directoryName="39" locale="en" />);

    expect(html).toContain("Onsite Download");
  });

  test("renders pending copy when directory name is missing", () => {
    const html = renderToStaticMarkup(<AdxDownloadButton directoryName={undefined} locale="zh" />);

    expect(html).toContain("站内下载待接入");
    expect(html).toContain("disabled");
  });
});
