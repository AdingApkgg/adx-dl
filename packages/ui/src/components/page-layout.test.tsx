import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageShell, PageHeader, Surface } from "./page-layout";

test("provides one main landmark and a page heading with secondary metadata", () => {
  render(<PageShell><PageHeader title="Find charts" description="Search your library" meta="1,934 charts" /><Surface aria-label="Search filters"><input aria-label="Search" /></Surface></PageShell>);
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Find charts");
  expect(screen.getByRole("region", { name: "Search filters" }).contains(screen.getByRole("textbox", { name: "Search" }))).toBe(true);
  expect(screen.getByText("1,934 charts").textContent).toBe("1,934 charts");
});
