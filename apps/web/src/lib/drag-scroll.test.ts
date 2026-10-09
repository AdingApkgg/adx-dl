import { describe, expect, test } from "bun:test";

import { attachMouseDragScroll } from "./drag-scroll";

// EventTarget supplies actual cancelable event dispatch; layout and pointer
// capture are the browser boundaries this small viewport stand-in supplies.
class Viewport extends EventTarget {
  ownerDocument = new EventTarget();
  scrollLeft = 100;
  scrollWidth = 600;
  clientWidth = 200;
  style = { cursor: "", userSelect: "" };
  captured: number | null = null;
  setPointerCapture(id: number) { this.captured = id; }
  hasPointerCapture(id: number) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}

function pointer(
  viewport: Viewport,
  type: string,
  values: Record<string, unknown> = {},
  target: EventTarget = ["pointermove", "pointerup", "pointercancel"].includes(type)
    ? viewport.ownerDocument
    : viewport
) {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 100,
    ...values,
  });
  target.dispatchEvent(event);
  return event;
}

function click(viewport: Viewport, detail = 1) {
  const event = Object.assign(new Event("click", { cancelable: true }), { detail });
  viewport.dispatchEvent(event);
  return event;
}

function setup() {
  const viewport = new Viewport();
  const dispose = attachMouseDragScroll(viewport as unknown as HTMLElement);
  return { viewport, dispose };
}

describe("mouse drag scrolling", () => {
  test("a first movement outside the row still starts scrolling", () => {
    const { viewport } = setup();
    pointer(viewport, "pointerdown", { clientX: 82 });
    pointer(viewport, "pointermove", { clientX: 50 }, viewport.ownerDocument);
    expect(viewport.scrollLeft).toBe(132);
    pointer(viewport, "pointerup", { buttons: 0 }, viewport.ownerDocument);
    expect(viewport.captured).toBeNull();
    expect(viewport.style.userSelect).toBe("");
  });

  test("release outside before the threshold restores text selection", () => {
    const { viewport } = setup();
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointerup", { buttons: 0 }, viewport.ownerDocument);
    expect(viewport.style.userSelect).toBe("");
    expect(click(viewport).defaultPrevented).toBe(false);
  });

  test("left drag follows the pointer, captures it and suppresses the release click", () => {
    const { viewport } = setup();
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointermove", { clientX: 70 });
    expect(viewport.scrollLeft).toBe(130);
    expect(viewport.captured).toBe(1);
    expect(viewport.style.cursor).toBe("grabbing");
    pointer(viewport, "pointermove", { clientX: 160 });
    expect(viewport.scrollLeft).toBe(40);
    pointer(viewport, "pointerup", { buttons: 0 });
    expect(viewport.captured).toBeNull();
    expect(viewport.style.cursor).not.toBe("grabbing");
    expect(click(viewport).defaultPrevented).toBe(true);
    expect(click(viewport).defaultPrevented).toBe(false);
  });

  test("a slightly shaky click still selects without scrolling", () => {
    const { viewport } = setup();
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointermove", { clientX: 104 });
    pointer(viewport, "pointerup", { buttons: 0 });
    expect(viewport.scrollLeft).toBe(100);
    expect(viewport.captured).toBeNull();
    expect(click(viewport).defaultPrevented).toBe(false);
  });

  test("touch, pen and right-button input retain native behavior", () => {
    for (const values of [{ pointerType: "touch" }, { pointerType: "pen" }, { button: 2, buttons: 2 }]) {
      const { viewport } = setup();
      expect(pointer(viewport, "pointerdown", values).defaultPrevented).toBe(false);
      pointer(viewport, "pointermove", { ...values, clientX: 70 });
      expect(viewport.scrollLeft).toBe(100);
      expect(viewport.captured).toBeNull();
    }
  });

  test("short rows do not start dragging", () => {
    const { viewport } = setup();
    viewport.scrollWidth = viewport.clientWidth;
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointermove", { clientX: 70 });
    expect(viewport.scrollLeft).toBe(100);
    expect(click(viewport).defaultPrevented).toBe(false);
  });

  test("cancellation and lost capture end the gesture, keyboard clicks remain usable", () => {
    for (const end of ["pointercancel", "lostpointercapture"]) {
      const { viewport } = setup();
      pointer(viewport, "pointerdown");
      pointer(viewport, "pointermove", { clientX: 70 });
      pointer(viewport, end);
      pointer(viewport, "pointermove", { clientX: 50 });
      expect(viewport.scrollLeft).toBe(130);
      expect(viewport.style.cursor).not.toBe("grabbing");
      expect(click(viewport, 0).defaultPrevented).toBe(false);
    }
  });

  test("a new click after a drag is not suppressed, and cleanup removes listeners", () => {
    const { viewport, dispose } = setup();
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointermove", { clientX: 70 });
    pointer(viewport, "pointerup", { buttons: 0 });
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointerup", { buttons: 0 });
    expect(click(viewport).defaultPrevented).toBe(false);
    dispose();
    pointer(viewport, "pointerdown");
    pointer(viewport, "pointermove", { clientX: 30 });
    expect(viewport.scrollLeft).toBe(130);
  });
});
