import { expect, test } from "bun:test";
import { socialPage } from "./social-page";
import { reportText } from "./chart-reports";
test("private cursors cannot cross accounts, collections or report filters", () => {
  const first = socialPage({}, "favorites:alice");
  const cursor = first.encode(new Date("2026-10-18T00:00:00Z"), "12345678-1234-4234-8234-123456789012");
  expect(socialPage({ cursor }, "favorites:alice").cursor?.id).toBe("12345678-1234-4234-8234-123456789012");
  for (const scope of ["favorites:bob", "reports:alice", "dash-reports:resolved"]) expect(() => socialPage({ cursor }, scope)).toThrow();
  for (const input of [{ limit: 0 }, { limit: 51 }, { cursor: "x".repeat(513) }]) expect(() => socialPage(input, "favorites:alice")).toThrow();
});
test("report text counts Unicode codepoints and rejects invisible control characters", () => {
  expect(reportText("  音源に問題\nDetails  ")).toBe("音源に問題\nDetails");
  expect(reportText("🦀".repeat(500))).toHaveLength(1000);
  for (const value of [" ", "a".repeat(501), "x\u0000", "x\u0007"]) expect(() => reportText(value)).toThrow();
});
