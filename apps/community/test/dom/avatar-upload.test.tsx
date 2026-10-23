import { QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import SettingsProfile from "@/client/routes/settings-profile";
import { Avatar } from "@/client/components/avatar";
import { createApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";

const ProfilePage = SettingsProfile as unknown as ComponentType<{
  loaderData: { userId: string; dehydratedState: ReturnType<typeof dehydrate> };
}>;
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({
  getBrowserApi: () => api,
  getRenderApi: () => api,
}));
const hash = "a".repeat(64);
class HashWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: null = null;
  postMessage() {
    queueMicrotask(() => this.onmessage?.({ data: { hash } }));
  }
  terminate() {}
}
const me = {
  id: "abc2345678",
  name: "阿丁",
  image: "/media/old.jpg",
  status: "active",
  createdAt: "",
  deletionPurgeAt: null,
};
const profile = {
  name: "阿丁",
  bio: "",
  onboardedAt: null,
  image: "/media/old.jpg",
  avatarRevision: 4,
};
const words = {
  zh: {
    choose: "选择头像",
    save: "保存头像",
    remove: "使用默认头像",
    preview: "新头像预览",
    conflict: "头像已在其他地方更改。请检查当前头像后再保存。",
  },
  en: {
    choose: "Choose avatar",
    save: "Save avatar",
    remove: "Use default avatar",
    preview: "New avatar preview",
    conflict: "Your avatar changed elsewhere. Review the current avatar before saving again.",
  },
  ja: {
    choose: "アバターを選択",
    save: "アバターを保存",
    remove: "デフォルトに戻す",
    preview: "新しいアバターのプレビュー",
    conflict: "別の場所でアバターが変更されました。現在のアバターを確認してから保存してください。",
  },
};
afterEach(() => vi.unstubAllGlobals());
function setup(
  locale: keyof typeof words = "zh",
  options: {
    conflict?: boolean;
    failure?: boolean;
    delay?: Promise<void>;
  } = {},
) {
  const requests: {
    path: string;
    method: string;
    body: unknown;
    headers: Headers;
  }[] = [];
  let uploadCount = 0;
  let current: Omit<typeof profile, "image"> & { image: string | null } = {
    ...profile,
  };
  vi.stubGlobal("Worker", HashWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      requests.push({ path, method, body, headers });
      if (path === "/api/v1/me/profile") return Response.json(current);
      if (path === "/api/v1/me") return Response.json({ ...me, image: current.image });
      if (path === "/api/v1/me/avatar") {
        if (options.conflict) {
          current = {
            ...current,
            image: "/media/current.jpg",
            avatarRevision: 5,
          };
          return Response.json({ error: { code: "AVATAR_CHANGED", message: "technical" } }, { status: 409 });
        }
        current = {
          ...current,
          image: method === "DELETE" ? null : "/media/new.jpg",
          avatarRevision: 5,
        };
        return Response.json({ image: current.image, avatarRevision: 5 });
      }
      if (path === "/api/v1/uploads")
        return Response.json({
          id: ++uploadCount === 1 ? "upload" : "upload2",
          state: "receiving",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          partSize: 4194304,
          partCount: 1,
          receivedParts: [],
        });
      if (path.endsWith("/parts/0")) {
        await options.delay;
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/complete"))
        return Response.json({
          id: path.includes("upload2") ? "upload2" : "upload",
          state: options.failure ? "rejected" : "ready",
          errorCode: "IMAGE_INVALID",
          fileId: path.includes("upload2") ? "file2" : "file",
          receivedParts: [],
        });
      if (path.startsWith("/api/v1/uploads/upload"))
        return Response.json({
          id: path.split("/").at(-1),
          state: "receiving",
          partSize: 4194304,
          partCount: 1,
          receivedParts: [{ index: 0, size: 3, sha256: hash }],
        });
      if (path.startsWith("/api/v1/files/file"))
        return Response.json({
          id: path.split("/").at(-1),
          purpose: "avatar",
          name: "avatar.png",
          size: 3,
          state: "ready",
          createdAt: "",
          previewUrl: `${path}/preview`,
        });
      throw new Error(`Unexpected request ${method} ${path}`);
    }),
  );
  const path = locale === "zh" ? "/settings/profile" : `/${locale}/settings/profile`;
  window.history.replaceState(null, "", path);
  const client = makeQueryClient();
  client.setQueryData(["me"], me);
  client.setQueryData(["me", "profile", me.id], profile);
  client.setQueryData(["users", me.id], { image: me.image });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ProfilePage loaderData={{ userId: me.id, dehydratedState: dehydrate(client) }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), requests, client, w: words[locale] };
}
async function select(f: ReturnType<typeof setup>, file = new File(["abc"], "avatar.png", { type: "image/png" })) {
  await f.user.upload(screen.getByLabelText(f.w.choose), file);
}
for (const locale of ["zh", "en", "ja"] as const) {
  test(`${locale}: processed private preview needs explicit Save, independent of invalid nickname`, async () => {
    const f = setup(locale);
    const input = screen.getByRole("textbox", {
      name: locale === "zh" ? "昵称" : locale === "en" ? "Nickname" : "ニックネーム",
    });
    await f.user.clear(input);
    await select(f);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: f.w.preview }).getAttribute("src")).toBe("/api/v1/files/file/preview"),
    );
    expect(document.querySelector('img[src="/media/old.jpg"]')).toBeTruthy();
    expect(f.requests.some((r) => r.path.endsWith("/avatar"))).toBe(false);
    await f.user.click(screen.getByRole("button", { name: f.w.save }));
    await waitFor(() => expect(document.querySelector('img[src="/media/new.jpg"]')).toBeTruthy());
    expect(input.getAttribute("value")).toBe("");
    expect(localStorage.getItem(`astrodx-uploads:${me.id}`)).toBe("[]");
    expect(f.requests.find((r) => r.path.endsWith("/avatar"))?.body).toEqual({
      fileId: "file",
      expectedRevision: 4,
    });
    expect(f.client.getQueryState(["users", me.id])?.isInvalidated).toBe(true);
  });
}
test("local preview appears while transfer is pending and failure preserves published avatar", async () => {
  let release!: () => void;
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = setup("zh", { failure: true, delay });
  await select(f);
  expect(screen.getByRole("img", { name: f.w.preview }).getAttribute("src")).toMatch(/^blob:/);
  await act(async () => release());
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(document.querySelector('img[src="/media/old.jpg"]')).toBeTruthy();
  expect(screen.queryByRole("button", { name: f.w.save })).toBeNull();
});
for (const locale of ["zh", "en", "ja"] as const) {
  test(`${locale}: conflict refreshes current profile with a translated message`, async () => {
    const f = setup(locale, { conflict: true });
    await f.user.click(screen.getByRole("button", { name: f.w.remove }));
    expect(await screen.findByText(f.w.conflict)).toBeTruthy();
    await waitFor(() => expect(document.querySelector('img[src="/media/current.jpg"]')).toBeTruthy());
  });
}
test("decorative image fails to SVG and recovers on URL change", () => {
  const { container, rerender } = render(<Avatar id="u" name="A" image="/old.jpg" />);
  const image = container.querySelector("img")!;
  expect(image.getAttribute("alt")).toBe("");
  expect(image.getAttribute("aria-hidden")).toBe("true");
  fireEvent.error(image);
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  rerender(<Avatar id="u" name="A" image="/new.jpg" />);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/new.jpg");
});

test("remove success restores the decorative default SVG", async () => {
  const f = setup("zh");
  await f.user.click(screen.getByRole("button", { name: f.w.remove }));
  await waitFor(() => expect(document.querySelector('img[src="/media/old.jpg"]')).toBeNull());
  expect(document.querySelector('svg[width="64"][aria-hidden="true"]')).toBeTruthy();
  expect(f.requests.find((r) => r.path.endsWith("/avatar"))?.body).toEqual({
    expectedRevision: 4,
  });
});
test("invalid image leaves current avatar and sends no upload", async () => {
  const f = setup();
  fireEvent.change(screen.getByLabelText(f.w.choose), {
    target: { files: [new File(["x"], "text.txt", { type: "text/plain" })] },
  });
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(document.querySelector('img[src="/media/old.jpg"]')).toBeTruthy();
  expect(f.requests).toEqual([]);
});
test("historical success replay refreshes current avatar, not the replayed DTO", async () => {
  const f = setup();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/avatar")) {
      calls++;
      await originalFetch(input, init);
      if (calls === 1) throw new TypeError("response lost");
      return Response.json({
        image: "/media/historical.jpg",
        avatarRevision: 1,
      });
    }
    return originalFetch(input, init);
  });
  await select(f);
  await screen.findByRole("button", { name: f.w.save });
  await f.user.click(screen.getByRole("button", { name: f.w.save }));
  await waitFor(() => expect(document.querySelector('img[src="/media/new.jpg"]')).toBeTruthy());
  expect(document.querySelector('img[src="/media/historical.jpg"]')).toBeNull();
  const writes = f.requests.filter((r) => r.path.endsWith("/avatar"));
  expect(writes.length).toBe(2);
  expect(writes[0]!.headers.get("idempotency-key")).toBe(writes[1]!.headers.get("idempotency-key"));
  expect(writes[0]!.body).toEqual(writes[1]!.body);
});

test("ready discard deletes the unattached file and only then forgets metadata", async () => {
  const f = setup();
  const previous = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith("/files/file") && init?.method === "DELETE"
      ? Promise.resolve(new Response(null, { status: 204 }))
      : previous(input, init),
  );
  await select(f);
  await screen.findByRole("button", { name: f.w.save });
  expect(JSON.parse(localStorage.getItem(`astrodx-uploads:${me.id}`)!)).toHaveLength(1);
  await f.user.click(screen.getByRole("button", { name: "取消上传" }));
  await waitFor(() => expect(screen.queryByRole("img", { name: f.w.preview })).toBeNull());
  expect(localStorage.getItem(`astrodx-uploads:${me.id}`)).toBe("[]");
});

test("late older avatar save consumes only its metadata and preserves a newer candidate", async () => {
  const f = setup();
  const original = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/avatar")) await gate;
    return original(input, init);
  });
  await select(f);
  await screen.findByRole("button", { name: f.w.save });
  await f.user.click(screen.getByRole("button", { name: f.w.save }));
  const input = screen.getByLabelText(f.w.choose);
  // A new local selection can arrive before the older response; do not let it erase current UI.
  fireEvent.change(input, { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: f.w.save })).toBeTruthy());
  await act(async () => release());
  await waitFor(() => expect(document.querySelector('img[src="/media/new.jpg"]')).toBeTruthy());
  expect(screen.queryByRole("img", { name: f.w.preview })).toBeTruthy();
  expect(
    JSON.parse(localStorage.getItem(`astrodx-uploads:${me.id}`)!).map((r: { uploadId: string }) => r.uploadId),
  ).toEqual(["upload2"]);
});

test("late ready-file discard cannot remove a newer preview", async () => {
  const f = setup();
  const original = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/files/file") && init?.method === "DELETE") {
      await gate;
      return new Response(null, { status: 204 });
    }
    return original(input, init);
  });
  await select(f);
  await screen.findByRole("button", { name: f.w.save });
  await f.user.click(screen.getByRole("button", { name: "取消上传" }));
  fireEvent.change(screen.getByLabelText(f.w.choose), {
    target: { files: [new File(["new"], "new.png", { type: "image/png" })] },
  });
  await waitFor(() =>
    expect(screen.getByRole("img", { name: f.w.preview }).getAttribute("src")).toBe("/api/v1/files/file2/preview"),
  );
  await act(async () => release());
  expect(screen.queryByRole("img", { name: f.w.preview })).toBeTruthy();
});
