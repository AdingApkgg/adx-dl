import { describe, expect, test } from "bun:test";

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
});
