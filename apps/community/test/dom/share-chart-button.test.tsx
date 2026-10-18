import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ShareChartButton } from "@/client/components/share-chart-button";

function setup({ share, writeText, path = "/charts/public" }: { share?: (data: ShareData) => Promise<void>; writeText?: (text: string) => Promise<void>; path?: string } = {}) {
  vi.stubGlobal("navigator", { share, clipboard: writeText ? { writeText } : undefined });
  render(<MemoryRouter initialEntries={[path]}><ShareChartButton title="Published title" publicId="42" /></MemoryRouter>);
}
afterEach(() => vi.unstubAllGlobals());
test("share copies the localized public page only, without query or fragment", async () => {
  const writeText = vi.fn(async () => {});
  setup({ writeText, path: "/en/charts/public?token=private#chart-preview" });
  fireEvent.click(screen.getByRole("button", { name: "分享谱面" }));
  await screen.findByRole("status");
  expect(writeText).toHaveBeenCalledWith("https://community.test/en/charts/42");
  expect(screen.getByRole("status").textContent).toBe("公开链接已复制。");
});
test("native sharing is preferred and never claims the link was copied", async () => {
  const share = vi.fn(async () => {}), writeText = vi.fn(async () => {});
  setup({ share, writeText });
  fireEvent.click(screen.getByRole("button", { name: "分享谱面" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "分享谱面" }) as HTMLButtonElement).disabled).toBe(false));
  expect(share).toHaveBeenCalledWith({ title: "Published title", url: "https://community.test/charts/42" });
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
test("cancelling native sharing does not copy or open a fallback", async () => {
  const writeText = vi.fn(async () => {});
  setup({ share: async () => { throw new DOMException("Cancelled", "AbortError"); }, writeText });
  fireEvent.click(screen.getByRole("button", { name: "分享谱面" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "分享谱面" }) as HTMLButtonElement).disabled).toBe(false));
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
test("native permission denial falls back to copying the public URL", async () => {
  const writeText = vi.fn(async () => {});
  setup({ share: async () => { throw new DOMException("Denied", "NotAllowedError"); }, writeText });
  fireEvent.click(screen.getByRole("button", { name: "分享谱面" }));
  await screen.findByText("公开链接已复制。");
  expect(writeText).toHaveBeenCalledTimes(1);
});
test.each(["unavailable", "denied"])("clipboard %s offers focused manual copy without false success and restores focus on close", async state => {
  setup({ writeText: state === "denied" ? async () => { throw new DOMException("Denied", "NotAllowedError"); } : undefined });
  const button = screen.getByRole("button", { name: "分享谱面" });
  fireEvent.click(button);
  const input = await screen.findByRole("textbox", { name: "公开谱面链接" }) as HTMLInputElement;
  expect(input.value).toBe("https://community.test/charts/42");
  expect(input.readOnly).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.selectionEnd).toBe(input.value.length);
  expect(screen.queryByText("公开链接已复制。")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭链接" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(button);
});
test("a pending share accepts only one click until it settles", async () => {
  let finish!: () => void;
  const share = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  setup({ share });
  const button = screen.getByRole("button", { name: "分享谱面" });
  fireEvent.click(button); fireEvent.click(button);
  expect(share).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  finish();
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
});
