import { QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import {renderToString} from "react-dom/server";
import {ChartPublication} from "@/client/components/chart-publication";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { m } from "@/paraglide/messages.js";
import ChartDetail from "@/client/routes/chart-detail";
import { chartQuery } from "@/client/queries/charts";
import { createApiClient } from "@/shared/api-client";
import type { ChartDto } from "@/shared/charts";
import { makeQueryClient } from "@/shared/query-client";
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getBrowserApi: () => api, getRenderApi: () => api }));
const Page = ChartDetail as unknown as ComponentType<{ params: { id: string }; loaderData: { dehydratedState: ReturnType<typeof dehydrate> } }>;
const summary = { title: "Original", artist: "Artist", maidataMd5Base64: "md5", difficulties: [{ difficulty: 4 as const, level: "12", noteCount: 3, durationMs: 5000, previewSupported: true }], warnings: [], audio: null, hasCover: false };
const initial: ChartDto = { description: "", credits: "", tags: [], publication: null, publicationPending: false, id: "chart", title: "Original", artist: "Artist", revision: 2, currentVersionId: "v2", createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
  versions: [2, 1].map((ordinal) => ({ id: `v${ordinal}`, ordinal, sourceFileId: `f${ordinal}`, releaseNote: "", sourceSize: 3, summary, createdAt: "2026-10-11T00:00:00.000Z" })) };
class HashWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null;
  postMessage() { queueMicrotask(() => this.onmessage?.({ data: { hash: "a".repeat(64) } })); }
  terminate() {}
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(handler: (path: string, method: string, body: Record<string, unknown>) => Promise<Response> | Response, start = initial) {
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("Worker", HashWorker);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : {} };
    if(request.path.endsWith("/fingerprint"))return Response.json({versionId:request.path.split("/").at(-2),source:{sha256:"a".repeat(64),size:3},assets:{maidata:{sha256:"b".repeat(64),size:3,mime:"text/plain"}}});
    requests.push(request); return handler(request.path, request.method, request.body);
  }));
  const client = makeQueryClient(); client.setQueryData(["me"], { id: "alice", status: "active" }); client.setQueryData(chartQuery(api, "chart").queryKey, start);
  const router = createMemoryRouter([{ path: "/me/charts/:id", element: <QueryClientProvider client={client}><Page params={{ id: "chart" }} loaderData={{ dehydratedState: dehydrate(client) }} /></QueryClientProvider> }], { initialEntries: ["/me/charts/chart"] });
  render(<RouterProvider router={router} />);
  return requests;
}
test("metadata conflict uses the edit revision, reads latest state and keeps the user's title", async () => {
  const latest = { ...initial, title: "External change", revision: 3 };
  const requests = setup((_path, method) => method === "PATCH" ? Response.json({ error: { code: "CHART_CHANGED", message: "Changed" } }, { status: 409 }) : Response.json(latest));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "My unsaved title" } });
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("草稿已发生变化"))).toBe(true));
  expect((screen.getByRole("textbox", { name: "标题" }) as HTMLInputElement).value).toBe("My unsaved title");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("External change");
  expect(requests.filter((row) => row.method === "PATCH")).toEqual([{ path: "/api/v1/me/charts/chart", method: "PATCH", body: { expectedRevision: 2, title: "My unsaved title", aliases: [], artist: "Artist", description: "", credits: "", tags: [], releaseNote: { versionId: "v2", text: "" } } }]);
  expect(requests.some((row) => row.method === "GET")).toBe(true);
});
test("a lost successful metadata response reads current state instead of replaying PATCH", async () => {
  let actual = initial;
  const requests = setup((_path, method, body) => {
    if (method === "PATCH") { actual = { ...initial, title: String(body.title), artist: String(body.artist), revision: 3 }; throw new TypeError("Response lost"); }
    return Response.json(actual);
  });
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Saved remotely" } });
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Saved remotely"));
  expect((screen.getByRole("button", { name: "保存作品资料" }) as HTMLButtonElement).disabled).toBe(true);
  expect(requests.filter((row) => row.method === "PATCH")).toHaveLength(1);
  expect(requests.findIndex((row) => row.method === "GET")).toBeGreaterThan(requests.findIndex((row) => row.method === "PATCH"));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Saved remotely");
  expect(screen.queryByRole("alert")).toBeNull();
});
test("rejected replacement leaves the current version untouched and never saves a new version", async () => {
  const requests = setup((path) => {
    if (path === "/api/v1/uploads") return Response.json({ id: "u", state: "receiving", expiresAt: new Date(Date.now() + 60000).toISOString(), partSize: 4194304, partCount: 1, receivedParts: [] });
    if (path.endsWith("/parts/0")) return new Response(null, { status: 204 });
    if (path.endsWith("/complete")) return Response.json({ id: "u", state: "rejected", errorCode: "CHART_PACKAGE_INVALID", receivedParts: [] });
    if (path === "/api/v1/uploads/u") return Response.json({ id: "u", state: "receiving", partSize: 4194304, partCount: 1, receivedParts: [{ index: 0, size: 3, sha256: "a".repeat(64) }] });
    throw new Error(`Unexpected ${path}`);
  });
  fireEvent.change(screen.getByLabelText("选择 ADX / ZIP"), { target: { files: [new File(["bad"], "bad.zip", { type: "application/zip" })] } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("未通过校验"));
  expect(within(within(screen.getByRole("region", { name: "历史版本" })).getByText(/^版本 2/).closest("li")!).getByText("当前版本")).toBeTruthy();
  expect(requests.some((row) => row.path === "/api/v1/me/charts/chart/versions")).toBe(false);
  expect(screen.queryByRole("button", { name: "保存私有草稿" })).toBeNull();
});
test("current version has no delete action and historical deletion requires confirmation with its revision", async () => {
  const requests = setup((_path, method) => method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ ...initial, revision: 3, versions: [initial.versions[0]!] }));
  const current = within(screen.getByRole("region", { name: "历史版本" })).getByText(/^版本 2/).closest("li")!;
  expect(within(current).queryByRole("button", { name: "删除版本" })).toBeNull();
  fireEvent.click(within(within(screen.getByRole("region", { name: "历史版本" })).getByText(/^版本 1/).closest("li")!).getByRole("button", { name: "删除版本" }));
  expect(requests.filter((row) => row.method === "DELETE")).toHaveLength(0);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "删除草稿" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requests.filter((row) => row.method === "DELETE")).toEqual([{ path: "/api/v1/me/charts/chart/versions/v1", method: "DELETE", body: { expectedRevision: 2 } }]);
  expect(within(screen.getByRole("region", { name: "历史版本" })).queryByText(/^版本 1/)).toBeNull();
});

test("an expired editor session redirects to login after the failed save", async () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  setup(() => Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, { status: 401 }));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?next=%2Fme%2Fcharts%2Fchart"));
});

test("editor permission failure keeps the input and displays denial without forcing another login", async () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  setup((_path, method) => method === "PATCH" ? Response.json({ error: { code: "FORBIDDEN", message: "Denied" } }, { status: 403 }) : Response.json(initial));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent === "你没有访问这份私有谱面的权限。")).toBe(true));
  expect((screen.getByRole("textbox", { name: "标题" }) as HTMLInputElement).value).toBe("Unsaved");
  expect(assign).not.toHaveBeenCalled();
});

test("publishing requires an explicit version and confirmation before any PUT", async () => {
  const requests = setup(() => Response.json({ ...initial, publication: null, publicationPending: false }));
  const section = screen.getByRole("region", { name: "公开发布" });
  const publish = within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }) as HTMLButtonElement;
  expect(publish.disabled).toBe(true);
  fireEvent.change(within(section).getByLabelText("公开版本"), { target: { value: "v1" } });
  expect(publish.disabled).toBe(true);
  expect(within(section).getByText(/原始 ZIP.*全部文件/)).toBeTruthy();
  expect(requests.some((row) => row.method === "PUT")).toBe(false);
});

function choosePublication() {
  const section = screen.getByRole("region", { name: "公开发布" });
  fireEvent.change(within(section).getByLabelText("公开版本"), { target: { value: "v1" } });
  fireEvent.click(within(section).getByRole("checkbox"));
  fireEvent.click(within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }));
  return section;
}
const publication = { description: "", credits: "", tags: [], releaseNote: "", versionId: "v1", title: "Original", artist: "Artist", publishedAt: initial.createdAt, updatedAt: initial.updatedAt };
test("lost publication response reconciles durable snapshot without replaying PUT", async () => {
  let actual = { ...initial, publication: null, publicationPending: false } as ChartDto;
  const requests = setup((_path, method) => {
    if (method === "PUT") { actual = { ...initial, revision: 3, publication, publicationPending: false }; throw new TypeError("Lost"); }
    return Response.json(actual);
  });
  choosePublication();
  await screen.findByText("公开快照已保存。");
  expect(requests.filter(row => row.method === "PUT")).toEqual([{ path: "/api/v1/me/charts/chart/publication", method: "PUT", body: { expectedRevision: 2, versionId: "v1", confirmOriginalArchive: true } }]);
  expect(requests.filter(row => row.method === "GET").length).toBeGreaterThan(0);
});
test.each([true, undefined])("pending or missing durable flag (%s) cannot report success and requires a read before explicit retry", async (publicationPending) => {
  let actual: ChartDto = { ...initial, publication, publicationPending };
  const requests = setup((_path, method) => {
    if (method === "PUT") throw new TypeError("Lost before durable journal");
    return Response.json(actual);
  });
  const section = choosePublication();
  await within(section).findByRole("button", { name: "检查发布状态" });
  await waitFor(() => expect((within(section).getByRole("button", { name: "检查发布状态" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("公开快照已保存。")).toBeNull();
  expect((within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }) as HTMLButtonElement).disabled).toBe(true);
  actual = { ...initial, revision: 3, publication: null, publicationPending: false };
  fireEvent.click(within(section).getByRole("button", { name: "检查发布状态" }));
  await waitFor(() => expect((within(section).getByLabelText("公开版本") as HTMLSelectElement).disabled).toBe(false));
  expect((within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(section).getByRole("checkbox"));
  expect((within(section).getByLabelText("公开版本") as HTMLSelectElement).value).toBe("v1");
  expect(requests.filter(row => row.method === "PUT")).toHaveLength(1);
  fireEvent.click(within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }));
  await waitFor(() => expect(requests.filter(row => row.method === "PUT")).toHaveLength(2));
  expect(requests.filter(row => row.method === "PUT")[1]?.body.expectedRevision).toBe(3);
});
test("unsaved private metadata prevents publishing and retains the chosen version", () => {
  const requests = setup(() => Response.json(initial));
  const section = screen.getByRole("region", { name: "公开发布" });
  fireEvent.change(within(section).getByLabelText("公开版本"), { target: { value: "v1" } });
  fireEvent.click(within(section).getByRole("checkbox"));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Unsaved title" } });
  expect((within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("textbox", { name: "标题" }) as HTMLInputElement).value).toBe("Unsaved title");
  expect((within(section).getByLabelText("公开版本") as HTMLSelectElement).value).toBe("v1");
  expect(requests.filter(row => row.method === "PUT")).toHaveLength(0);
});
test("later concurrent publication returned from mutation is never mistaken for requested snapshot", async () => {
  setup(() => Response.json({ ...initial, revision: 4, publication: { ...publication, title: "Concurrent title" }, publicationPending: false }));
  choosePublication();
  await screen.findByText("当前公开：Concurrent title · Artist");
  expect(screen.queryByText("公开快照已保存。")).toBeNull();
});
test("published historical version cannot be deleted and withdrawal uses revision plus confirmation", async () => {
  const requests = setup((_path, method) => Response.json(method === "DELETE" ? { ...initial, revision: 4, publication: null, publicationPending: false } : { ...initial, revision: 3, publication, publicationPending: false }), { ...initial, revision: 3, publication, publicationPending: false });
  expect((within(screen.getByText(/^版本 1 ·/).closest("li")!).getByRole("button", { name: "删除版本" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "撤回公开" }));
  expect(requests.filter(row => row.method === "DELETE")).toHaveLength(0);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认撤回" }));
  await screen.findByText("已撤回公开。");
  expect(requests.filter(row => row.method === "DELETE")).toEqual([{ path: "/api/v1/me/charts/chart/publication", method: "DELETE", body: { expectedRevision: 3 } }]);
});
test("failed withdrawal with pending journal does not report withdrawal or replay DELETE", async () => {
  const requests = setup((_path, method) => {
    if (method === "DELETE") throw new TypeError("Journal unavailable");
    return Response.json({ ...initial, revision: 4, publication: null, publicationPending: true });
  }, { ...initial, revision: 3, publication, publicationPending: false });
  fireEvent.click(screen.getByRole("button", { name: "撤回公开" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认撤回" }));
  await screen.findByRole("button", { name: "检查发布状态" });
  expect(screen.queryByText("已撤回公开。")).toBeNull();
  expect(requests.filter(row => row.method === "DELETE")).toHaveLength(1);
});

test("a pending 2xx publication is not success until explicit GET confirms the exact durable target", async () => {
  const requests = setup((_path, method) => Response.json({ ...initial, revision: 3, publication, publicationPending: method === "PUT" }));
  const section = choosePublication();
  await within(section).findByRole("button", { name: "检查发布状态" });
  await waitFor(() => expect((within(section).getByRole("button", { name: "检查发布状态" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("公开快照已保存。")).toBeNull();
  fireEvent.click(within(section).getByRole("button", { name: "检查发布状态" }));
  await screen.findByText("公开快照已保存。");
  expect(requests.filter(row => row.method === "PUT")).toHaveLength(1);
});
test("lost withdrawal response reads durable absence without replaying DELETE", async () => {
  const requests = setup((_path, method) => {
    if (method === "DELETE") throw new TypeError("Response lost");
    return Response.json({ ...initial, revision: 4, publication: null, publicationPending: false });
  }, { ...initial, revision: 3, publication, publicationPending: false });
  fireEvent.click(screen.getByRole("button", { name: "撤回公开" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认撤回" }));
  await screen.findByText("已撤回公开。");
  expect(requests.filter(row => row.method === "DELETE")).toHaveLength(1);
});

test("published state names the published ordinal and distinguishes private changes before an explicit update", async () => {
  const start = { ...initial, revision: 3, publication, publicationPending: false };
  let actual = start;
  const requests = setup((_path, method, body) => {
    if (method === "PUT") actual = { ...start, revision: 4, publication: { ...publication, versionId: String(body.versionId) } };
    return Response.json(actual);
  }, start);
  const section = screen.getByRole("region", { name: "公开发布" });
  expect(within(section).getByText("已公开", { exact: true })).toBeTruthy();
  expect(within(section).getByText("当前公开：版本 1")).toBeTruthy();
  expect(within(section).getByText("私有草稿与公开内容不同；编辑不会自动发布。")).toBeTruthy();
  const update = within(section).getByRole("button", { name: "确认更新公开内容" }) as HTMLButtonElement;
  expect(update.disabled).toBe(true);
  fireEvent.change(within(section).getByLabelText("公开版本"), { target: { value: "v2" } });
  expect(update.disabled).toBe(true);
  expect(requests.filter(row => row.method === "PUT")).toHaveLength(0);
  fireEvent.click(within(section).getByRole("checkbox"));
  fireEvent.click(update);
  await within(section).findByText("公开快照已保存。");
  expect(requests.filter(row => row.method === "PUT")).toEqual([{ path: "/api/v1/me/charts/chart/publication", method: "PUT", body: { expectedRevision: 3, versionId: "v2", confirmOriginalArchive: true } }]);
  expect(within(section).getByText("当前公开：版本 2")).toBeTruthy();
  expect(within(section).queryByText("私有草稿与公开内容不同；编辑不会自动发布。")).toBeNull();
});
test("a private metadata change is distinguished from the published snapshot even on the same version", () => {
  const start = { ...initial, currentVersionId: "v1", title: "Saved private edit", publication, publicationPending: false };
  setup(() => Response.json(start), start);
  const section = screen.getByRole("region", { name: "公开发布" });
  expect(within(section).getByText("当前公开：Original · Artist")).toBeTruthy();
  expect(within(section).getByText("私有草稿与公开内容不同；编辑不会自动发布。")).toBeTruthy();
});
test("an unchanged published version does not claim unpublished changes", () => {
  const start = { ...initial, currentVersionId: "v1", publication, publicationPending: false };
  setup(() => Response.json(start), start);
  const section = screen.getByRole("region", { name: "公开发布" });
  expect(within(section).getByText("已公开", { exact: true })).toBeTruthy();
  expect(within(section).queryByText("私有草稿与公开内容不同；编辑不会自动发布。")).toBeNull();
});
test.each([true, undefined])("uncertain publication durability (%s) is labelled pending and only allows checking state", (publicationPending) => {
  const start = { ...initial, publication, publicationPending };
  setup(() => Response.json(start), start);
  const section = screen.getByRole("region", { name: "公开发布" });
  expect(within(section).getByText("公开状态待确认", { exact: true })).toBeTruthy();
  expect(within(section).queryByText("已公开", { exact: true })).toBeNull();
  expect(within(section).queryByText("当前公开：版本 1")).toBeNull();
  expect((within(section).getByLabelText("公开版本") as HTMLSelectElement).disabled).toBe(true);
  expect((within(section).getByRole("button", { name: "确认更新公开内容" }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(section).getByRole("button", { name: "检查发布状态" })).toBeTruthy();
});

test.each(["publish", "withdraw"])("%s response and follow-up read both lost: publication remains uncertain without replay", async action => {
  const start = action === "withdraw" ? { ...initial, publication, publicationPending: false } : initial;
  const requests = setup(() => { throw new TypeError("Response lost"); }, start);
  const section = screen.getByRole("region", { name: "公开发布" });
  if (action === "publish") choosePublication();
  else {
    fireEvent.click(within(section).getByRole("button", { name: "撤回公开" }));
    fireEvent.click(within(within(section).getByRole("alertdialog")).getByRole("button", { name: "确认撤回" }));
  }
  await within(section).findByText("公开状态待确认", { exact: true });
  await waitFor(() => expect((within(section).getByRole("button", { name: "检查发布状态" }) as HTMLButtonElement).disabled).toBe(false));
  expect(within(section).queryByText("已公开", { exact: true })).toBeNull();
  expect(within(section).queryByText("私有草稿", { exact: true })).toBeNull();
  expect(within(section).queryByText("当前公开：版本 1")).toBeNull();
  expect(within(section).queryByText("公开快照已保存。")).toBeNull();
  expect(within(section).queryByText("已撤回公开。")).toBeNull();
  expect((within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(requests.filter(row => row.method === (action === "publish" ? "PUT" : "DELETE"))).toHaveLength(1);
  expect(requests.filter(row => row.method === "GET")).toHaveLength(1);
});

test("metadata conflict requires an explicit difference review before retrying at the new revision", async () => {
  let actual = { ...initial, revision: 3, description: "Other tab description" }, attempts = 0;
  const requests = setup((_path, method, body) => {
    if (method === "PATCH") {
      attempts++;
      if (attempts === 1) return Response.json({ error: { code: "CHART_CHANGED", message: "Changed" } }, { status: 409 });
      actual = { ...actual, description: String(body.description), revision: 4 };
    }
    return Response.json(actual);
  });
  fireEvent.change(screen.getByRole("textbox", { name: /作品介绍/ }), { target: { value: "My description" } });
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await screen.findByText("Other tab description");
  expect((screen.getByRole("textbox", { name: /作品介绍/ }) as HTMLTextAreaElement).value).toBe("My description");
  expect((screen.getByRole("button", { name: "保存作品资料" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: m.chart_metadata_reviewed() }));
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await waitFor(() => expect(requests.filter(request => request.method === "PATCH")).toHaveLength(2));
  expect(requests.filter(request => request.method === "PATCH").map(request => request.body.expectedRevision)).toEqual([2,3]);
});
test("saving description, credits, normalized tags and one version note never publishes automatically", async () => {
  let actual = initial;
  const requests = setup((_path, method, body) => {
    if (method === "PATCH") actual = { ...initial, revision: 3, description: String(body.description), credits: String(body.credits),
      tags: [{ key: "abc", label: "ＡＢＣ" }], versions: initial.versions.map(version => version.id === "v2" ? { ...version, releaseNote: "Version two note" } : version) };
    return Response.json(actual);
  });
  fireEvent.change(screen.getByRole("textbox", { name: /作品介绍/ }), { target: { value: "Description\nSecond line" } });
  fireEvent.change(screen.getByRole("textbox", { name: /署名与来源/ }), { target: { value: "Original author" } });
  fireEvent.change(screen.getByRole("textbox", { name: m.chart_metadata_tags() }), { target: { value: "ＡＢＣ\nabc" } });
  fireEvent.change(screen.getByRole("textbox", { name: /所选版本更新说明/ }), { target: { value: "Version two note" } });
  fireEvent.click(screen.getByRole("button", { name: "保存作品资料" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "保存作品资料" }) as HTMLButtonElement).disabled).toBe(true));
  expect(requests.filter(request => request.method === "PATCH")[0]?.body).toMatchObject({ description: "Description\nSecond line", credits: "Original author", tags: ["ＡＢＣ"], releaseNote: { versionId: "v2", text: "Version two note" } });
  expect(requests.some(request => request.method === "PUT")).toBe(false);
});
test("unsaved editor text blocks navigation and cancel preserves it without localStorage", async () => {
  const storage = vi.spyOn(window.localStorage, "setItem");
  setup(() => Response.json(initial));
  fireEvent.change(screen.getByRole("textbox", { name: /作品介绍/ }), { target: { value: "Unsaved private text" } });
  fireEvent.click(document.querySelector('a[href="/me/charts"]')!);
  const dialog = await screen.findByRole("alertdialog", { name: m.chart_metadata_unsaved() });
  fireEvent.click(within(dialog).getByRole("button", { name: m.avatar_cancel() }));
  expect((screen.getByRole("textbox", { name: /作品介绍/ }) as HTMLTextAreaElement).value).toBe("Unsaved private text");
  expect(storage).not.toHaveBeenCalled();
});
test("publication comparison reads public metadata from its snapshot and checks the full intended metadata after response loss", async () => {
  const start = { ...initial, description: "Private description", credits: "Private credits", tags: [{ key: "new", label: "New" }],
    versions: initial.versions.map(version => ({ ...version, releaseNote: "Private note" })), publication: { ...publication, description: "Public description", releaseNote: "Public note" } };
  setup((_path, method) => {
    if (method === "PUT") throw new TypeError("Lost");
    return Response.json({ ...start, revision: 4, publication: { ...publication, description: "Concurrent description", credits: "Private credits", tags: start.tags, releaseNote: "Private note" }, publicationPending: false });
  }, start);
  const section = screen.getByRole("region", { name: "公开发布" });
  fireEvent.change(within(section).getByLabelText("公开版本"), { target: { value: "v1" } });
  expect(within(section).getByText("Public description")).toBeTruthy(); expect(within(section).getByText("Private description")).toBeTruthy();
  fireEvent.click(within(section).getByRole("checkbox"));
  fireEvent.click(within(section).getByRole("button", { name: /^确认(?:发布|更新公开内容)$/ }));
  await within(section).findByText("Concurrent description");
  expect(within(section).queryByText("公开快照已保存。")).toBeNull();
});

test("server-rendered publication controls wait for hydration before accepting a version choice",()=>{
 const markup=renderToString(<MemoryRouter><ChartPublication chart={initial} busy={false} setBusy={()=>{}} refresh={async()=>{}}/></MemoryRouter>),host=document.createElement("div");host.innerHTML=markup;
 expect((host.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
});
