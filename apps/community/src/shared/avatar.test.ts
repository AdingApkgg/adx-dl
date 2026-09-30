import { describe, expect, test } from "bun:test";

import { AVATAR_COLORS, avatarColor, avatarInitial } from "./avatar";

describe("avatarInitial", () => {
  test("昵称的第一个字符；英文字母大写", () => {
    expect(avatarInitial("阿丁")).toBe("阿");
    expect(avatarInitial("ading")).toBe("A");
    expect(avatarInitial("  xyz")).toBe("X");
  });

  // 按码点取：表情不会被劈成半个代理对；组合表情只取第一个码点。
  test("表情算一个字符", () => {
    expect(avatarInitial("😀abc")).toBe("😀");
    expect(avatarInitial("👩‍💻")).toBe("👩");
  });

  test("空昵称用问号", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
  });
});

describe("avatarColor", () => {
  test("同一个 id 永远是同一个颜色，颜色都在调色板里", () => {
    expect(avatarColor("abc2345678")).toBe(avatarColor("abc2345678"));
    expect(AVATAR_COLORS).toContain(avatarColor("abc2345678") as (typeof AVATAR_COLORS)[number]);
  });

  test("不同的 id 分散到不同的颜色上", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `user${String(i).padStart(6, "2")}`);
    expect(new Set(ids.map(avatarColor)).size).toBe(AVATAR_COLORS.length);
  });
});
