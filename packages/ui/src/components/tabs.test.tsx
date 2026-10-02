import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderTabs(variant?: "default" | "line") {
  return renderToStaticMarkup(
    <Tabs defaultValue="a">
      <TabsList variant={variant}>
        <TabsTrigger value="a">难度</TabsTrigger>
        <TabsTrigger value="b">谱面</TabsTrigger>
      </TabsList>
      <TabsContent value="a">A 内容</TabsContent>
      <TabsContent value="b">B 内容</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  test("only the active trigger hosts the sliding indicator, visible in SSR HTML", () => {
    const html = renderTabs();
    // The pill background must be prerendered (initial={false}): exactly one
    // indicator, and never with a hidden initial state.
    const indicatorMatches = html.match(/bg-background shadow-sm/g) ?? [];
    expect(indicatorMatches.length).toBe(1);
    expect(html).not.toContain("opacity:0");
    // Labels and roles survive the wrapping.
    expect(html).toContain('role="tablist"');
    expect(html).toContain("难度");
    expect(html).toContain("谱面");
    expect(html).toContain("A 内容");
  });

  test("line variant renders an underline indicator instead of the pill", () => {
    const html = renderTabs("line");
    expect(html).toContain("bg-foreground group-data-horizontal/tabs:inset-x-0");
    expect(html).not.toContain("bg-background shadow-sm");
  });
});
