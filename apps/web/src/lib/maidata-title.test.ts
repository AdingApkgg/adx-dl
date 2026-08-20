import { describe, expect, test } from "bun:test";

import { chartDirWithMaidataId, tagMaidataInputs, tagMaidataTitle } from "./maidata-title";

/** A miniature but shape-accurate maidata: CRLF line endings, real field order. */
function maidata(shortid: string, title = "ジングルベル"): string {
  return [
    `&title=${title}`,
    "&artist=SEGA Sound Unit [H.]",
    "&first=0",
    "&wholebpm=100",
    `&shortid=${shortid}`,
    "&versionid=0",
    "",
    "&lv_2=6.0",
    "&inote_2=(100){1},,E",
    "",
  ].join("\r\n");
}

describe("tagMaidataTitle", () => {
  test("appends [SD] to a standard chart's title", () => {
    const tagged = tagMaidataTitle(maidata("70"));

    expect(tagged).toContain("&title=ジングルベル [SD]\r\n");
    // Only the title line changes; everything else must be byte-identical.
    expect(tagged.replace("ジングルベル [SD]", "ジングルベル")).toBe(maidata("70"));
  });

  test("returns the input string itself for a DX chart", () => {
    const text = maidata("10070");

    expect(tagMaidataTitle(text)).toBe(text);
  });

  test("moves an UTAGE chart's kanji prefix to a spaced suffix", () => {
    const tagged = tagMaidataTitle(maidata("100070", "[即]ジングルベル"));

    expect(tagged).toContain("&title=ジングルベル [即]\r\n");
    // Only the title line changes; everything else must be byte-identical.
    expect(tagged.replace("ジングルベル [即]", "[即]ジングルベル")).toBe(
      maidata("100070", "[即]ジングルベル")
    );
  });

  test("leaves an UTAGE title without a bracket prefix alone", () => {
    const text = maidata("100999", "素のタイトル");

    expect(tagMaidataTitle(text)).toBe(text);
  });

  test("leaves a file without &shortid alone", () => {
    const text = "&title=Custom Song\r\n&artist=someone\r\n&inote_5=(120)E\r\n";

    expect(tagMaidataTitle(text)).toBe(text);
  });

  test("leaves a non-numeric &shortid alone", () => {
    const text = maidata("abc");

    expect(tagMaidataTitle(text)).toBe(text);
  });

  test("is idempotent", () => {
    const sd = tagMaidataTitle(maidata("70"));
    const utage = tagMaidataTitle(maidata("100070", "[即]ジングルベル"));

    expect(tagMaidataTitle(sd)).toBe(sd);
    expect(tagMaidataTitle(utage)).toBe(utage);
  });

  test("leaves an empty title alone", () => {
    const text = maidata("70", "");

    expect(tagMaidataTitle(text)).toBe(text);
  });

  test("tolerates and preserves a UTF-8 BOM", () => {
    const text = `﻿${maidata("70")}`;
    const tagged = tagMaidataTitle(text);

    expect(tagged.startsWith("﻿&title=ジングルベル [SD]")).toBe(true);
  });

  test("works with LF line endings too", () => {
    const tagged = tagMaidataTitle("&title=Song\n&shortid=70\n&inote_2=E\n");

    expect(tagged).toBe("&title=Song [SD]\n&shortid=70\n&inote_2=E\n");
  });

  test("only rewrites the first &title line", () => {
    const text = "&title=Song\r\n&shortid=70\r\n&inote_2=E\r\n&title=Song\r\n";

    expect(tagMaidataTitle(text)).toBe(
      "&title=Song [SD]\r\n&shortid=70\r\n&inote_2=E\r\n&title=Song\r\n"
    );
  });
});

describe("tagMaidataInputs", () => {
  const encoder = new TextEncoder();
  const input = (name: string, content: string | Uint8Array) => ({
    name,
    blob: new Blob([
      (typeof content === "string" ? encoder.encode(content) : content) as BlobPart,
    ]),
  });

  test("rewrites maidata entries at both single and batch paths", async () => {
    const inputs = [
      input("maidata.txt", maidata("70")),
      input("3/maidata.txt", maidata("131", "Link")),
      input("track.mp3", "not really audio"),
    ];
    const result = await tagMaidataInputs(inputs);

    expect(await result[0]?.blob.text()).toContain("&title=ジングルベル [SD]\r\n");
    expect(await result[1]?.blob.text()).toContain("&title=Link [SD]\r\n");
    // Non-maidata blobs keep their identity — no decode/re-encode round trip.
    expect(result[2]?.blob).toBe(inputs[2]!.blob);
  });

  test("keeps blob identity when nothing needs tagging", async () => {
    const inputs = [
      input("maidata.txt", maidata("10070")),
      input("bg.png", "not really an image"),
    ];
    const result = await tagMaidataInputs(inputs);

    expect(result[0]?.blob).toBe(inputs[0]!.blob);
    expect(result[1]?.blob).toBe(inputs[1]!.blob);
  });

  test("never rebuilds a blob whose bytes do not decode as UTF-8", async () => {
    // A custom-source maidata in a legacy encoding: decoding produces U+FFFD,
    // and re-encoding that would corrupt the file. It must pass through as-is.
    const gbkish = new Uint8Array([...encoder.encode("&title="), 0xd6, 0xd0, ...encoder.encode("\r\n&shortid=70\r\n")]);
    const inputs = [input("maidata.txt", gbkish)];
    const result = await tagMaidataInputs(inputs);

    expect(result[0]?.blob).toBe(inputs[0]!.blob);
  });

  test("does not touch files merely named like maidata", async () => {
    const inputs = [input("maidata.txt.bak", maidata("70"))];
    const result = await tagMaidataInputs(inputs);

    expect(result[0]?.blob).toBe(inputs[0]!.blob);
  });
});

describe("chartDirWithMaidataId", () => {
  test("prefixes an old-style dir with the zero-padded shortid", () => {
    expect(chartDirWithMaidataId("ジングルベル", maidata("70"))).toBe("000070 ジングルベル");
    expect(chartDirWithMaidataId("ジングルベル", maidata("10070"))).toBe(
      "010070 ジングルベル"
    );
  });

  test("leaves an already-prefixed dir alone", () => {
    expect(chartDirWithMaidataId("000070 ジングルベル", maidata("70"))).toBe(
      "000070 ジングルベル"
    );
  });

  test("leaves the dir alone without a usable shortid", () => {
    expect(chartDirWithMaidataId("ジングルベル", "&title=x\r\n&inote_2=E\r\n")).toBe(
      "ジングルベル"
    );
    expect(chartDirWithMaidataId("ジングルベル", maidata("n/a"))).toBe("ジングルベル");
  });

  test("applies the byte budget when prefixing", () => {
    const long = "ア".repeat(45); // 135 bytes; prefixed it must shrink to <= 125
    const dir = chartDirWithMaidataId(long, maidata("547"));

    expect(dir.startsWith("000547 ")).toBe(true);
    expect(new TextEncoder().encode(dir).length).toBeLessThanOrEqual(125);
  });
});
