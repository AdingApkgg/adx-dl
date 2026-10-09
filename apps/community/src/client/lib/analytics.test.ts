import { afterEach, describe, expect, test } from "bun:test";

import { loginMarkerIn, trackEvent, withLoginMarker } from "./analytics";

type Tracked = [string, Record<string, string> | undefined];

const page = globalThis as { umami?: { track(event: string, data?: Record<string, string>): unknown } };

afterEach(() => {
  delete page.umami;
});

describe("trackEvent", () => {
  test("交给 Umami 的 tracker：事件名和附带的数据", () => {
    const tracked: Tracked[] = [];
    page.umami = { track: (event, data) => tracked.push([event, data]) };

    trackEvent("login", { method: "qq" });
    trackEvent("onboarding_done");

    expect(tracked).toEqual([
      ["login", { method: "qq" }],
      ["onboarding_done", undefined],
    ]);
  });

  // 没开统计（没放脚本）、脚本被拦截插件挡掉、tracker 自己出错，页面都要照常走下去。
  test("没有 tracker、tracker 抛错时什么也不做", () => {
    expect(() => trackEvent("onboarding_done")).not.toThrow();
    page.umami = {
      track: () => {
        throw new Error("blocked");
      },
    };
    expect(() => trackEvent("login", { method: "google" })).not.toThrow();
  });
});

describe("登录方式的标记", () => {
  test("加在地址的 # 后面，原来的 # 后面的内容换掉", () => {
    expect(withLoginMarker("/settings/account", "google")).toBe("/settings/account#login=google");
    expect(withLoginMarker("/onboarding?next=%2F", "passkey")).toBe("/onboarding?next=%2F#login=passkey");
    expect(withLoginMarker("/u/abc2345678#bio", "qq")).toBe("/u/abc2345678#login=qq");
  });

  test("只认三种登录方式", () => {
    expect(loginMarkerIn("#login=google")).toBe("google");
    expect(loginMarkerIn("#login=qq")).toBe("qq");
    expect(loginMarkerIn("#login=passkey")).toBe("passkey");
    for (const hash of ["", "#", "#login=", "#login=email", "#login=qq&x=1", "#xlogin=qq"]) {
      expect(loginMarkerIn(hash), hash).toBeNull();
    }
  });
});
