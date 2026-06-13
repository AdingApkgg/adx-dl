import { describe, expect, mock, test } from "bun:test";

import {
  buildAdxDirectoryUrl,
  fetchAdxDirectoryFiles,
  parseAdxDirectoryFiles,
} from "./adx-directory";

const listingHtml = `
  <html>
    <body>
      <a href="../">Parent directory</a>
      <a href="?sort=name&order=asc">Name</a>
      <a href="bg.jpg">bg.jpg</a>
      <a href="maidata.txt">maidata.txt</a>
      <a href="nested/">nested/</a>
      <a href="track.mp3">track.mp3</a>
    </body>
  </html>
`;

describe("adx directory probing", () => {
  test("builds a trailing-slash directory url", () => {
    expect(buildAdxDirectoryUrl("39")).toBe("https://adx-dl.larx.cc/39/");
    expect(buildAdxDirectoryUrl("[X] 人マニア")).toBe(
      "https://adx-dl.larx.cc/%5BX%5D%20%E4%BA%BA%E3%83%9E%E3%83%8B%E3%82%A2/"
    );
  });

  test("keeps only direct child files from a directory listing", () => {
    expect(parseAdxDirectoryFiles(listingHtml, "https://adx-dl.larx.cc/39/")).toEqual([
      { name: "bg.jpg", url: "https://adx-dl.larx.cc/39/bg.jpg" },
      { name: "maidata.txt", url: "https://adx-dl.larx.cc/39/maidata.txt" },
      { name: "track.mp3", url: "https://adx-dl.larx.cc/39/track.mp3" },
    ]);
  });

  test("throws when duplicate file names are present", () => {
    const duplicateHtml = `
      <a href="track.mp3">track.mp3</a>
      <a href="./track.mp3">track.mp3</a>
    `;

    expect(() =>
      parseAdxDirectoryFiles(duplicateHtml, "https://adx-dl.larx.cc/39/")
    ).toThrow("Duplicate file name");
  });

  test("fetches and parses a remote directory listing", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(listingHtml)));
    globalThis.fetch = fetchMock as typeof fetch;

    const files = await fetchAdxDirectoryFiles("39");

    expect(fetchMock).toHaveBeenCalledWith("https://adx-dl.larx.cc/39/", { cache: "no-store" });
    expect(files).toHaveLength(3);
  });
});
