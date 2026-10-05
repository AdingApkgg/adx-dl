import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MotionProvider } from "../motion";
import { ThemeProvider } from "../theme/theme-provider";
import { AccentPicker, choiceClass, MotionPicker, ThemePicker } from "./appearance-pickers";

const themeLabels = { system: "T-system", light: "T-light", dark: "T-dark" };
const accentLabels = { blue: "A-blue", violet: "A-violet", teal: "A-teal", orange: "A-orange", rose: "A-rose" };
const motionLabels = {
  modes: { system: "M-system", on: "M-on", off: "M-off" },
  hints: { system: "H-system", on: "H-on", off: "H-off" },
};

function text(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// How React writes a value into an HTML attribute.
function attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function expectInOrder(html: string, labels: string[]) {
  const positions = labels.map((label) => html.indexOf(label));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

describe("ThemePicker", () => {
  test("renders the three modes in order; on the server the stored choice is unknown, so system is pressed", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ThemePicker labels={themeLabels} />
      </ThemeProvider>
    );
    expectInOrder(html, ["T-system", "T-light", "T-dark"]);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain(`aria-pressed="true" class="${attribute(choiceClass(true))}"><svg`);
    expect(html).toContain("lucide-monitor");
    expect(html).toContain("lucide-sun-medium");
    expect(html).toContain("lucide-moon-star");
    // Every visible word comes from the labels prop.
    expect(text(html)).toBe("T-systemT-lightT-dark");
  });
});

describe("AccentPicker", () => {
  test("renders the five presets with their swatches; blue is pressed by default", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <AccentPicker labels={accentLabels} />
      </ThemeProvider>
    );
    expectInOrder(html, ["A-blue", "A-violet", "A-teal", "A-orange", "A-rose"]);
    for (const swatch of ["bg-blue-500", "bg-violet-500", "bg-teal-500", "bg-orange-500", "bg-rose-500"]) {
      expect(html).toContain(swatch);
    }
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.indexOf('aria-pressed="true"')).toBeLessThan(html.indexOf("A-blue"));
    expect(text(html)).toBe("A-blueA-violetA-tealA-orangeA-rose");
  });
});

describe("MotionPicker", () => {
  test("renders each mode with its hint; follows the system by default", () => {
    const html = renderToStaticMarkup(
      <MotionProvider>
        <MotionPicker labels={motionLabels} />
      </MotionProvider>
    );
    expectInOrder(html, ["M-system", "H-system", "M-on", "H-on", "M-off", "H-off"]);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.indexOf('aria-pressed="true"')).toBeLessThan(html.indexOf("M-system"));
    // The "reduce motion" option shows a dimmed sparkle.
    expect(html).toContain("opacity-50");
    expect(text(html)).toBe("M-systemH-systemM-onH-onM-offH-off");
  });
});

describe("without providers", () => {
  test("the pickers still render, showing the defaults", () => {
    const html = renderToStaticMarkup(
      <>
        <ThemePicker labels={themeLabels} />
        <AccentPicker labels={accentLabels} />
        <MotionPicker labels={motionLabels} />
      </>
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
  });
});

describe("in the browser", () => {
  function renderPickers() {
    render(
      <ThemeProvider>
        <MotionProvider>
          <ThemePicker labels={themeLabels} />
          <AccentPicker labels={accentLabels} />
          <MotionPicker labels={motionLabels} />
        </MotionProvider>
      </ThemeProvider>
    );
    return userEvent.setup();
  }

  // The motion buttons' accessible names include their hints.
  const button = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
  const pressed = (name: string) => button(name).getAttribute("aria-pressed");
  const html = document.documentElement;

  test("choosing dark presses it, darkens the page and saves the choice", async () => {
    const user = renderPickers();
    await user.click(button("T-dark"));
    expect(pressed("T-dark")).toBe("true");
    expect(pressed("T-system")).toBe("false");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  test("choosing an accent presses it, sets data-accent and saves it", async () => {
    const user = renderPickers();
    await user.click(button("A-violet"));
    expect(pressed("A-violet")).toBe("true");
    expect(pressed("A-blue")).toBe("false");
    expect(html.dataset.accent).toBe("violet");
    expect(localStorage.getItem("astrodx-accent")).toBe("violet");
  });

  test("reducing motion marks <html>; following the system again clears the mark", async () => {
    const user = renderPickers();
    await user.click(button("M-off"));
    expect(pressed("M-off")).toBe("true");
    expect(html.dataset.motion).toBe("off");
    expect(html.hasAttribute("data-reduced-motion")).toBe(true);
    expect(localStorage.getItem("adx-reduce-motion")).toBe("off");

    await user.click(button("M-system"));
    expect(pressed("M-system")).toBe("true");
    expect(html.dataset.motion).toBe("system");
    expect(html.hasAttribute("data-reduced-motion")).toBe(false);
  });

  test("works from the keyboard: Space and Enter choose the focused option", async () => {
    const user = renderPickers();
    await user.tab();
    expect(document.activeElement).toBe(button("T-system"));
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(button("T-dark"));
    await user.keyboard(" ");
    expect(pressed("T-dark")).toBe("true");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(button("T-light"));
    await user.keyboard("{Enter}");
    expect(pressed("T-light")).toBe("true");
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  test("after mounting, the saved choices are pressed", async () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("astrodx-accent", "teal");
    localStorage.setItem("adx-reduce-motion", "on");
    renderPickers();
    expect(pressed("T-dark")).toBe("true");
    expect(pressed("A-teal")).toBe("true");
    expect(pressed("M-on")).toBe("true");
  });
});
