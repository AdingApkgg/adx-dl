import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { m } from "@/paraglide/messages.js";
import { AppProviders } from "@/client/components/app-providers";
import { SettingsSheet } from "@/client/components/settings-sheet";

function renderSettings() {
  render(
    <AppProviders>
      <SettingsSheet />
    </AppProviders>
  );
  return userEvent.setup();
}

const html = document.documentElement;

describe("页头的设置面板", () => {
  test("设置按钮打开侧边面板：明暗模式、强调色、动画三组，按钮都有中文名字", async () => {
    const user = renderSettings();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: m.appearance_open() }));

    const dialog = screen.getByRole("dialog", { name: m.appearance_title() });
    for (const [group, option] of [
      [m.appearance_theme(), m.appearance_theme_dark()],
      [m.appearance_accent(), m.appearance_accent_violet()],
      [m.appearance_motion(), m.appearance_motion_off()],
    ]) {
      const buttons = within(within(dialog).getByRole("group", { name: group })).getAllByRole("button");
      expect(buttons.some((button) => button.textContent?.startsWith(option)), group).toBe(true);
    }
    expect(within(dialog).getByRole("button", { name: m.appearance_close() })).toBeTruthy();
  });

  test("选深色、紫色、减少动画：<html> 跟着变，设置存进 localStorage（键名和 web 一样）", async () => {
    const user = renderSettings();
    await user.click(screen.getByRole("button", { name: m.appearance_open() }));

    await user.click(screen.getByRole("button", { name: m.appearance_theme_dark() }));
    await user.click(screen.getByRole("button", { name: m.appearance_accent_violet() }));
    await user.click(screen.getByRole("button", { name: new RegExp(`^${m.appearance_motion_off()}`) }));

    expect(html.classList.contains("dark")).toBe(true);
    expect(html.dataset.accent).toBe("violet");
    expect(html.dataset.motion).toBe("off");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("astrodx-accent")).toBe("violet");
    expect(localStorage.getItem("adx-reduce-motion")).toBe("off");
  });

  test("Esc 关上面板，焦点回到设置按钮", async () => {
    const user = renderSettings();
    const trigger = screen.getByRole("button", { name: m.appearance_open() });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
