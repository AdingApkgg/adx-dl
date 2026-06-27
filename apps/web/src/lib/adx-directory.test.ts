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

const realListingHtml = `
  <html>
    <body>
      <nav>
        <a href="javascript:updateColorScheme(&quot;default&quot;)">Default theme</a>
      </nav>
      <h1>
        <a href="/">adxcs.saop.cc</a>
        <span>39</span>
      </h1>
      <table>
        <tbody>
          <tr>
            <td><a href="../">Parent directory</a></td>
          </tr>
          <tr>
            <td><a href="/39/bg.jpg">bg.jpg</a></td>
          </tr>
          <tr>
            <td><a href="/39/maidata.txt">maidata.txt</a></td>
          </tr>
          <tr>
            <td><a href="/39/pv.mp4">pv.mp4</a></td>
          </tr>
          <tr>
            <td><a href="/39/track.mp3">track.mp3</a></td>
          </tr>
        </tbody>
      </table>
    </body>
  </html>
`;

describe("adx directory probing", () => {
  test("builds a trailing-slash directory url", () => {
    expect(buildAdxDirectoryUrl("39")).toBe("https://adxcs.saop.cc/39/");
    expect(buildAdxDirectoryUrl("[X] 人マニア")).toBe(
      "https://adxcs.saop.cc/%5BX%5D%20%E4%BA%BA%E3%83%9E%E3%83%8B%E3%82%A2/"
    );
  });

  test("keeps only direct child files from a directory listing", () => {
    expect(parseAdxDirectoryFiles(listingHtml, "https://adxcs.saop.cc/39/")).toEqual([
      { name: "bg.jpg", url: "https://adxcs.saop.cc/39/bg.jpg" },
      { name: "maidata.txt", url: "https://adxcs.saop.cc/39/maidata.txt" },
      { name: "track.mp3", url: "https://adxcs.saop.cc/39/track.mp3" },
    ]);
  });

  test("ignores theme and site links outside the probed directory", () => {
    expect(parseAdxDirectoryFiles(realListingHtml, "https://adxcs.saop.cc/39/")).toEqual([
      { name: "bg.jpg", url: "https://adxcs.saop.cc/39/bg.jpg" },
      { name: "maidata.txt", url: "https://adxcs.saop.cc/39/maidata.txt" },
      { name: "pv.mp4", url: "https://adxcs.saop.cc/39/pv.mp4" },
      { name: "track.mp3", url: "https://adxcs.saop.cc/39/track.mp3" },
    ]);
  });

  test("throws when duplicate file names are present", () => {
    const duplicateHtml = `
      <a href="track.mp3">track.mp3</a>
      <a href="./track.mp3">track.mp3</a>
    `;

    expect(() =>
      parseAdxDirectoryFiles(duplicateHtml, "https://adxcs.saop.cc/39/")
    ).toThrow("Duplicate file name");
  });

  test("fetches and parses a remote directory listing", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(listingHtml)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const files = await fetchAdxDirectoryFiles("39");

    expect(fetchMock).toHaveBeenCalledWith("https://adxcs.saop.cc/39/", { cache: "no-store" });
    expect(files).toHaveLength(3);
  });
});
