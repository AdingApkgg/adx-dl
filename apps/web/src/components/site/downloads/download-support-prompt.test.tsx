import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadSupportPrompt } from "./download-support-prompt";

describe("DownloadSupportPrompt", () => {
  test("does not ask for support before a successful download", () => {
    for (const statuses of [[], ["queued"], ["packing"], ["paused"], ["error"], ["archiving"]] as const) {
      expect(renderToStaticMarkup(<DownloadSupportPrompt locale="zh" statuses={statuses} />)).toBe("");
    }
  });

  test("shows one localized support link when any download succeeds", () => {
    for (const [locale, href] of [["zh", "/donate"], ["en", "/en/donate"], ["ja", "/ja/donate"]] as const) {
      const html = renderToStaticMarkup(
        <DownloadSupportPrompt locale={locale} statuses={["success", "error", "success"]} />
      );
      expect(html).toContain(`href="${href}"`);
      expect(html.match(/<a /g)).toHaveLength(1);
      if (locale === "zh") expect(html).toContain("本站好用嘛？请我喝杯咖啡呗～");
    }
  });
});
