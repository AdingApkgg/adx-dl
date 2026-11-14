import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, expect, test, vi } from "vitest";

import { MotionProvider, useMotionActivity, useMotionPreference } from "./provider";

// Viewport behavior is covered by the remote Chromium check. Happy DOM does
// not deliver viewport entries, so fix this environmental input and exercise
// the real preference/visibility subscriptions here.
vi.mock("framer-motion", async (importOriginal) => ({
  ...await importOriginal<typeof import("framer-motion")>(),
  useInView: () => true,
}));

function Decoration() {
  const ref = React.useRef<HTMLDivElement>(null);
  const active = useMotionActivity(ref);
  const { setMode } = useMotionPreference();
  return <div ref={ref}><output aria-label="activity">{active ? "running" : "paused"}</output><button type="button" onClick={() => setMode("on")}>Always animate</button><button type="button" onClick={() => setMode("off")}>Reduce</button></div>;
}

afterEach(() => { vi.restoreAllMocks(); });

test("explicit animation never overrides background or reduced decoration gates", () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<MotionProvider><Decoration /></MotionProvider>);
  expect(screen.getByLabelText("activity").textContent).toBe("running");
  fireEvent.click(screen.getByRole("button", { name: "Always animate" }));
  act(() => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.getByLabelText("activity").textContent).toBe("paused");
  act(() => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.getByLabelText("activity").textContent).toBe("running");
  fireEvent.click(screen.getByRole("button", { name: "Reduce" }));
  expect(screen.getByLabelText("activity").textContent).toBe("paused");
});
