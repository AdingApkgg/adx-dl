import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { readMascotHidden } from "./mascot-preference";
import {
  groupCostumes,
  idlePool,
  type ModelList,
  restoreSelection,
  seasonGreeting,
  stripTags,
  timeGreeting,
  type WaifuTips,
  welcomeMessage,
} from "./waifu";

const tips = JSON.parse(
  readFileSync(new URL("../../../public/live2d/waifu-tips.json", import.meta.url), "utf8")
) as WaifuTips;

const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour);

const page = (pathname: string, extra: { title?: string; referrer?: string } = {}) => ({
  pathname,
  title: extra.title ?? "使用指南 | ADX 谱面资源",
  referrer: extra.referrer ?? "",
  hostname: "adxdls.saop.cc",
});

describe("waifu tips", () => {
  test("every hour of the day has exactly one greeting", () => {
    for (let hour = 0; hour < 24; hour++) {
      const matches = tips.time.filter((t) => {
        const [a, b] = t.hour.split("-").map(Number);
        return hour >= (a ?? -1) && hour <= (b ?? -1);
      });
      expect(matches.length).toBe(1);
    }
  });

  test("time greetings are always a single string, including the late-night pool", () => {
    const greeting = timeGreeting(tips, at(3, 1, 23));
    expect(typeof greeting).toBe("string");
    expect(["已经这么晚了呀，早点休息吧，晚安～", "深夜时要爱护眼睛呀！"]).toContain(greeting);
  });

  test("the mascot's own controls all have hover lines", () => {
    const selectors = tips.mouseover.map((m) => m.selector);
    for (const id of ["hitokoto", "asteroids", "switch-model", "switch-texture", "photo", "info", "quit"]) {
      expect(selectors).toContain(`#waifu-tool-${id}`);
    }
    expect(selectors[0]).toBe("#waifu-canvas");
  });
});

describe("seasonGreeting", () => {
  test("matches single days and inclusive ranges and fills in the year", () => {
    expect(seasonGreeting(tips, at(1, 1))).toContain("今年是2026年");
    expect(seasonGreeting(tips, at(11, 5))).toContain("双十一");
    expect(seasonGreeting(tips, at(11, 12))).toContain("双十一");
    expect(seasonGreeting(tips, at(11, 13))).toBeNull();
  });

  test("feeds the idle pool only while the festival lasts", () => {
    expect(idlePool(tips, at(7, 15))).toEqual(tips.message.default);
    expect(idlePool(tips, at(10, 1))).toHaveLength(tips.message.default.length + 1);
  });
});

describe("welcomeMessage", () => {
  test("greets by time of day on every locale's home page", () => {
    const expected = timeGreeting(tips, at(3, 1, 9));
    for (const pathname of ["/", "/en", "/ja/"]) {
      expect(welcomeMessage(tips, page(pathname), at(3, 1, 9))).toBe(expected);
    }
  });

  test("names the page without the site suffix", () => {
    expect(welcomeMessage(tips, page("/guide"))).toBe("欢迎来到「使用指南」");
  });

  test("names the search engine or site a visitor came from", () => {
    expect(
      welcomeMessage(tips, page("/guide", { referrer: "https://www.google.com/search?q=adx" }))
    ).toBe("Hello！来自 谷歌搜索 的朋友，欢迎来到「使用指南」");
    expect(welcomeMessage(tips, page("/guide", { referrer: "https://example.org/x" }))).toBe(
      "Hello！来自 example.org 的朋友，欢迎来到「使用指南」"
    );
    expect(
      welcomeMessage(tips, page("/guide", { referrer: "https://adxdls.saop.cc/charts" }))
    ).toBe("欢迎来到「使用指南」");
  });
});

describe("model selection", () => {
  const list: ModelList = {
    models: [["asuna/a", "asuna/b", "asuna/c"], "pio", ["tia/a", "tia/b"]],
    messages: ["", "", ""],
  };

  test("expands single models and missing groups", () => {
    expect(groupCostumes(list, 1)).toEqual(["pio"]);
    expect(groupCostumes(list, 9)).toEqual([]);
  });

  test("restores a saved outfit, clamped to the group", () => {
    expect(restoreSelection(list, { group: "2", costume: "1" })).toEqual({ group: 2, costume: 1 });
    expect(restoreSelection(list, { group: "2", costume: "7" })).toEqual({ group: 2, costume: 1 });
  });

  test("falls back to a random outfit of the first group", () => {
    const random = () => 0.99;
    expect(restoreSelection(list, { group: null, costume: null }, random)).toEqual({ group: 0, costume: 2 });
    expect(restoreSelection(list, { group: "42", costume: "0" }, random)).toEqual({ group: 0, costume: 2 });
    expect(restoreSelection(list, { group: "x", costume: "0" }, random)).toEqual({ group: 0, costume: 2 });
  });
});

test("speech bubbles drop highlight markup", () => {
  expect(stripTags("今天是<span>植树节</span>，要保护环境呀！")).toBe("今天是植树节，要保护环境呀！");
});

test("the dismissed flag survives denied storage and unknown values", () => {
  expect(readMascotHidden({ getItem: () => { throw new Error("Denied"); } })).toBe(false);
  expect(readMascotHidden({ getItem: () => null })).toBe(false);
  expect(readMascotHidden({ getItem: () => "0" })).toBe(false);
  expect(readMascotHidden({ getItem: () => "1" })).toBe(true);
});
