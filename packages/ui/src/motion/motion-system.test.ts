import { describe, expect, test } from "vitest";

import { getMotionPreset, getSemanticTransition, getProgressTransition, toMotionSpring } from "./adapters/motion";
import { getStaggerDelay, resolveReducedMotion } from "./policy";

describe("motion policy and adapters", () => {
  test("temporary reduction wins over explicit animation, while on overrides the OS", () => {
    expect(resolveReducedMotion("on", true, false)).toBe(false);
    expect(resolveReducedMotion("on", false, true)).toBe(true);
    expect(resolveReducedMotion("system", true, false)).toBe(true);
    expect(resolveReducedMotion("system", false, false)).toBe(false);
    expect(resolveReducedMotion("off", false, false)).toBe(true);
  });

  test("converts damping ratio to a coefficient instead of passing it through", () => {
    expect(toMotionSpring({ stiffness: 100, dampingRatio: 0.5, mass: 4 })).toEqual({
      type: "spring", stiffness: 100, damping: 20, mass: 4,
    });
  });

  test("keeps opacity non-bouncing independently of an expressive spatial spring", () => {
    const dialog = getMotionPreset("dialog");
    expect(dialog.initial).toEqual({ opacity: 0, y: 12, scale: 0.96 });
    expect(dialog.animate).toMatchObject({ opacity: 1, y: 0, scale: 1 });
    const transition = dialog.transition as { default: { stiffness: number; damping: number }; opacity: { stiffness: number; damping: number } };
    expect(transition.default.damping ** 2).toBeLessThan(4 * transition.default.stiffness);
    expect(transition.opacity.damping ** 2).toBeCloseTo(4 * transition.opacity.stiffness);
  });

  test("reduced presets show final state immediately, including exit and delays", () => {
    const popup = getMotionPreset("popup", { reduced: true, delayMs: 200 });
    expect(popup.initial).toBe(false);
    expect(popup.animate).toEqual({ opacity: 1, y: 0 });
    expect(popup.exit).toMatchObject({ opacity: 0, transition: { duration: 0, delay: 0 } });
    expect(popup.transition).toEqual({ duration: 0, delay: 0 });
  });

  test("dense selection has no bounce and layout keeps expressive movement", () => {
    const selected = getSemanticTransition("selection") as { default: { damping: number; stiffness: number } };
    const layout = getSemanticTransition("layout") as { default: { damping: number; stiffness: number } };
    expect(selected.default.damping ** 2).toBeCloseTo(4 * selected.default.stiffness);
    expect(layout.default.damping ** 2).toBeLessThan(4 * layout.default.stiffness);
    expect(getSemanticTransition("layout", true)).toEqual({ duration: 0, delay: 0 });
  });

  test("progress uses a finite non-bouncing interpolation and reduction is immediate", () => {
    expect(getProgressTransition(false)).toMatchObject({ type: "tween", ease: "linear" });
    expect(getProgressTransition(true)).toMatchObject({ duration: 0, delay: 0 });
  });

  test("reduced disclosures change height without staggering their rows", () => {
    const disclosure = getMotionPreset("disclosure", { reduced: true });
    expect(disclosure.animate).toEqual({ height: "auto", opacity: 1 });
    expect(disclosure.exit).toMatchObject({ height: 0, opacity: 0, transition: { duration: 0 } });
  });

  test("bounds group delays and leaves large result sets immediately available", () => {
    expect(getStaggerDelay(0, 50)).toBe(0);
    expect(getStaggerDelay(5, 50)).toBe(200);
    expect(getStaggerDelay(6, 50)).toBe(0);
    expect(getStaggerDelay(2, -1)).toBe(0);
  });
});
