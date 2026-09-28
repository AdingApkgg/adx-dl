import { describe, expect, test } from "bun:test";

import { loader } from "./locale";

function run(lang: string | undefined, url: string) {
  // loader 只用到 params 和 url，测试里只传这两项。
  return loader({ params: { lang }, url: new URL(url) } as unknown as Parameters<typeof loader>[0]);
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("应当抛出");
}

describe("语言前缀路由", () => {
  test("没有前缀是中文", () => {
    expect(run(undefined, "https://x.test/")).toEqual({ locale: "zh" });
  });

  test("en、ja 前缀", () => {
    expect(run("en", "https://x.test/en")).toEqual({ locale: "en" });
    expect(run("ja", "https://x.test/ja/")).toEqual({ locale: "ja" });
  });

  test("/zh 前缀 301 到不带前缀的地址，保留查询串", () => {
    const response = thrownBy(() => run("zh", "https://x.test/zh/foo?x=1")) as Response;
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/foo?x=1");
  });

  // /foo 这样的地址会被 :lang? 匹配成 lang=foo，要当成页面不存在。
  // /EN/... 在 Paraglide 眼里是英文，这里同样拒绝，免得一个页面有两个地址。
  test("不认识的第一段返回 404，大小写不对也算", () => {
    const cases = [
      ["foo", "https://x.test/foo"],
      ["EN", "https://x.test/EN/charts"],
    ] as const;
    for (const [lang, url] of cases) {
      const thrown = thrownBy(() => run(lang, url)) as { init?: { status?: number } };
      expect(thrown.init?.status, lang).toBe(404);
    }
  });
});
