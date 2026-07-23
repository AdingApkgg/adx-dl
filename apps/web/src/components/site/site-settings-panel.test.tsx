import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { getDictionary } from "@/lib/i18n";
import {
  createInitialDownloadSourceProbes,
  useDownloadsStore,
} from "@/components/site/downloads/downloads-store";
import { SiteSettingsContent } from "./site-settings-panel";

afterEach(() => {
  useDownloadsStore.setState({
    selectedSourceId: "r2",
    customSources: [],
    preferredFormat: "adx",
    sourceProbes: createInitialDownloadSourceProbes(),
  });
});

describe("SiteSettingsContent", () => {
  test("renders appearance, format, immutable built-ins, and custom-route controls", () => {
    const html = renderToStaticMarkup(
      <SiteSettingsContent
        locale="zh"
        pathname="/charts"
        dictionary={getDictionary("zh")}
      />
    );

    expect(html).toContain("外观与体验");
    expect(html).toContain("跟随系统");
    expect(html).toContain("主题强调色");
    expect(html).toContain("默认下载格式");
    expect(html).toContain(".zip");
    expect(html).toContain("内置线路不可删除");
    expect(html).toContain("尚未添加自定义线路");
    expect(html).toContain("线路名称");
    expect(html).toContain("线路地址");
    expect(html).toContain("添加线路");
    expect(html).toContain("R2");
    expect(html).toContain("AWMC");
  });
});
