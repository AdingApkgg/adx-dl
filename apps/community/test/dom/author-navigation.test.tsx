import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { m } from "@/paraglide/messages.js";
import { AuthorNavigation } from "@/client/components/author-navigation";

test("the active comparison retains both selected versions while review keeps the current difficulty", () => {
  render(<MemoryRouter initialEntries={["/me/charts/chart-a/compare?left=v1&right=v2&difficulty=6"]}><AuthorNavigation id="chart-a" view="compare" version="v2" difficulty={6}/></MemoryRouter>);
  const nav = screen.getByRole("navigation", { name: m.ui_author_navigation() }), active = nav.querySelector('[aria-current="page"]');
  expect(active?.getAttribute("href")).toBe("/me/charts/chart-a/compare?left=v1&right=v2&difficulty=6");
  expect(within(nav).getByRole("link", { name: m.author_review() }).getAttribute("href")).toBe("/me/charts/chart-a/review?version=v2&difficulty=6");
});
test("new uploads show one current workflow step and an explicit help destination", () => {
  render(<MemoryRouter initialEntries={["/me/charts/new"]}><AuthorNavigation view="new"/></MemoryRouter>);
  const nav = screen.getByRole("navigation", { name: m.ui_author_navigation() }); expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1); expect(within(nav).getByRole("link", { name: m.site_help() }).getAttribute("href")).toBe("/help/upload");
});
