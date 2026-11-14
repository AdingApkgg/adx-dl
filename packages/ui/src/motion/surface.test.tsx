import { act, fireEvent, render, screen } from "@testing-library/react";
import { AnimatePresence } from "framer-motion";
import * as React from "react";
import { expect, test } from "vitest";

import { MotionProvider } from "./provider";
import { MotionSurface } from "./surface";

const samples: number[] = [];

function Scene({ reduced }: { reduced: boolean }) {
  const [open, setOpen] = React.useState(false);
  return <MotionProvider forceReducedMotion={reduced}><button type="button" onClick={() => setOpen((v) => !v)}>Toggle</button><AnimatePresence><MotionSurface key="always" pattern="popup" initial={false}>Stable</MotionSurface>{open ? <MotionSurface key="popup" pattern="popup" onUpdate={(values) => { samples.push(Number(values.opacity)); }} transition={{ duration: 1, ease: "linear" }}>Popup</MotionSurface> : null}</AnimatePresence></MotionProvider>;
}

test("reducing during an entrance stops it at the final state without remounting", async () => {
  const { rerender } = render(<Scene reduced={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  const popup = screen.getByText("Popup");
  expect(Number(popup.style.opacity)).toBeLessThan(1);
  rerender(<Scene reduced />);
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  expect(screen.getByText("Popup")).toBe(popup);
  expect(popup.style.opacity).toBe("1");
  expect(popup.style.transform).toBe("none");
});

test("reducing during an exit releases presence immediately", async () => {
  const { rerender } = render(<Scene reduced={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
  expect(screen.queryByText("Popup")).not.toBeNull();
  rerender(<Scene reduced />);
  expect(screen.queryByText("Popup")).toBeNull();
});
