import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { ConfirmationDialog } from "./confirmation-dialog";

function Harness({ pending = false, confirm = () => {}, close = false }: { pending?: boolean; confirm?: () => void; close?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Open confirmation</button><ConfirmationDialog open={open} onOpenChange={setOpen} title="Delete version" description="This removes the selected private version." confirmLabel="Confirm deletion" cancelLabel="Keep version" pending={pending} onConfirm={() => { confirm(); if (close) setOpen(false); }} /></>;
}
test("confirmation starts on cancel, traps focus, cancels with Escape and returns focus to its caller", async () => {
  const user = userEvent.setup(), confirm = vi.fn(); render(<Harness confirm={confirm} />);
  const trigger = screen.getByRole("button", { name: "Open confirmation" }); await user.click(trigger);
  const dialog = screen.getByRole("alertdialog", { name: "Delete version" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep version" })));
  await user.tab(); await user.tab(); await user.tab(); expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger)); expect(confirm).not.toHaveBeenCalled();
});
test("a confirmation stays open until its caller confirms success; pending blocks repeats, cancel and Escape", async () => {
  const user = userEvent.setup(), confirm = vi.fn(), view = render(<Harness confirm={confirm} />);
  await user.click(screen.getByRole("button", { name: "Open confirmation" }));
  await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
  expect(confirm).toHaveBeenCalledTimes(1); expect(screen.getByRole("alertdialog")).toBeTruthy();
  view.rerender(<Harness pending confirm={confirm} />);
  const action = screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement;
  expect(action.disabled).toBe(true); expect((screen.getByRole("button", { name: "Keep version" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(action); await user.keyboard("{Escape}"); expect(confirm).toHaveBeenCalledTimes(1); expect(screen.getByRole("alertdialog")).toBeTruthy();
  view.rerender(<Harness confirm={confirm} />); await user.click(screen.getByRole("button", { name: "Keep version" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull()); expect(confirm).toHaveBeenCalledTimes(1);
});
test("the caller can close only after its operation succeeds", async () => {
  const user = userEvent.setup(), confirm = vi.fn(); render(<Harness confirm={confirm} close />);
  await user.click(screen.getByRole("button", { name: "Open confirmation" })); await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
  expect(confirm).toHaveBeenCalledTimes(1); await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

test("an unavailable action can stay disabled without preventing cancellation", async () => {
  const user = userEvent.setup(), onOpenChange = vi.fn(), confirm = vi.fn();
  render(<ConfirmationDialog open onOpenChange={onOpenChange} title="Awaiting reconciliation" description="Read the latest state first." confirmLabel="Apply" cancelLabel="Cancel" confirmDisabled onConfirm={confirm} />);
  expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Cancel" })); expect(onOpenChange).toHaveBeenCalledWith(false); expect(confirm).not.toHaveBeenCalled();
});
