import { MotionProvider, useMotionPreference } from "@astrodx/ui/motion";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MotionArtwork } from "@/client/components/motion-artwork";
import { MotionHeroBackdrop } from "@/client/components/motion-hero";
import { useMotionActivity } from "@/client/components/motion-preference";

// 只替换可视输入；偏好、可见性订阅、Provider 和业务节点均使用真实实现。
const viewport = vi.hoisted(() => ({ inView: true }));
vi.mock("@astrodx/ui/motion", async importOriginal => ({
  ...await importOriginal<typeof import("@astrodx/ui/motion")>(),
  useInView: () => viewport.inView,
}));
beforeEach(() => { viewport.inView = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Controls() {
  const { setMode } = useMotionPreference();
  return <><button onClick={() => setMode("on")}>Enable</button><button onClick={() => setMode("off")}>Disable</button><button onClick={() => setMode("system")}>System</button></>;
}
function Activity() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useMotionActivity(ref);
  return <div ref={ref} role="status">{String(active)}</div>;
}

test("hero/artwork SSR retain readable content with no focusable decorative scene", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToString(<><MotionHeroBackdrop /><MotionArtwork><h2>Readable cover title</h2></MotionArtwork></>);
  expect(root.querySelector("h2")?.textContent).toBe("Readable cover title");
  expect(root.querySelector('[data-community-motion="ambient"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(root.querySelector('[data-community-motion="ambient"]')?.getAttribute("data-motion-active")).toBe("false");
  expect(root.querySelector('[tabindex], [hidden]')).toBeNull();
  expect(root.querySelector(".community-artwork-plate")?.getAttribute("style") ?? "").not.toMatch(/opacity|rotate[XY]\([1-9]/);
});

test("ambient requires foreground, viewport and enabled motion, and restores after interruption", () => {
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  localStorage.setItem("adx-reduce-motion", "on");
  const view = () => <MotionProvider><Controls /><Activity /></MotionProvider>;
  const result = render(view());
  expect(screen.getByRole("status").textContent).toBe("true");
  act(() => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByRole("status").textContent).toBe("false");
  act(() => { visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByRole("status").textContent).toBe("true");
  viewport.inView = false; result.rerender(view());
  expect(screen.getByRole("status").textContent).toBe("false");
  viewport.inView = true; result.rerender(view());
  fireEvent.click(screen.getByRole("button", { name: "Disable" }));
  expect(screen.getByRole("status").textContent).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Enable" }));
  expect(screen.getByRole("status").textContent).toBe("true");
});

test("boot-script off blocks ambient before a provider synchronizes", () => {
  document.documentElement.dataset.motion = "off";
  render(<Activity />);
  expect(screen.getByRole("status").textContent).toBe("false");
});

test("motion changes retain artwork child identity and unsaved edits", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  localStorage.setItem("adx-reduce-motion", "on");
  render(<MotionProvider><Controls /><MotionArtwork><input aria-label="Retained input" defaultValue="Original" /></MotionArtwork></MotionProvider>);
  const input = screen.getByRole("textbox", { name: "Retained input" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Unsaved" } }); input.focus();
  fireEvent.click(screen.getByRole("button", { name: "Disable" }));
  fireEvent.click(screen.getByRole("button", { name: "Enable" }));
  expect(screen.getByRole("textbox", { name: "Retained input" })).toBe(input);
  expect(input.value).toBe("Unsaved");
});


test("manual on overrides a reduced OS and system mode follows subsequent OS changes", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const listeners = new Set<() => void>();
  const media = { matches: true, media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_event: string, notify: () => void) => { listeners.add(notify); },
    removeEventListener: (_event: string, notify: () => void) => { listeners.delete(notify); },
  };
  const original = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation(query => query === media.media ? media as unknown as MediaQueryList : original(query));
  render(<MotionProvider><Controls /><Activity /></MotionProvider>);
  expect(screen.getByRole("status").textContent).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Enable" }));
  expect(screen.getByRole("status").textContent).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "System" }));
  expect(screen.getByRole("status").textContent).toBe("false");
  act(() => { media.matches = false; for (const notify of listeners) notify(); });
  expect(screen.getByRole("status").textContent).toBe("true");
});
