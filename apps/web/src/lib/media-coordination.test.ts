import { describe, expect, test } from "bun:test";

import {
  announceMediaPlay,
  isMediaActive,
  MEDIA_ACTIVITY_EVENT,
  MEDIA_PLAY_EVENT,
  type MediaOwner,
  setMediaActive,
  subscribeMediaActivity,
} from "@/lib/media-coordination";

function withFakeWindow(run: (target: EventTarget) => void): void {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  try {
    run(target);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

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

describe("media activity", () => {
  test("tracks start and stop, and notifies only on a real change", () => {
    withFakeWindow((target) => {
      let notifications = 0;
      target.addEventListener(MEDIA_ACTIVITY_EVENT, () => {
        notifications += 1;
      });
      try {
        expect(isMediaActive("chart-preview")).toBe(false);
        setMediaActive("chart-preview", true);
        setMediaActive("chart-preview", true);
        expect(isMediaActive("chart-preview")).toBe(true);
        expect(isMediaActive("global-music")).toBe(false);
        setMediaActive("chart-preview", false);
        expect(isMediaActive("chart-preview")).toBe(false);
        expect(notifications).toBe(2);
      } finally {
        setMediaActive("chart-preview", false);
      }
    });
  });

  test("a subscriber hears changes until it unsubscribes", () => {
    withFakeWindow(() => {
      let calls = 0;
      const unsubscribe = subscribeMediaActivity(() => {
        calls += 1;
      });
      try {
        setMediaActive("chart-preview", true);
        unsubscribe();
        setMediaActive("chart-preview", false);
        expect(calls).toBe(1);
      } finally {
        setMediaActive("chart-preview", false);
      }
    });
  });

  test("keeps the state during server rendering without dispatching", () => {
    expect(typeof window).toBe("undefined");
    try {
      expect(() => setMediaActive("chart-preview", true)).not.toThrow();
      expect(isMediaActive("chart-preview")).toBe(true);
    } finally {
      setMediaActive("chart-preview", false);
    }
  });
});
