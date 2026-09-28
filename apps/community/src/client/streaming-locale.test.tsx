import { describe, expect, test } from "bun:test";
import { Suspense, use } from "react";
import { renderToReadableStream } from "react-dom/server.edge";

import { m } from "@/paraglide/messages.js";
import type { Locale } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";

function Late({ ready }: { ready: Promise<void> }) {
  use(ready);
  return <p>{m.site_name()}</p>;
}

async function render(url: string): Promise<string> {
  const response = await paraglideMiddleware(new Request(url), async () => {
    // 先输出外壳，30 毫秒后才渲染 Suspense 里面的内容。
    const ready = new Promise<void>((resolve) => setTimeout(resolve, 30));
    const stream = await renderToReadableStream(
      <Suspense fallback={<p>…</p>}>
        <Late ready={ready} />
      </Suspense>
    );
    return new Response(stream);
  });
  // 中间件已经返回，这时才把流读完：晚到的内容正是在这之后渲染的。
  return response.text();
}

const CASES: [string, Locale][] = [
  ["https://community.test/", "zh"],
  ["https://community.test/en/a", "en"],
  ["https://community.test/ja/b", "ja"],
];

describe("流式渲染时的语言", () => {
  test("30 个并发请求，晚到的 Suspense 内容都用各自请求的语言", async () => {
    const requests = CASES.flatMap((entry) => Array.from({ length: 10 }, () => entry));
    const results = await Promise.all(
      requests.map(async ([url, locale]) => ({ locale, html: await render(url) }))
    );

    for (const { locale, html } of results) {
      expect(html, locale).toContain(m.site_name({}, { locale }));
    }
  });
});
