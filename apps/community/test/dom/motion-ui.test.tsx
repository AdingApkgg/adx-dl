import { MotionProvider, useMotionPreference } from "@astrodx/ui/motion";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { MotionGroup, MotionSurface, MotionSuccess, RouteMotion } from "@/client/components/motion-ui";

// 只替换浏览器动画调度器；组件、列表 key、路由、偏好 Provider 和 DOM 都使用真实实现。
const driver = vi.hoisted(() => ({
  animate: vi.fn((_element: Element, _frames: unknown, _options: unknown) => ({ complete: vi.fn(), stop: vi.fn() })),
}));
vi.mock("@astrodx/ui/motion", async importOriginal => {
  const original = await importOriginal<typeof import("@astrodx/ui/motion")>();
  const { useRef } = await import("react");
  return { ...original, useAnimate: () => [useRef<HTMLDivElement>(null), driver.animate] as const };
});
beforeEach(() => driver.animate.mockClear());

function Preferences() {
  const { setMode } = useMotionPreference();
  return <><button onClick={() => setMode("off")}>Disable motion</button><button onClick={() => setMode("on")}>Enable motion</button></>;
}
function Editor() {
  const [privateVisible, setPrivateVisible] = useState(true);
  return <><button onClick={() => setPrivateVisible(false)}>Revoke access</button>{privateVisible ? <label>Private draft<input defaultValue="Original" /></label> : null}</>;
}
function editorRouter(provider = true) {
  const content = <><Preferences /><RouteMotion><Editor /></RouteMotion></>;
  const router = createMemoryRouter([{ path: "*", element: provider ? <MotionProvider>{content}</MotionProvider> : content }], { initialEntries: ["/draft"] });
  render(<RouterProvider router={router} />);
  return router;
}

test("SSR exposes the real content and preserves list/Card semantics without an initial hidden state", () => {
  const html = renderToString(<MotionGroup as="ul"><MotionSurface key="one" as="li"><h2>Readable chart</h2></MotionSurface><MotionSurface key="two" as="li">Second chart</MotionSurface></MotionGroup>);
  const parent = document.createElement("div"); parent.innerHTML = html;
  expect(parent.querySelector("ul")?.children.length).toBe(2);
  expect([...parent.querySelector("ul")!.children].map(child => child.tagName)).toEqual(["LI", "LI"]);
  expect(parent.textContent).toContain("Readable chart");
  expect(parent.querySelector('[style*="opacity:0"], [hidden], [tabindex]')).toBeNull();
  const card = renderToString(<MotionSurface as="card">Login form remains visible</MotionSurface>);
  expect(card).toContain('data-slot="card"'); expect(card).toContain("Login form remains visible");
});

test("query/hash changes keep the input, focus and route instance; only pathname changes enter", async () => {
  localStorage.setItem("adx-reduce-motion", "on");
  const router = editorRouter(), input = screen.getByRole("textbox", { name: "Private draft" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Unsaved edits" } }); input.focus();
  const route = document.querySelector('[data-community-motion="route"]');
  await act(async () => { await router.navigate("/draft?sort=new#notes"); });
  expect(driver.animate).not.toHaveBeenCalled();
  await act(async () => { await router.navigate("/another-draft?sort=new"); });
  expect(driver.animate).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-community-motion="route"]')).toBe(route);
  expect(screen.getByRole("textbox", { name: "Private draft" })).toBe(input);
  expect(input.value).toBe("Unsaved edits"); expect(document.activeElement).toBe(input);
});

test("turning motion off completes an in-flight entry and prevents subsequent entries", async () => {
  localStorage.setItem("adx-reduce-motion", "on");
  const router = editorRouter();
  await act(async () => { await router.navigate("/another-draft"); });
  expect(driver.animate).toHaveBeenCalledTimes(1);
  const controls = driver.animate.mock.results[0]!.value;
  fireEvent.click(screen.getByRole("button", { name: "Disable motion" }));
  expect(controls.complete).toHaveBeenCalledTimes(1); expect(controls.stop).toHaveBeenCalledTimes(1);
  await act(async () => { await router.navigate("/third-draft"); });
  expect(driver.animate).toHaveBeenCalledTimes(1);
});

test("the boot-script off preference blocks entry before the Provider has synchronized", async () => {
  document.documentElement.dataset.motion = "off";
  const router = editorRouter(false);
  await act(async () => { await router.navigate("/another-draft"); });
  expect(driver.animate).not.toHaveBeenCalled();
});

test("access revocation removes private content immediately during an entry", async () => {
  localStorage.setItem("adx-reduce-motion", "on");
  const router = editorRouter();
  await act(async () => { await router.navigate("/another-draft"); });
  expect(driver.animate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
  expect(screen.queryByRole("textbox", { name: "Private draft" })).toBeNull();
  expect(document.body.textContent).not.toContain("Private draft");
});

test("reordering a long keyed group retains the edited DOM node and direct list items", () => {
  const ids = Array.from({ length: 30 }, (_, index) => String(index));
  const list = (order: string[]) => <MotionGroup as="ul">{order.map(id => <MotionSurface key={id} as="li"><input aria-label={`Chart ${id}`} defaultValue={id} /></MotionSurface>)}</MotionGroup>;
  const view = render(list(ids)), input = screen.getByRole("textbox", { name: "Chart 0" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Edited" } }); input.focus();
  view.rerender(list([...ids].reverse()));
  expect(screen.getByRole("textbox", { name: "Chart 0" })).toBe(input); expect(input.value).toBe("Edited");
  expect([...view.container.querySelector("ul")!.children].every(child => child.tagName === "LI")).toBe(true);
});

test("disabled success feedback uses a static decorative icon", () => {
  document.documentElement.dataset.motion = "off";
  const view = render(<MotionSuccess />);
  expect(view.container.querySelector("svg.lucide-check")).not.toBeNull();
  expect(view.container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  expect(view.container.querySelector('[style*="opacity:0"]')).toBeNull();
});
