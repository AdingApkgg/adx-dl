import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { MainRenderer, type RendererConfig } from "@lxns-network/maimai-chart-engine";

import { clampSlideDelay, MAX_SLIDE_DELAY, MIN_SLIDE_DELAY } from "./store/settings-store";

/** Just enough canvas for the renderer to construct; nothing here draws. */
function createRenderer(): MainRenderer {
  const noop = () => undefined;
  const context = new Proxy({}, { get: () => noop, set: () => true });
  const canvas = {
    width: 600,
    height: 600,
    style: {},
    parentElement: null,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return new MainRenderer(canvas);
}

function configOf(renderer: MainRenderer): RendererConfig {
  return (renderer as unknown as { config: RendererConfig }).config;
}

describe("slide delay (星星延迟)", () => {
  test("clamps to [-1, 1] and snaps to 0.1 steps", () => {
    expect(MIN_SLIDE_DELAY).toBe(-1);
    expect(MAX_SLIDE_DELAY).toBe(1);
    expect(clampSlideDelay(-2)).toBe(-1);
    expect(clampSlideDelay(3)).toBe(1);
    expect(clampSlideDelay(0.34)).toBe(0.3);
    expect(clampSlideDelay(0.35)).toBe(0.4);
    expect(clampSlideDelay(-0.26)).toBe(-0.3);
  });

  test("never stores -0 and rejects non-finite input", () => {
    expect(Object.is(clampSlideDelay(-0.04), 0)).toBe(true);
    expect(clampSlideDelay(Number.NaN)).toBeNull();
    expect(clampSlideDelay(Number.POSITIVE_INFINITY)).toBeNull();
  });

  describe("matches the engine's own rule", () => {
    const hadImage = "Image" in globalThis;
    beforeAll(() => {
      if (!hadImage) {
        (globalThis as { Image?: unknown }).Image = class {
          src = "";
        };
      }
    });
    afterAll(() => {
      if (!hadImage) delete (globalThis as { Image?: unknown }).Image;
    });

    // If a future engine sync changes the bound or the step, the slider would
    // show one value while the renderer used another. Keep the two in lockstep.
    for (const value of [-1.5, -1, -0.26, -0.04, 0, 0.14, 0.35, 0.9, 1, 2]) {
      test(String(value), () => {
        const renderer = createRenderer();
        renderer.setSlideDelay(value);
        expect(configOf(renderer).slideDelay).toBe(clampSlideDelay(value) as number);
      });
    }
  });
});
