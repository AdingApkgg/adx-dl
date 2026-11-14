import { act, render, screen, waitFor } from "@testing-library/react";
import { useMotionValueEvent } from "framer-motion";
import * as React from "react";
import { expect, test } from "vitest";

import { useMotionProgress } from "./progress";
import { MotionProvider } from "./provider";

function Readout({ value, samples }: { value: number; samples: number[] }) {
  const progress = useMotionProgress(value);
  const [display, setDisplay] = React.useState(progress.get());
  useMotionValueEvent(progress, "change", (next) => { samples.push(next); setDisplay(next); });
  return <output aria-label="progress">{display}</output>;
}

test("progress never overshoots and switching reduction cancels the old destination", async () => {
  const samples: number[] = [];
  const content = (value: number, reduced: boolean) => <MotionProvider forceReducedMotion={reduced}><Readout value={value} samples={samples} /></MotionProvider>;
  const { rerender } = render(content(0.2, false));
  rerender(content(0.8, false));
  await waitFor(() => expect(Number(screen.getByLabelText("progress").textContent)).toBeGreaterThan(0.2));
  expect(samples.every((n) => n >= 0.2 && n <= 0.8)).toBe(true);
  rerender(content(0.4, true));
  expect(screen.getByLabelText("progress").textContent).toBe("0.4");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
  expect(screen.getByLabelText("progress").textContent).toBe("0.4");
});

test("progress clamps invalid inputs before rendering and follows a new task reset", () => {
  const samples: number[] = [];
  const { rerender } = render(<MotionProvider forceReducedMotion><Readout value={1.5} samples={samples} /></MotionProvider>);
  expect(screen.getByLabelText("progress").textContent).toBe("1");
  rerender(<MotionProvider forceReducedMotion><Readout value={-0.5} samples={samples} /></MotionProvider>);
  expect(screen.getByLabelText("progress").textContent).toBe("0");
});
