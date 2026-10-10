import { expect, test } from "bun:test";
import { requiresManualArchiveSave } from "./adx-archive-shared";

// ArkWeb's documented Mobile suffix also occurs on PCs; DeviceType decides.
for (const [deviceType, manual] of [
  ["Phone", true],
  ["Tablet", true],
  ["PC", false],
] as const) {
  test(`OpenHarmony ${deviceType} receives the correct archive save policy`, () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: `Mozilla/5.0 (${deviceType}; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36  ArkWeb/4.1.6.1 Mobile`,
        platform: "Linux aarch64",
        maxTouchPoints: 5,
      },
    });
    try {
      expect(requiresManualArchiveSave()).toBe(manual);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });
}
