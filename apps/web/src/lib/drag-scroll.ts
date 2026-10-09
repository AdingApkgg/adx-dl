/** Add left-mouse dragging to a native horizontal scroller; touch stays native. */
export function attachMouseDragScroll(element: HTMLElement): () => void {
  const eventRoot = element.ownerDocument;
  const originalCursor = element.style.cursor;
  const originalUserSelect = element.style.userSelect;
  let gesture: { id: number; x: number; scrollLeft: number; dragged: boolean } | null = null;
  let suppressClick = false;

  const updateCursor = () => {
    element.style.cursor = element.scrollWidth > element.clientWidth ? "grab" : originalCursor;
  };
  const finish = () => {
    if (!gesture) return;
    const { id, dragged } = gesture;
    gesture = null;
    eventRoot.removeEventListener("pointermove", move);
    eventRoot.removeEventListener("pointerup", end);
    eventRoot.removeEventListener("pointercancel", end);
    suppressClick = dragged;
    element.style.userSelect = originalUserSelect;
    updateCursor();
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
  };
  const down = (event: PointerEvent) => {
    suppressClick = false;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (element.scrollWidth <= element.clientWidth) return;
    finish();
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, scrollLeft: element.scrollLeft, dragged: false };
    element.style.userSelect = "none";
    // Mouse input has no implicit capture. Track outside the row even before
    // the drag threshold, without retargeting an ordinary chip click.
    eventRoot.addEventListener("pointermove", move);
    eventRoot.addEventListener("pointerup", end);
    eventRoot.addEventListener("pointercancel", end);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    // Also recover if the button was released before capture began.
    if ((event.buttons & 1) === 0) return finish();
    const delta = event.clientX - gesture.x;
    if (!gesture.dragged) {
      if (Math.abs(delta) <= 6) return;
      gesture.dragged = true;
      element.setPointerCapture(event.pointerId);
      element.style.cursor = "grabbing";
    }
    element.scrollLeft = gesture.scrollLeft - delta;
    event.preventDefault();
  };
  const end = (event: PointerEvent) => {
    if (event.pointerId === gesture?.id) finish();
  };
  const click = (event: MouseEvent) => {
    // Keyboard activation must still work even if capture was cancelled.
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const dragStart = (event: DragEvent) => {
    // Version logos are images: native image dragging would steal the gesture.
    if (gesture) event.preventDefault();
  };
  const enter = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && !gesture) updateCursor();
  };

  element.addEventListener("pointerdown", down);
  element.addEventListener("lostpointercapture", end);
  element.addEventListener("pointerenter", enter);
  element.addEventListener("click", click, true);
  element.addEventListener("dragstart", dragStart);
  return () => {
    finish();
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("lostpointercapture", end);
    element.removeEventListener("pointerenter", enter);
    element.removeEventListener("click", click, true);
    element.removeEventListener("dragstart", dragStart);
    element.style.cursor = originalCursor;
    element.style.userSelect = originalUserSelect;
  };
}
