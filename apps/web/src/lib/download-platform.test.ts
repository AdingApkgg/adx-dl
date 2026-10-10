import { expect, test } from "bun:test";
import { detectDownloadPlatform } from "./download-platform";

test("desktop-mode iPads receive the iOS import steps", () => {
  expect(detectDownloadPlatform({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    platform: "MacIntel", maxTouchPoints: 5,
  })).toBe("ios");
});

test("a Mac without touch stays on the computer transfer steps", () => {
  expect(detectDownloadPlatform({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    platform: "MacIntel", maxTouchPoints: 0,
  })).toBe("desktop");
});

test("mobile devices receive their own file import route", () => {
  expect(detectDownloadPlatform({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    platform: "iPhone", maxTouchPoints: 5,
  })).toBe("ios");
  expect(detectDownloadPlatform({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    platform: "Linux armv8l", maxTouchPoints: 5,
  })).toBe("android");
});
