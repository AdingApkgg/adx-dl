import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { LoginEvent } from "@/client/components/login-event";

const page = window as unknown as { umami?: { track: (event: string, data?: unknown) => void } };

afterEach(() => {
  delete page.umami;
  document.querySelector('script[src="/_s/script.js"]')?.remove();
});

describe("登录统计：落地页上报 # 后面带来的登录方式", () => {
  test("上报 login 和登录方式，再从地址里去掉标记，路径和查询串不变", () => {
    const track = vi.fn();
    page.umami = { track };
    window.history.replaceState({ key: "k1" }, "", "/onboarding?next=%2F#login=google");

    render(<LoginEvent />);

    expect(track.mock.calls).toEqual([["login", { method: "google" }]]);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/onboarding?next=%2F");
    // React Router 记在 history.state 里的东西原样留着。
    expect(window.history.state).toEqual({ key: "k1" });
  });

  test("认不出的标记：不上报，地址不动", () => {
    const track = vi.fn();
    page.umami = { track };
    window.history.replaceState(null, "", "/#login=email");

    render(<LoginEvent />);

    expect(track).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#login=email");
  });

  test("没开统计（没有 tracker）：照样去掉标记，不报错", () => {
    window.history.replaceState(null, "", "/u/abc2345678#login=qq");

    render(<LoginEvent />);

    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/u/abc2345678");
  });

  test("统计脚本晚于 React 加载：清除标记后仍上报一次通行密钥登录", () => {
    document.head.insertAdjacentHTML("beforeend", '<script defer src="/_s/script.js" data-website-id="test-site"></script>');
    const script = document.querySelector<HTMLScriptElement>('script[src="/_s/script.js"]');
    if (!script) throw new Error("analytics script fixture missing");
    window.history.replaceState({ key: "late" }, "", "/settings/account?tab=security#login=passkey");

    render(<LoginEvent />);

    expect(window.location.hash).toBe("");
    expect(window.history.state).toEqual({ key: "late" });
    const track = vi.fn();
    page.umami = { track };
    fireEvent.load(script);
    fireEvent.load(script);

    expect(track.mock.calls).toEqual([["login", { method: "passkey" }]]);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/settings/account?tab=security");
  });
});
