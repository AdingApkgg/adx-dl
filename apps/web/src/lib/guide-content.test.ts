import { describe, expect, test } from "bun:test";

import {
  GUIDE_SECTION_IDS,
  guideFaqItems,
  guideHowToSteps,
  guideSections,
} from "@/lib/guide-content";
import { locales } from "@/lib/i18n";

describe("guide content", () => {
  test("every locale ships the same sections in the same order", () => {
    for (const locale of locales) {
      expect(guideSections[locale].map((section) => section.id)).toEqual([
        ...GUIDE_SECTION_IDS,
      ]);
      for (const section of guideSections[locale]) {
        expect(section.heading.length).toBeGreaterThan(0);
        expect(section.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  test("FAQ items come from the rendered troubleshooting section", () => {
    for (const locale of locales) {
      const items = guideFaqItems(locale);
      const rendered = guideSections[locale]
        .find((section) => section.id === "troubleshooting")!
        .blocks.flatMap((block) => (block.type === "qa" ? block.items : []));

      expect(items).toEqual(rendered);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.q.length).toBeGreaterThan(0);
        expect(item.a.length).toBeGreaterThan(0);
      }
    }
  });

  test("HowTo steps cover the walkthrough sections and anchor at them", () => {
    for (const locale of locales) {
      const steps = guideHowToSteps(locale);

      expect(steps.map((step) => step.anchor)).toEqual([
        "install",
        "download",
        "import",
      ]);
      for (const step of steps) {
        expect(step.name.length).toBeGreaterThan(0);
        expect(step.text.length).toBeGreaterThan(0);
      }
    }
  });

  test("HowTo step text flattens prose and lists but drops link blocks", () => {
    const [install] = guideHowToSteps("en");

    expect(install.text).toContain("AstroDX is a community-built");
    expect(install.text).toContain("Android: download the latest APK");
    expect(install.text).not.toContain("https://");
  });

  /**
   * These two assertions exist because the first draft of this page was written
   * from memory instead of from the wiki, and got both facts backwards: it told
   * iOS users to sideload an IPA (AstroDX has been on the App Store since
   * 2026-05) and told everyone to drop charts into `levels/` (which the wiki
   * lists as a known way to end up with no songs). Both read plausibly, so the
   * cheapest guard is to fail the build if either comes back.
   */
  test("points iOS at the App Store, not at a sideloading tool", () => {
    for (const locale of ["zh", "en", "ja"] as const) {
      const install = guideHowToSteps(locale).find((step) => step.anchor === "install");
      expect(install).toBeDefined();
      expect(install!.text).toContain("App Store");
      // Naming AltStore/SideStore can only be an instruction — unlike the word
      // "sideload", which the copy uses to say the old advice is retired.
      for (const tool of ["AltStore", "SideStore"]) {
        expect(install!.text).not.toContain(tool);
      }
    }
  });

  test("never sends the reader into the levels folder", () => {
    for (const locale of ["zh", "en", "ja"] as const) {
      const importStep = guideHowToSteps(locale).find((step) => step.anchor === "import");
      expect(importStep).toBeDefined();
      // `levels` is still mentioned — the guide explains what the folder holds
      // and warns against using it — but never as a destination.
      for (const instruction of ["into the levels", "放进 levels", "levels に入れ", "levels/"]) {
        expect(importStep!.text).not.toContain(instruction);
      }
    }
  });
});
