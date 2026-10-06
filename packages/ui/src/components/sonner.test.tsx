import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, test } from "vitest";

import { ThemeProvider } from "../theme/theme-provider";
import { ThemePicker } from "./appearance-pickers";
import { Toaster } from "./sonner";

const themeLabels = { system: "T-system", light: "T-light", dark: "T-dark" };

// Sonner renders its list (and the theme on it) only while a toast is showing.
const toasterTheme = () => document.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme");

describe("Toaster in the browser", () => {
  test("shows a toast in the mode ThemeProvider resolved", async () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>
    );
    act(() => {
      toast.success("S-saved");
    });
    expect(await screen.findByText("S-saved")).toBeTruthy();
    expect(toasterTheme()).toBe("dark");
  });

  test("follows a light or dark change made while it is showing", async () => {
    render(
      <ThemeProvider>
        <ThemePicker labels={themeLabels} />
        <Toaster />
      </ThemeProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "T-light" }));
    act(() => {
      toast("S-note");
    });
    expect(await screen.findByText("S-note")).toBeTruthy();
    expect(toasterTheme()).toBe("light");
    await user.click(screen.getByRole("button", { name: "T-dark" }));
    expect(toasterTheme()).toBe("dark");
  });
});
