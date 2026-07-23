import { describe, expect, test } from "bun:test";

import {
  announceMediaPlay,
  MEDIA_PLAY_EVENT,
  type MediaOwner,
} from "@/lib/media-coordination";

describe("media coordination", () => {
  test("announces the owner that started playback", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const target = new EventTarget();
    const owners: MediaOwner[] = [];

    target.addEventListener(MEDIA_PLAY_EVENT, (event) => {
      owners.push((event as CustomEvent<MediaOwner>).detail);
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: target,
    });

    try {
      announceMediaPlay("chart-preview");
      announceMediaPlay("global-music");
      expect(owners).toEqual(["chart-preview", "global-music"]);
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  test("is safe to call during server rendering", () => {
    expect(typeof window).toBe("undefined");
    expect(() => announceMediaPlay("chart-preview")).not.toThrow();
  });
});
