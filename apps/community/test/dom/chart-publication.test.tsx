import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ChartPublication } from "@/client/components/chart-publication";
import { m } from "@/paraglide/messages.js";
import type { ChartDto, ChartVersionDto } from "@/shared/charts";

const api = vi.hoisted(() => ({
  fingerprint: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/client/queries/charts", () => ({ chartsApi: () => api }));
vi.mock("@/client/lib/browser", () => ({ getRenderApi: () => ({}) }));
vi.mock("@/client/components/private-chart-preview", () => ({ PrivateChartPreview: () => null }));

const version: ChartVersionDto = {
  id: "first",
  ordinal: 1,
  sourceFileId: "source",
  sourceSize: 4096,
  releaseNote: "",
  createdAt: "",
  summary: {
    title: "Chart",
    artist: "Artist",
    maidataMd5Base64: "",
    difficulties: [{ difficulty: 4, level: "12", noteCount: 3, durationMs: 5000, previewSupported: true }],
    warnings: [{ code: "AUDIO_MISSING" }],
    audio: null,
    hasCover: false,
  },
};

const draft: ChartDto = {
  id: "draft",
  publicId: null,
  revision: 7,
  currentVersionId: "second",
  versions: [version, { ...version, id: "second", ordinal: 2 }],
  title: "Chart",
  artist: "Artist",
  description: "",
  credits: "",
  tags: [],
  publication: null,
  publicationPending: false,
  createdAt: "",
  updatedAt: "",
};

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function mountPublication(chart: ChartDto) {
  const refresh = vi.fn(async (_chart: ChartDto) => {});
  const view = (value: ChartDto) => (
    <MemoryRouter initialEntries={["/me/charts/draft#publication"]}>
      <ChartPublication chart={value} busy={false} setBusy={() => {}} refresh={refresh} />
    </MemoryRouter>
  );
  const { rerender } = render(view(chart));
  return { refresh, update: (chart: ChartDto) => rerender(view(chart)) };
}

function prepareFingerprint() {
  api.fingerprint.mockImplementation(async (_chartId: string, versionId: string) => ({
    versionId,
    source: { size: 4096, sha256: "a".repeat(64) },
    assets: { maidata: { size: 512, mime: "text/plain", sha256: "b".repeat(64) } },
  }));
}

test("opening the review preselects the current draft without publishing and resets confirmation when version or revision changes", async () => {
  prepareFingerprint();
  const { update } = mountPublication(draft);
  const versionPicker = screen.getByRole("combobox", { name: m.chart_publication_version() }) as HTMLSelectElement;
  const confirm = screen.getByRole("checkbox", { name: m.chart_publication_archive() }) as HTMLInputElement;
  const publish = screen.getByRole("button", { name: m.chart_publication_confirm() }) as HTMLButtonElement;
  expect(versionPicker.value).toBe("second");
  expect(screen.getByText(m.chart_warning_audio())).toBeTruthy();
  expect(publish.disabled).toBe(true);
  expect(api.publish).not.toHaveBeenCalled();

  fireEvent.click(confirm);
  expect(publish.disabled).toBe(false);
  fireEvent.change(versionPicker, { target: { value: "first" } });
  expect(publish.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(publish.disabled).toBe(false);

  update({ ...draft, revision: 8, title: "Edited" });
  expect(publish.disabled).toBe(true);
  expect(api.publish).not.toHaveBeenCalled();
  await waitFor(() => expect(api.fingerprint).toHaveBeenCalledWith("draft", "first", expect.any(AbortSignal)));

  const newest = { ...version, id: "third", ordinal: 3 };
  update({ ...draft, revision: 9, currentVersionId: newest.id, versions: [...draft.versions, newest] });
  expect(versionPicker.value).toBe(newest.id);
  expect(publish.disabled).toBe(true);
  await waitFor(() => expect(api.fingerprint).toHaveBeenCalledWith("draft", newest.id, expect.any(AbortSignal)));
});

test("publishing the reviewed version enables the public page and copy action", async () => {
  prepareFingerprint();
  const published = {
    ...draft,
    revision: 8,
    publicId: "42",
    publication: {
      title: draft.title,
      artist: draft.artist,
      description: "",
      credits: "",
      tags: [],
      versionId: "second",
      releaseNote: "",
      publishedAt: "",
      updatedAt: "",
    },
  };
  api.publish.mockResolvedValue(published);
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText }, share: vi.fn() });

  const { refresh, update } = mountPublication(draft);
  fireEvent.click(screen.getByRole("checkbox", { name: m.chart_publication_archive() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_publication_confirm() }));
  await waitFor(() => expect(refresh).toHaveBeenCalledWith(published));
  expect(api.publish).toHaveBeenCalledWith("draft", 7, "second");

  update(published);
  expect(screen.getByRole("link", { name: m.chart_publication_view() }).getAttribute("href")).toBe("/charts/42");
  fireEvent.click(screen.getByRole("button", { name: "复制公开链接" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://community.test/charts/42"));
  expect(navigator.share).not.toHaveBeenCalled();
});
