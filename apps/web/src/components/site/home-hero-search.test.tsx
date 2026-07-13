import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The hero search is a client component that calls useRouter; stub the
// navigation hooks so the server-rendered markup test has a router context.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { HomeHeroSearch } from "@/components/site/home-hero-search";

function renderHero() {
  return renderToStaticMarkup(
    <HomeHeroSearch
      searchHref="/search"
      placeholder="搜索曲名、别名、曲师、版本..."
      submitLabel="搜索"
      quickLabel="快速筛选"
      genres={[
        { id: 101, label: "POPS＆アニメ", badge: "badge-a" },
        { id: 102, label: "niconico＆VOCALOID", badge: "badge-b" },
      ]}
    />
  );
}

test("static HTML keeps the real placeholder for crawlers and no-JS readers", () => {
  const html = renderHero();
  // The cycling-placeholder overlay is post-hydration only: the attribute is
  // present and never CSS-hidden in the prerendered markup.
  expect(html).toContain('placeholder="搜索曲名、别名、曲师、版本..."');
  expect(html).not.toContain("placeholder:text-transparent");
});

test("genre chips render fully visible in static HTML (transform-only cascade)", () => {
  const html = renderHero();
  expect(html).toContain("POPS＆アニメ");
  expect(html).toContain("niconico＆VOCALOID");
  // The mount cascade must never serialize an opacity keyframe onto chips; the
  // one allowed opacity:0 is the decorative focus-glow layer.
  const opacityZero = html.match(/opacity:\s?0[;"]/g) ?? [];
  expect(opacityZero.length).toBeLessThanOrEqual(1);
});
