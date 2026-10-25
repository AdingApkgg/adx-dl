import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { EmptyState, LoadingState } from "@/client/components/ui-states";

test("empty content offers an explicit destination and never reports loading", () => {
  render(<EmptyState title="Nothing saved" description="Choose a public chart first."><a href="/charts">Browse charts</a></EmptyState>);
  expect(screen.getByRole("status").textContent).toBe("Nothing saved"); expect(screen.getByRole("link", { name: "Browse charts" }).getAttribute("href")).toBe("/charts"); expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});
test("loading has a readable SSR label and decorative bounded placeholders", () => {
  const html = renderToString(<LoadingState label="Reading current data" />); expect(html).toContain('aria-busy="true"'); expect(html).toContain("Reading current data");
  render(<LoadingState label="Reading current data" />); expect(screen.getByRole("status").textContent).toBe("Reading current data"); expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(3);
});
