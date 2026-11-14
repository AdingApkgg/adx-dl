import { act, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { DrawnCheck, MotionProvider, Reveal, RevealGroup, RevealItem, RollingNumber } from "./index";

describe("shared motion content policy", () => {
  test("keeps default Reveal content readable in server HTML", () => {
    const html = renderToString(<Reveal>Readable before hydration</Reveal>);
    expect(html).toContain("Readable before hydration");
    expect(html).not.toContain("opacity:0");
    expect(html).not.toContain("translateY");
  });

  test("group items also remain readable without JavaScript", () => {
    const html = renderToString(<RevealGroup><RevealItem>First</RevealItem><RevealItem>Last</RevealItem></RevealGroup>);
    expect(html).not.toContain("opacity:0");
  });

  test("shows completed success strokes when motion is reduced", () => {
    render(<MotionProvider forceReducedMotion><DrawnCheck /></MotionProvider>);
    const path = document.querySelector("svg path");
    expect(path?.getAttribute("stroke-dasharray")).not.toBe("0px 1px");
    expect(path?.getAttribute("opacity") ?? path?.getAttribute("style")).not.toContain("opacity: 0");
    expect(path?.getAttribute("stroke-dasharray")).toBe("1 1");
  });

  test("historical success marks remain complete when explicitly static", async () => {
    render(<DrawnCheck animateOnMount={false} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(document.querySelector('[data-slot="drawn-check"] path')?.getAttribute("stroke-dasharray")).toBe("1 1");
  });

  test("updates a standalone numeric readout without requiring a provider", async () => {
    const { rerender } = render(<RollingNumber value={10} />);
    rerender(<RollingNumber value={25} />);
    await waitFor(() => expect(document.querySelector('[aria-hidden="true"]')?.textContent).toBe("25"));
  });

  test("reducing motion makes offscreen reveals immediately visible", () => {
    render(<MotionProvider forceReducedMotion><Reveal ssrVisible={false}>Visible now</Reveal></MotionProvider>);
    expect(screen.getByText("Visible now").style.opacity).not.toBe("0");
  });
});
