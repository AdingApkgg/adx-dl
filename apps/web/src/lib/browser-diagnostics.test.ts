import { expect, test } from "bun:test";
import { redactDiagnosticUrls, probeDownloadCache } from "./browser-diagnostics";
import { compatibilityBootScript, readCompatibilityPreference } from "./browser-compatibility-preference";

test("diagnostics remove URL secrets while retaining the failing resource path", () => {
  expect(redactDiagnosticUrls("HTTP 403 https://user:secret@mirror.test/charts/a.mp3?token=private#password"))
    .toBe("HTTP 403 https://mirror.test/charts/a.mp3");
});

test("unavailable download storage settles without waiting for a write", async () => {
  expect(await probeDownloadCache(undefined)).toBe("unavailable");
});

test("a stalled storage request has a bounded fallback", async () => {
  const request = {};
  const factory = { open: () => request, deleteDatabase: () => ({}) } as unknown as IDBFactory;
  expect(await probeDownloadCache(factory, 5)).toBe("timeout");
});

test("compatibility preference safely handles denied storage and invalid values", () => {
  expect(readCompatibilityPreference({ getItem: () => { throw new Error("Denied"); } })).toBe(false);
  expect(readCompatibilityPreference({ getItem: () => "corrupt" })).toBe(false);
  expect(readCompatibilityPreference({ getItem: () => "simple" })).toBe(true);
});

test("the before-paint script applies the stored mode and survives blocked storage", () => {
  const execute = (getItem: () => string | null) => {
    const root = { dataset: {} as Record<string, string> };
    new Function("document", "localStorage", compatibilityBootScript())({ documentElement: root }, { getItem });
    return root.dataset.compatibility;
  };
  expect(execute(() => "simple")).toBe("simple");
  expect(execute(() => "normal")).toBe("normal");
  expect(execute(() => { throw new Error("Denied"); })).toBe("normal");
});
