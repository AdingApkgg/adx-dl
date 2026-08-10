import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { MainRenderer, type RendererConfig } from "@lxns-network/maimai-chart-engine";

import { MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from "./store/settings-store";

/**
 * Guards the local patches applied to the vendored chart engine
 * (see packages/maimai-chart-engine/README.md → "Local patches").
 *
 * Most of those patches add methods, so re-syncing over one breaks the
 * typecheck and gets noticed immediately. The playback-speed patch is the
 * exception: it only widens a runtime bound inside `setPlaybackSpeed`, so a
 * re-sync would leave every call site compiling happily while speeds above 1×
 * silently stopped applying. That is what this file is really here for.
 */

/**
 * The renderer only needs enough of a canvas to construct: `resize()` bails out
 * when there is no parent element, and `loadAssets()` just news up an Image and
 * assigns a src. None of the assertions below draw anything.
 */
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

/**
 * `config` is private and the engine exposes no getter — adding one would be a
 * fourth local patch to maintain, which is worse than reaching past a
 * compile-time-only modifier in a test.
 */
function configOf(renderer: MainRenderer): RendererConfig {
  return (renderer as unknown as { config: RendererConfig }).config;
}

describe("vendored engine local patches", () => {
  // The constructor's loadAssets() does `new Image()`. Installed and removed
  // around this suite rather than left on globalThis — a leaked global would
  // change how unrelated files behave depending on test order.
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

  test("setPlaybackSpeed accepts the whole range the settings store offers", () => {
    const renderer = createRenderer();

    // Upstream clamps at 1.0 (slow-down practice only); the patch raises the
    // ceiling so players can also follow along above real time.
    expect(MAX_PLAYBACK_SPEED).toBe(2);
    renderer.setPlaybackSpeed(MAX_PLAYBACK_SPEED);
    expect(configOf(renderer).playbackSpeed).toBe(MAX_PLAYBACK_SPEED);

    renderer.setPlaybackSpeed(MIN_PLAYBACK_SPEED);
    expect(configOf(renderer).playbackSpeed).toBe(MIN_PLAYBACK_SPEED);
  });

  test("setPlaybackSpeed still ignores values outside that range", () => {
    const renderer = createRenderer();
    renderer.setPlaybackSpeed(1.5);

    renderer.setPlaybackSpeed(2.5);
    renderer.setPlaybackSpeed(0);

    expect(configOf(renderer).playbackSpeed).toBe(1.5);
  });

  test("the HUD counter setters toggle their config flags", () => {
    const renderer = createRenderer();
    expect(configOf(renderer).showNoteTotal).toBe(true);

    renderer.setShowNoteTotal(false);
    renderer.setShowBreakCount(false);

    expect(configOf(renderer).showNoteTotal).toBe(false);
    expect(configOf(renderer).showBreakCount).toBe(false);
  });

  test("setHudLabels merges, so an unset label keeps the upstream default", () => {
    const renderer = createRenderer();
    renderer.setHudLabels({ combo: "COMBO" });

    const labels = (renderer as unknown as { hudLabels: { combo: string; breakNoEx: string } })
      .hudLabels;
    expect(labels.combo).toBe("COMBO");
    expect(labels.breakNoEx).toBe("无保护");
  });
});
