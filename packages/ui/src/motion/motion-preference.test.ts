import { describe, expect, test } from "vitest";

import { motionConfigPreference, parseMotionMode } from "./index";

describe("motion preference", () => {
  test("migrates the old binary preference and rejects unknown modes", () => {
    expect(parseMotionMode("1")).toBe("off");
    expect(parseMotionMode("0")).toBe("system");
    expect(parseMotionMode("on")).toBe("on");
    expect(parseMotionMode("off")).toBe("off");
    expect(parseMotionMode("unknown")).toBe("system");
  });

  test("maps modes to Framer MotionConfig behavior", () => {
    expect(motionConfigPreference("system")).toBe("user");
    expect(motionConfigPreference("on")).toBe("never");
    expect(motionConfigPreference("off")).toBe("always");
  });

  test("resolves system mode against the live OS signal", () => {
    expect(motionConfigPreference("system", true)).toBe("always");
    expect(motionConfigPreference("system", false)).toBe("never");
    expect(motionConfigPreference("system", undefined)).toBe("user");
  });

  test("explicit on/off override the OS signal", () => {
    expect(motionConfigPreference("on", true)).toBe("never");
    expect(motionConfigPreference("on", false)).toBe("never");
    expect(motionConfigPreference("off", true)).toBe("always");
    expect(motionConfigPreference("off", false)).toBe("always");
  });
});
