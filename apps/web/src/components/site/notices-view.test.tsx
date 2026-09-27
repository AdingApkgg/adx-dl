import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NoticesView } from "@/components/site/notices-view";
import type { Notice } from "@/lib/notices";

// Dates chosen to stay unambiguous regardless of when this test actually
// runs: `expiresAt: null` never expires, and "2000-01-01" is expired against
// any plausible "today".
function buildNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: "n1",
    level: "normal",
    publishedAt: "2026-01-01",
    expiresAt: null,
    title: { zh: "标题", en: null, ja: null },
    body: { zh: "正文", en: null, ja: null },
    link: null,
    ...overrides,
  };
}

describe("NoticesView", () => {
  test("renders the urgent badge for an urgent active notice, and not the ended badge", () => {
    const list = [
      buildNotice({ id: "u1", level: "urgent", title: { zh: "紧急标题", en: null, ja: null } }),
    ];

    const html = renderToStaticMarkup(<NoticesView locale="zh" list={list} />);

    // The page's static intro also contains 紧急, so assert the badge itself
    // (not just the substring) to actually prove it rendered.
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain("紧急标题");
    expect(html).not.toContain("已结束");
  });

  test("renders the ended badge for an expired notice, and not the urgent badge", () => {
    const list = [
      buildNotice({
        id: "e1",
        expiresAt: "2000-01-01",
        title: { zh: "过期标题", en: null, ja: null },
      }),
    ];

    const html = renderToStaticMarkup(<NoticesView locale="zh" list={list} />);

    expect(html).toContain("已结束");
    expect(html).toContain("过期标题");
    // Not a plain `not.toContain("紧急")`: the page's own static intro
    // paragraph always mentions 紧急 ("urgent notices also appear..."), so
    // check the badge itself is absent rather than the substring anywhere.
    expect(html).not.toContain('data-variant="destructive"');
  });

  test("renders the empty state when the list has no notices", () => {
    const html = renderToStaticMarkup(<NoticesView locale="zh" list={[]} />);

    expect(html).toContain("目前没有公告。");
    // Neither badge, nor the <ul>, has any reason to appear when there's nothing to list.
    expect(html).not.toContain("<ul");
  });

  test("defaults to the real build-time notices when no list prop is given", () => {
    // No `list` — exercises the `list = notices` default straight from
    // notices.json, the same data default-routes.test.tsx's "notices route"
    // test checks against.
    const html = renderToStaticMarkup(<NoticesView locale="zh" />);

    expect(html).toContain("本站新增公告页");
  });

  test("renders a notice whose href fails the safety allowlist as plain text, not a link", () => {
    const list = [
      buildNotice({
        id: "j1",
        link: {
          href: "javascript:alert(1)",
          label: { zh: "点我", en: null, ja: null },
        },
      }),
    ];

    const html = renderToStaticMarkup(<NoticesView locale="zh" list={list} />);

    expect(html).toContain("点我");
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("<a ");
  });
});
