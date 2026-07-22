import { describe, expect, test } from "bun:test";

import type { ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  canonicalDownloadResourceUrl,
  DEFAULT_DOWNLOAD_SOURCE_ID,
  DOWNLOAD_SOURCES,
  getDownloadSource,
  getDownloadSourceProbeUrl,
  inferDownloadSourceId,
  rerouteDownloadUrl,
  resolveDownloadUrl,
  routeChartDownloadSpec,
} from "@/lib/download-sources";

const spec: ChartDownloadSpec = {
  dir: "Test Song",
  groupDir: "25 CiRCLE",
  files: [
    { name: "maidata.txt", url: "/adxcs/11951/maidata.txt" },
    {
      name: "track.mp3",
      url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
    },
    { name: "license.txt", url: "https://example.test/license.txt" },
  ],
};

describe("download source routing", () => {
  test("defaults to R2 and keeps the four configured routes in display order", () => {
    expect(DEFAULT_DOWNLOAD_SOURCE_ID).toBe("r2");
    expect(getDownloadSource("missing").id).toBe("r2");
    expect(getDownloadSource("cdn").id).toBe("r2");
    expect(DOWNLOAD_SOURCES[0]).toMatchObject({
      id: "r2",
      role: "primary",
      status: "available",
    });
    expect(DOWNLOAD_SOURCES.map((source) => source.id)).toEqual([
      "r2",
      "alice",
      "g510",
      "g400s",
    ]);
    expect(routeChartDownloadSpec(spec, "r2")).toEqual(spec);
  });

  test("rewrites only chart-media URLs for every backup route", () => {
    expect(resolveDownloadUrl(spec.files[1].url, "alice")).toBe(
      "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3"
    );
    expect(resolveDownloadUrl(spec.files[1].url, "g510")).toBe(
      "https://astrodx-charts-g510.saop.cc/25/11951/track.mp3"
    );
    expect(resolveDownloadUrl(spec.files[1].url, "g400s")).toBe(
      "https://astrodx-charts-g400s.saop.cc/25/11951/track.mp3"
    );

    expect(routeChartDownloadSpec(spec, "alice")).toEqual({
      ...spec,
      files: [
        { name: "maidata.txt", url: "/adxcs/11951/maidata.txt" },
        {
          name: "track.mp3",
          url: "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3",
        },
        { name: "license.txt", url: "https://example.test/license.txt" },
      ],
    });
  });

  test("can move a persisted URL between backup routes without stacking hosts", () => {
    expect(
      rerouteDownloadUrl(
        "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3",
        "alice",
        "g510"
      )
    ).toBe("https://astrodx-charts-g510.saop.cc/25/11951/track.mp3");
    expect(
      rerouteDownloadUrl(
        "https://astrodx-charts-g510.saop.cc/25/11951/track.mp3",
        "g510",
        "r2"
      )
    ).toBe("https://astrodx-charts.saop.cc/25/11951/track.mp3");
  });

  test("normalizes mirror hosts while leaving unrelated resources exact", () => {
    expect(
      canonicalDownloadResourceUrl(
        "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3?download=1"
      )
    ).toBe("https://astrodx-charts.saop.cc/25/11951/track.mp3?download=1");
    expect(canonicalDownloadResourceUrl("https://example.test/track.mp3")).toBe(
      "https://example.test/track.mp3"
    );
  });

  test("infers the route for jobs persisted before source ids existed", () => {
    expect(
      inferDownloadSourceId([
        { url: "/adxcs/11951/maidata.txt" },
        { url: "https://astrodx-charts.saop.cc/25/11951/track.mp3" },
        { url: "https://adxcs.saop.cc/25/11951/bg.png" },
      ])
    ).toBe("r2");
    expect(
      inferDownloadSourceId([
        { url: "/adxcs/11951/maidata.txt" },
        { url: "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3" },
      ])
    ).toBe("alice");
    expect(
      inferDownloadSourceId(
        [{ url: "https://astrodx-charts.saop.cc/25/11951/track.mp3" }],
        "cdn"
      )
    ).toBe("r2");
  });

  test("builds each latency probe URL from the configured mirror root", () => {
    expect(getDownloadSourceProbeUrl("r2")).toBe(
      "https://astrodx-charts.saop.cc/0/10/track.mp3"
    );
    expect(getDownloadSourceProbeUrl("g400s")).toBe(
      "https://astrodx-charts-g400s.saop.cc/0/10/track.mp3"
    );
  });
});
