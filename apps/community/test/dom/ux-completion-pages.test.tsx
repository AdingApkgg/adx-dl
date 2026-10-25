import type { ComponentType } from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { m } from "@/paraglide/messages.js";
import { GovernanceNavigation } from "@/client/components/governance-ui";
import { PublicChartBrowser, PublicChartSearchForm } from "@/client/components/public-chart-browser";
import { SocialPager } from "@/client/components/social-pager";
import Help from "@/client/routes/help";
import Privacy from "@/client/routes/privacy";
const HelpPage = Help as unknown as ComponentType<{params:{topic?:string}}>;
const PrivacyPage = Privacy as unknown as ComponentType<{loaderData:{contactEmail:string|null}}>;

test("help has one active topic and leads directly to its existing upload workflow", () => {
 render(<MemoryRouter initialEntries={["/help/upload"]}><HelpPage params={{topic:"upload"}}/></MemoryRouter>);
 const nav=screen.getByRole("navigation",{name:m.ui_help_navigation()});expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1);
 expect(within(nav).getByRole("link",{name:m.site_help_upload_title()}).getAttribute("aria-current")).toBe("page");
 expect(screen.getByRole("link",{name:m.ui_help_continue({topic:m.site_help_upload_title()})}).getAttribute("href")).toBe("/me/charts/new");
});
test("unknown help topics offer a route back to the full help index", () => {
 render(<MemoryRouter initialEntries={["/help/unknown"]}><HelpPage params={{topic:"unknown"}}/></MemoryRouter>);
 expect(screen.getByRole("status").textContent).toBe(m.site_help_missing());expect(screen.getAllByRole("link",{name:m.ui_help_all()}).some(a=>a.getAttribute("href")==="/help")).toBe(true);
});
test("privacy anchors point at real sections while original policy content remains readable", () => {
 render(<MemoryRouter><PrivacyPage loaderData={{contactEmail:null}}/></MemoryRouter>);
 const nav=screen.getByRole("navigation",{name:m.ui_content_navigation()});for(const link of within(nav).getAllByRole("link")){expect(document.getElementById(link.getAttribute("href")!.slice(1))).not.toBeNull();}
 expect(screen.getByText(m.privacy_backups())).toBeTruthy();expect(screen.getByText(m.privacy_awmc())).toBeTruthy();expect(screen.getByText(m.governance_privacy())).toBeTruthy();
});
test("case navigation distinguishes chart reports from decisions and appeals", () => {
 render(<MemoryRouter><GovernanceNavigation view="reports"/></MemoryRouter>);
 const nav=screen.getByRole("navigation",{name:m.ui_case_navigation()});expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1);expect(within(nav).getByRole("link",{name:m.ui_chart_reports()}).getAttribute("aria-current")).toBe("page");
});
test("advanced-only empty chart filters offer a scoped reset instead of claiming the catalog is empty", () => {
 render(<MemoryRouter initialEntries={["/u/7?levels=15"]}><PublicChartBrowser page={{items:[],nextCursor:null}} filters={{q:"",sort:"updated",levels:["15"]}} base="/u/7"/></MemoryRouter>);
 expect(screen.getByRole("status").textContent).toBe(m.public_charts_no_results());expect(screen.getByRole("link",{name:m.public_charts_clear()}).getAttribute("href")).toBe("/u/7");
 expect(screen.queryByRole("navigation",{name:m.public_charts_pagination()})).toBeNull();
});
test("filter chips describe the removal action and empty cursor pagination creates no landmark", () => {
 render(<MemoryRouter initialEntries={["/charts?tag=TEST"]}><PublicChartSearchForm filters={{q:"",sort:"updated",tags:["TEST"]}} base="/charts"/><SocialPager base="/me/reports" nextCursor={null}/></MemoryRouter>);
 expect(screen.getByRole("link",{name:m.ui_remove_filter({filter:"TEST"})}).getAttribute("href")).toBe("/charts");expect(screen.queryByRole("navigation",{name:m.social_pagination()})).toBeNull();
});
