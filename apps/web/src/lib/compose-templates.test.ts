import { describe, expect, test } from "bun:test";

import {
  buildTemplate,
  decideInsert,
  firstFieldOffset,
  parseComposeParam,
} from "@/lib/compose-templates";

describe("parseComposeParam", () => {
  test("accepts the two known kinds", () => {
    expect(parseComposeParam("survey")).toBe("survey");
    expect(parseComposeParam("post")).toBe("post");
  });

  test("rejects anything else, including null", () => {
    expect(parseComposeParam("nope")).toBeNull();
    expect(parseComposeParam(null)).toBeNull();
  });
});

describe("buildTemplate", () => {
  test("zh survey opens with its heading", () => {
    expect(buildTemplate("survey", "zh").startsWith("【问卷反馈】")).toBe(true);
  });

  test("en post opens with its heading", () => {
    expect(buildTemplate("post", "en").startsWith("[Chart Submission]")).toBe(true);
  });

  test("ja survey is a fill-in skeleton, one field per line", () => {
    expect(buildTemplate("survey", "ja").split("\n").length).toBe(6);
  });
});

describe("decideInsert", () => {
  // Regression coverage for the polling path that used to apply unconditionally
  // once Artalk's editor appeared, destroying an unsent (or Artalk-restored)
  // draft. Both insert() and the poll route through this same function now.
  test("force always applies, no matter what the editor holds", () => {
    expect(decideInsert("something the visitor typed", "template", true)).toBe("apply");
  });

  test("an empty editor applies without asking", () => {
    expect(decideInsert("", "template", false)).toBe("apply");
  });

  test("a whitespace-only editor applies without asking", () => {
    expect(decideInsert("   \n\t ", "template", false)).toBe("apply");
  });

  test("an editor already holding exactly this template applies without asking", () => {
    expect(decideInsert("template", "template", false)).toBe("apply");
  });

  test("an editor holding anything else asks first", () => {
    expect(decideInsert("something the visitor typed", "template", false)).toBe("confirm");
  });
});

describe("firstFieldOffset", () => {
  test("lands just past the fullwidth colon of the first field", () => {
    const template = buildTemplate("survey", "zh");
    const offset = firstFieldOffset(template);
    expect(template.slice(0, offset).endsWith("：")).toBe(true);
    // Line 1 is the heading — the caret must be on line 2.
    expect(template.slice(0, offset).split("\n").length).toBe(2);
  });

  test("handles the ASCII colon the en templates use", () => {
    const template = buildTemplate("post", "en");
    const offset = firstFieldOffset(template);
    expect(template.slice(0, offset).endsWith(":")).toBe(true);
  });

  test("a template with no field falls back to the end", () => {
    expect(firstFieldOffset("just a heading")).toBe("just a heading".length);
  });
});
