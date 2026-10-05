import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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
