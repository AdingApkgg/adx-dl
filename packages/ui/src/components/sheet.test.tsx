import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

// The Radix-component template: a real dialog in happy-dom, opened and closed
// the way people do it, checking roles, names and where focus ends up.
// No CSS is loaded here, so Radix's Presence sees no exit animation and the
// dialog unmounts at once; where styles are loaded, await
// waitForElementToBeRemoved instead of asserting right away. Radix hands focus
// back in a zero-delay timeout: user-event waits for it after each action,
// fireEvent does not, so use waitFor with fireEvent.
function renderSheet() {
  render(
    <Sheet>
      <SheetTrigger>S-open</SheetTrigger>
      <SheetContent closeLabel="S-close">
        <SheetTitle>S-title</SheetTitle>
        <SheetDescription>S-description</SheetDescription>
      </SheetContent>
    </Sheet>
  );
  return userEvent.setup();
}

describe("Sheet in the browser", () => {
  test("the trigger opens a named dialog whose close button uses closeLabel", async () => {
    const user = renderSheet();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "S-open" }));
    const dialog = screen.getByRole("dialog", { name: "S-title" });
    const close = screen.getByRole("button", { name: "S-close" });
    expect(dialog.contains(close)).toBe(true);
    expect(close.getAttribute("title")).toBe("S-close");
  });

  test("Escape closes it and gives focus back to the trigger", async () => {
    const user = renderSheet();
    const trigger = screen.getByRole("button", { name: "S-open" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Opening moves focus into the dialog; closing must hand it back.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("the close button closes it", async () => {
    const user = renderSheet();
    await user.click(screen.getByRole("button", { name: "S-open" }));
    await user.click(screen.getByRole("button", { name: "S-close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
