import { toast } from "@astrodx/ui/components/sonner";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { m } from "@/paraglide/messages.js";
import { AppProviders } from "@/client/components/app-providers";

// Sonner 只在有提示的时候才渲染列表（深浅色写在它上面）。
const toasterTheme = () => document.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme");

describe("全局提示（toast）", () => {
  test("根组件挂的 Toaster 显示成功提示；通知区域有中文名字", async () => {
    render(<AppProviders>{null}</AppProviders>);
    act(() => {
      toast.success(m.profile_saved());
    });

    expect(await screen.findByText(m.profile_saved())).toBeTruthy();
    // Sonner 在名字后面接上快捷键（Alt+T 跳到通知）。
    expect(screen.getByRole("region").getAttribute("aria-label")).toBe(`${m.toast_region()} alt+T`);
  });

  test("跟着设置里的深浅色：存的是深色就用深色", async () => {
    localStorage.setItem("theme", "dark");
    render(<AppProviders>{null}</AppProviders>);
    act(() => {
      toast.success(m.profile_saved());
    });
    await screen.findByText(m.profile_saved());

    expect(toasterTheme()).toBe("dark");
  });
});
