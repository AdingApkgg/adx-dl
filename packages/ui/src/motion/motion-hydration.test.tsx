import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MOTION_STORAGE_KEY } from "./constants";
import { MotionProvider, useMotionPreference, useReducedMotion } from "./index";

// Only the OS setting is controlled; the hook, provider and React hydration
// are real. Keep a native MediaQueryList so both modern and legacy listeners
// receive the same change event.
const media = window.matchMedia("(prefers-reduced-motion: reduce)");
let osReduced = false;
Object.defineProperty(media, "matches", { get: () => osReduced });
const nativeMatchMedia = window.matchMedia.bind(window);

function setOsReduced(value: boolean) {
  osReduced = value;
  media.dispatchEvent(new MediaQueryListEvent("change", { matches: value, media: media.media }));
}

function MotionControls() {
  const reduced = useReducedMotion();
  const { mode, setMode } = useMotionPreference();
  const [clicks, setClicks] = React.useState(0);
  return (
    <>
      <output aria-label="motion">{reduced ? "reduced" : "full"}</output>
      <output aria-label="mode">{mode}</output>
      {reduced ? null : <div data-testid="scroll-decoration" aria-hidden="true" />}
      <button type="button" onClick={() => setClicks((count) => count + 1)}>Clicks {clicks}</button>
      <button type="button" onClick={() => setMode("on")}>Always animate</button>
      <button type="button" onClick={() => setMode("off")}>Reduce motion</button>
      <button type="button" onClick={() => setMode("system")}>Follow system</button>
    </>
  );
}

beforeEach(() => {
  setOsReduced(false);
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query === media.media ? media : nativeMatchMedia(query)
  );
});

afterEach(() => {
  act(() => setOsReduced(false));
  vi.restoreAllMocks();
});

describe("motion preferences during hydration", () => {
  test("a compatibility override reduces motion without replacing the saved choice", () => {
    const { rerender } = render(<MotionProvider {...{ forceReducedMotion: true }}><MotionControls /></MotionProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Always animate" }));
    expect(screen.getByLabelText("motion").textContent).toBe("reduced");
    expect(screen.getByLabelText("mode").textContent).toBe("on");
    rerender(<MotionProvider {...{ forceReducedMotion: false }}><MotionControls /></MotionProvider>);
    expect(screen.getByLabelText("motion").textContent).toBe("full");
  });
  test("hydrates server decorations without a mismatch when the browser reduces motion", async () => {
    const content = <MotionProvider><MotionControls /></MotionProvider>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(content);
    document.body.append(container);
    setOsReduced(true);
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, content, { onRecoverableError: (error) => errors.push(error) });
      });
      await waitFor(() => expect(screen.getByLabelText("motion").textContent).toBe("reduced"));
      expect(screen.queryByTestId("scroll-decoration")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Clicks 0" }));
      expect(screen.getByRole("button", { name: "Clicks 1" })).toBeTruthy();
      expect(errors).toEqual([]);
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  test("responds to OS changes and lets explicit site choices override them", () => {
    render(<MotionProvider><MotionControls /></MotionProvider>);
    expect(screen.getByLabelText("motion").textContent).toBe("full");
    act(() => setOsReduced(true));
    expect(screen.getByLabelText("motion").textContent).toBe("reduced");
    fireEvent.click(screen.getByRole("button", { name: "Always animate" }));
    expect(screen.getByLabelText("motion").textContent).toBe("full");
    act(() => setOsReduced(false));
    fireEvent.click(screen.getByRole("button", { name: "Reduce motion" }));
    expect(screen.getByLabelText("motion").textContent).toBe("reduced");
    fireEvent.click(screen.getByRole("button", { name: "Follow system" }));
    expect(screen.getByLabelText("motion").textContent).toBe("full");
    act(() => setOsReduced(true));
    expect(screen.getByLabelText("motion").textContent).toBe("reduced");
  });

  test.each([
    ["system", "reduced"],
    ["on", "full"],
    ["off", "reduced"],
  ])("hydrates a saved %s preference under reduced OS motion", async (mode, expected) => {
    localStorage.setItem(MOTION_STORAGE_KEY, mode);
    setOsReduced(true);
    const content = <MotionProvider><MotionControls /></MotionProvider>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(content);
    document.body.append(container);
    expect(screen.getByLabelText("motion").textContent).toBe("full");
    expect(screen.getByTestId("scroll-decoration")).toBeTruthy();
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, content, { onRecoverableError: (error) => errors.push(error) });
      });
      await waitFor(() => expect(screen.getByLabelText("mode").textContent).toBe(mode));
      expect(screen.getByLabelText("motion").textContent).toBe(expected);
      expect(errors).toEqual([]);
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });
});
