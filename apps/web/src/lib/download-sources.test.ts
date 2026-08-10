import { describe, expect, test } from "bun:test";

import type { ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  canonicalDownloadResourceUrl,
  CUSTOM_DOWNLOAD_SOURCE_ID,
  DEFAULT_DOWNLOAD_SOURCE_ID,
  DOWNLOAD_SOURCES,
  getDownloadSource,
  getDownloadSourceProbeUrl,
  getSelectableDownloadSource,
  inferDownloadSourceId,
  normalizeCustomDownloadSourceUrl,
  pickFailoverDownloadSource,
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
  test("defaults to R2 and keeps configured routes in display order", () => {
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
      "tsumugi",
      "awmc",
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
    expect(resolveDownloadUrl(spec.files[1].url, "tsumugi")).toBe(
      "https://astrodx-charts-tsumugi.saop.cc/25/11951/track.mp3"
    );
    expect(resolveDownloadUrl(spec.files[1].url, "awmc")).toBe(
      "https://astrodx-charts-wmc.saop.cc/25/11951/track.mp3"
    );
    expect(resolveDownloadUrl(spec.files[1].url, "g400s")).toBe(
      "https://astrodx-charts-g400s.saop.cc/25/11951/track.mp3"
    );
    expect(
      resolveDownloadUrl(
        "https://astrodx-charts-alice.saop.cc/25/11951/maidata.txt",
        "g510"
      )
    ).toBe("https://astrodx-charts-g510.saop.cc/25/11951/maidata.txt");

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

  test("validates and normalizes a custom mirror root", () => {
    expect(
      normalizeCustomDownloadSourceUrl(" https://mirror.example.com/charts/ ")
    ).toBe("https://mirror.example.com/charts");
    expect(normalizeCustomDownloadSourceUrl("http://localhost:8787/")).toBe(
      "http://localhost:8787"
    );
    expect(
      normalizeCustomDownloadSourceUrl("http://mirror.example.com")
    ).toBeNull();
    expect(normalizeCustomDownloadSourceUrl("/relative")).toBeNull();
    expect(normalizeCustomDownloadSourceUrl("ftp://mirror.example.com")).toBeNull();
    expect(
      normalizeCustomDownloadSourceUrl("https://user:secret@mirror.example.com")
    ).toBeNull();
    expect(
      normalizeCustomDownloadSourceUrl("https://mirror.example.com?token=secret")
    ).toBeNull();
    expect(
      normalizeCustomDownloadSourceUrl("https://mirror.example.com#download")
    ).toBeNull();
    expect(getSelectableDownloadSource("custom", "").id).toBe("r2");
  });

  test("routes through a custom path prefix and can switch away without stacking", () => {
    const customA = "https://mirror.example.com/charts";
    const customB = "https://backup.example.com/media";
    expect(resolveDownloadUrl(spec.files[1].url, "custom", customA)).toBe(
      "https://mirror.example.com/charts/25/11951/track.mp3"
    );
    expect(
      rerouteDownloadUrl(
        "https://mirror.example.com/charts/25/11951/track.mp3",
        "custom",
        "alice",
        customA
      )
    ).toBe("https://astrodx-charts-alice.saop.cc/25/11951/track.mp3");
    expect(
      rerouteDownloadUrl(
        "https://mirror.example.com/charts/25/11951/track.mp3",
        "custom",
        "custom",
        customA,
        customB
      )
    ).toBe("https://backup.example.com/media/25/11951/track.mp3");
    expect(resolveDownloadUrl(spec.files[2].url, "custom", customA)).toBe(
      spec.files[2].url
    );
  });

  test("normalizes mirror hosts while leaving unrelated resources exact", () => {
    expect(
      canonicalDownloadResourceUrl(
        "https://astrodx-charts-alice.saop.cc/25/11951/track.mp3?download=1"
      )
    ).toBe("https://astrodx-charts.saop.cc/25/11951/track.mp3?download=1");
    expect(
      canonicalDownloadResourceUrl("https://adxcs.saop.cc/25/11951/maidata.txt")
    ).toBe("https://astrodx-charts.saop.cc/25/11951/maidata.txt");
    expect(
      resolveDownloadUrl("https://adxcs.saop.cc/25/11951/maidata.txt", "alice")
    ).toBe("https://astrodx-charts-alice.saop.cc/25/11951/maidata.txt");
    expect(canonicalDownloadResourceUrl("https://example.test/track.mp3")).toBe(
      "https://example.test/track.mp3"
    );
    expect(
      canonicalDownloadResourceUrl(
        "https://mirror.example.com/charts/25/11951/track.mp3",
        ["https://mirror.example.com/charts"]
      )
    ).toBe("https://astrodx-charts.saop.cc/25/11951/track.mp3");
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
    expect(
      inferDownloadSourceId(
        [{ url: "https://mirror.example.com/charts/25/11951/track.mp3" }],
        "custom",
        "https://mirror.example.com/charts"
      )
    ).toBe(CUSTOM_DOWNLOAD_SOURCE_ID);
  });

  test("builds each latency probe URL from the configured mirror root", () => {
    expect(getDownloadSourceProbeUrl("r2")).toBe(
      "https://astrodx-charts.saop.cc/0/10/track.mp3"
    );
    expect(getDownloadSourceProbeUrl("g400s")).toBe(
      "https://astrodx-charts-g400s.saop.cc/0/10/track.mp3"
    );
    expect(getDownloadSourceProbeUrl("awmc")).toBe(
      "https://astrodx-charts-wmc.saop.cc/0/10/track.mp3"
    );
    expect(
      getDownloadSourceProbeUrl(
        "custom",
        "https://mirror.example.com/charts/"
      )
    ).toBe("https://mirror.example.com/charts/0/10/track.mp3");
  });

  test("failover picks the fastest healthy route this run has not burned", () => {
    const probes = {
      r2: { state: "ok", latencyMs: 40 },
      alice: { state: "ok", latencyMs: 15 },
      tsumugi: { state: "timeout", latencyMs: null },
      awmc: { state: "ok", latencyMs: 90 },
    };

    expect(pickFailoverDownloadSource(probes, [])).toBe("alice");
    // The route that just failed must never be re-picked.
    expect(pickFailoverDownloadSource(probes, ["alice"])).toBe("r2");
    expect(pickFailoverDownloadSource(probes, ["alice", "r2"])).toBe("awmc");
  });

  test("failover never lands on an unprobed, failing or unknown route", () => {
    // Moving a job onto a mirror we know is down is strictly worse than
    // reporting the failure, so only `ok` probes are candidates.
    expect(
      pickFailoverDownloadSource({
        r2: { state: "error", latencyMs: null },
        alice: { state: "idle", latencyMs: null },
        tsumugi: { state: "testing", latencyMs: null },
      }, [])
    ).toBeNull();
    expect(
      pickFailoverDownloadSource(
        { "not-a-route": { state: "ok", latencyMs: 5 } },
        []
      )
    ).toBeNull();
  });

  test("failover uses a custom route only when it is still configured", () => {
    const probes = { "custom:abc": { state: "ok", latencyMs: 5 } };
    expect(pickFailoverDownloadSource(probes, [])).toBeNull();
    expect(
      pickFailoverDownloadSource(probes, [], [
        { id: "custom:abc", name: "Mine", baseUrl: "https://mirror.example.com" },
      ])
    ).toBe("custom:abc");
  });

  test("a probe with no latency sorts behind every measured route", () => {
    expect(
      pickFailoverDownloadSource(
        {
          r2: { state: "ok", latencyMs: null },
          alice: { state: "ok", latencyMs: 300 },
        },
        []
      )
    ).toBe("alice");
  });
});
