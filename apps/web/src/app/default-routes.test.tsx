import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { Catalog, CatalogEntry } from "@/lib/catalog-shared";
import {
  astroDxDownloadUrl,
  CHART_IMPORT_VIDEO_URL,
  DEMO_VIDEO_URL,
} from "@/lib/resource-links";

function buildEntry(index: number): CatalogEntry {
  const entryId = index === 3 ? "song-3◆phase" : `song-${index}`;
  const slug = `song-${index}`;

  return {
    id: entryId,
    slug,
    remote_dir_name: entryId,
    title: `曲目 ${index}`,
    title_en: `Song ${index}`,
    artist: `歌手 ${index}`,
    artist_en: `Artist ${index}`,
    category: "Official",
    subcategory: index % 2 === 0 ? "舞萌DX 2024" : "舞萌DX 2025",
    source_archive: `archive-${index}.adx`,
    source_folder: `folder-${index}`,
    version: `Ver.${index}`,
    versionid: index,
    genre: "Anime",
    cabinet: "DX",
    short_id: `S${index}`,
    bpm: 120 + index,
    offset: null,
    download_mode: index % 3 === 0 ? "mixed" : "onsite",
    download_url: `https://downloads.example.com/song-${index}.zip`,
    source_url: `https://source.example.com/song-${index}`,
    license_note: `license-${index}`,
    files: {
      maidata: `maidata-${index}.txt`,
      maidata_dx: `maidata-dx-${index}.txt`,
      audio: `audio-${index}.mp3`,
      background: `background-${index}.png`,
      pv: `pv-${index}.mp4`,
    },
    assets: {
      has_audio: true,
      has_background: index % 2 === 0,
      has_pv: index % 3 === 0,
      has_dx_chart: true,
    },
    media: {
      entry_base_url: `/covers/${slug}`,
      cover_url: `/covers/${slug}/bg.jpg`,
      audio_url: `/covers/${slug}/track.mp3`,
      pv_url: index % 3 === 0 ? `/covers/${slug}/pv.mp4` : "",
    },
    difficulties: [
      { slot: 0, level: "12+", designer: `Designer ${index}` },
      { slot: 1, level: "13", designer: `CoDesigner ${index}` },
    ],
    imported_at: `2026-06-${String(index).padStart(2, "0")}T12:00:00.000Z`,
  };
}

const entries = Array.from({ length: 9 }, (_, index) => buildEntry(index + 1));

const slugOf = (id: string) => entries.find((entry) => entry.id === id)!.slug!;

const catalog: Catalog = {
  generated_at: "2026-06-12T00:00:00.000Z",
  total_entries: entries.length,
  categories: {
    Official: ["舞萌DX 2024", "舞萌DX 2025"],
  },
  entries,
};

mock.module("@/lib/catalog", () => ({
  readCatalog: async () => catalog,
  readCatalogEntries: async () => entries,
  readEntryById: async (id: string) => entries.find((entry) => entry.id === id),
  readEntryByRouteSlug: async (slug: string) =>
    entries.find((entry) => entry.slug === slug),
  readRelatedEntries: async () => [],
  readRouteSlugs: async () => entries.map((entry) => entry.slug!),
  readCanonicalSlugs: async () => entries.map((entry) => entry.slug!),
  readVersionGroups: async () => [],
  readVersionGroup: async () => undefined,
  readVersionRouteIds: async () => [],
}));

// The home hero's search box is a client component that calls useRouter; the
// catalog browser reads window.location on mount. Provide inert stubs so the
// server-rendered markup tests have a router/navigation context.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

describe("default zh routes", () => {
  test("root route renders the zh home view with hero, spotlight and latest", async () => {
    const { default: HomePage } = await import("./(default)/page");

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain("<h1>为 AstroDX <span>找到下一首谱面。</span></h1>");
    expect(html).toContain("搜索曲库");
    expect(html).toContain("浏览版本");
    expect(html).toContain(`href="${astroDxDownloadUrl("zh")}"`);
    expect(html).toContain("上手指南");
    expect(html).toContain('href="/guide"');
    expect(html).toContain("谱面导入教程");
    expect(html).toContain(`href="${CHART_IMPORT_VIDEO_URL}"`);
    expect(html).toContain("观看演示视频");
    expect(html).toContain(`href="${DEMO_VIDEO_URL}"`);
    expect(html).toContain("什么是 AstroDX？");
    // The shortcut points at the question itself, and that question ships open
    // — landing on a heading above five collapsed rows answered nothing.
    expect(html).toContain('href="#what-is-astrodx"');
    expect(html).toContain('id="what-is-astrodx"');
    expect(html).toMatch(/id="what-is-astrodx"[^>]*open/);
    expect(html).toContain('role="group" aria-label="快捷入口"');
    // The spotlight is named for assistive tech and also carries the visible
    // corner badge over the top-left of the cover.
    expect(html).toContain('aria-label="今日精选"');
    expect(html).toContain("今日精选</span>");
    expect(html).toContain("查看更多");
    expect(html).toContain("最新谱面");
    expect(html).toContain("按曲风浏览");
    expect(html).toContain("ADX CHARTS");
    expect(html).toContain('role="search"');
    expect(html).toContain('action="/charts"');
    expect(html).toContain(`/covers/${slugOf("song-9")}/bg.jpg`);
    // The newest entry leads the editorial card; the following six fill the grid.
    expect(html).toContain("曲目 9");
    expect(html).toContain("曲目 3");
  });

  test("charts route renders the zh list view", async () => {
    const { default: ChartsPage } = await import("./(default)/charts/page");

    const html = renderToStaticMarkup(await ChartsPage());

    expect(html).toContain("浏览曲目");
    expect(html).toContain("按分类、分支与显示语言浏览 AstroDX 目录条目。");
    expect(html).toContain('data-layout="card-grid"');
    expect(html).toContain('href="/charts/song-1"');
    expect(html).toContain("曲目 1");
  });

  test("chart detail route renders the zh detail view and actions", async () => {
    const { default: ChartDetailPage, dynamicParams, generateStaticParams } = await import(
      "./(default)/charts/[slug]/page"
    );
    const expectedSlugs = entries.map((entry) => entry.slug!);

    const html = renderToStaticMarkup(
      await ChartDetailPage({
        params: Promise.resolve({ slug: slugOf("song-3◆phase") }),
      })
    );

    expect(dynamicParams).toBe(false);
    expect(await generateStaticParams()).toEqual(expectedSlugs.map((slug) => ({ slug })));
    expect(html).toContain("曲目 3");
    expect(html).toContain("谱面信息");
    expect(html).toContain("难度列表");
    // The old "资源状态" card repeated the hero's badges verbatim; the slot now
    // carries the measured numbers instead.
    expect(html).not.toContain("资源状态");
    expect(html).toContain("来源信息");
    expect(html).toContain(`/covers/${slugOf("song-3◆phase")}/bg.jpg`);
    expect(html).toContain("站内下载");
    expect(html).toContain("来源链接");
  });

  test("community route renders the zh community view", async () => {
    const { default: CommunityPage } = await import("./(default)/community/page");

    const html = renderToStaticMarkup(<CommunityPage />);

    expect(html).toContain("社区");
    expect(html).toContain("QQ 交流群");
    expect(html).toContain("Telegram 群组");
    expect(html).toContain("https://qm.qq.com/q/xltNzTdL1u");
    expect(html).toContain("https://t.me/FullDiveSAO");
  });

  test("donate route renders the zh donate view with methods and TRC20 address", async () => {
    const { default: DonatePage } = await import("./(default)/donate/page");

    const html = renderToStaticMarkup(<DonatePage />);

    expect(html).toContain("捐赠支持");
    expect(html).toContain("爱发电");
    expect(html).toContain("Patreon");
    expect(html).toContain("https://afdian.com/a/scale");
    expect(html).toContain("https://patreon.com/KirigayaAsuna");
    expect(html).toContain("TGXpGgXBrFGjQLX8WuS3QAswCGzFyrnp1r");
    expect(html).toContain("复制地址");
    expect(html).toContain("https://tronscan.org/address/TGXpGgXBrFGjQLX8WuS3QAswCGzFyrnp1r");
    expect(html).toContain("在 Tronscan 查看");
  });

  test("about route renders the zh about view", async () => {
    const { default: AboutPage } = await import("./(default)/about/page");

    const html = renderToStaticMarkup(<AboutPage />);

    expect(html).toContain("关于本站");
    expect(html).toContain("联系方式");
    expect(html).toContain("开源与技术");
    expect(html).toContain("鸣谢");
    expect(html).toContain("免责声明");
    expect(html).toContain("https://github.com/AdingApkgg/adx-dl");
  });

  test("guide route renders the zh walkthrough with stable anchors and HowTo/FAQ data", async () => {
    const { default: GuidePage } = await import("./(default)/guide/page");

    const html = renderToStaticMarkup(<GuidePage />);

    expect(html).toContain("导入谱面");
    expect(html).toContain('id="install"');
    expect(html).toContain('id="download"');
    expect(html).toContain('id="import"');
    expect(html).toContain('id="troubleshooting"');
    expect(html).toContain('href="#troubleshooting"');
    expect(html).toContain('"@type":"HowTo"');
    expect(html).toContain('"@type":"FAQPage"');
    // The FAQ answers must be on the page, not only in the JSON-LD.
    expect(html).toContain("下载卡住不动");
    expect(html).toContain("https://github.com/AdingApkgg/adx-dl/issues");
  });

  test("changelog route groups the zh catalog into dated import batches", async () => {
    const { default: ChangelogPage } = await import("./(default)/changelog/page");

    const html = renderToStaticMarkup(await ChangelogPage());

    expect(html).toContain("更新日志");
    // Newest import day first; each fixture entry landed on its own day.
    expect(html.indexOf("2026-06-09 入库")).toBeLessThan(html.indexOf("2026-06-08 入库"));
    expect(html).toContain("曲目 9");
    expect(html).toContain("涉及版本");
  });

  test("music route lists per-version playlists with play controls", async () => {
    const { default: MusicPage } = await import("./(default)/music/page");

    const html = renderToStaticMarkup(await MusicPage());

    expect(html).toContain("音乐库");
    expect(html).toContain('aria-label="播放「maimai MURASAKi PLUS」"');
    expect(html).toContain("1 首");
  });

  test("post route renders the zh submission form", async () => {
    const { default: PostPage } = await import("./(default)/post/page");

    const html = renderToStaticMarkup(<PostPage />);

    expect(html).toContain("谱面投稿");
    expect(html).toContain("曲名（可含别名）");
    expect(html).toContain("谱面来源 / 下载链接");
    expect(html).toContain("前往留言板投稿");
  });

  test("survey route renders the zh survey form", async () => {
    const { default: SurveyPage } = await import("./(default)/survey/page");

    const html = renderToStaticMarkup(<SurveyPage />);

    expect(html).toContain("问卷调查");
    expect(html).toContain("你在哪个平台游玩 AstroDX？");
    expect(html).toContain("对本站的整体满意度？");
    expect(html).toContain("前往留言板提交");
  });
});
