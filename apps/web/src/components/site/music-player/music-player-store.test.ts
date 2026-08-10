import { describe, expect, test } from "bun:test";

import type { MusicTrack } from "@/lib/music-playlists";

import {
  buildMusicPlayerQueue,
  createMusicPlayerStore,
  fisherYatesShuffle,
  nextMusicTrackId,
  previousMusicTrackId,
} from "./music-player-store";

function track(id: string, versionId: number): MusicTrack {
  return {
    id,
    slug: `${versionId}-${id}`,
    title: id.toUpperCase(),
    artist: "AstroDX",
    versionId,
    versionName: `Version ${versionId}`,
    coverUrl: `https://assets.example.com/${id}.webp`,
    audioUrl: `https://assets.example.com/${id}.mp3`,
  };
}

function randomSequence(...values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("music-player queue helpers", () => {
  test("Fisher-Yates returns a deterministic shuffled copy", () => {
    const input = ["a", "b", "c", "d"];

    expect(fisherYatesShuffle(input, randomSequence(0, 0, 0))).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
    expect(input).toEqual(["a", "b", "c", "d"]);
  });

  test("builds queues from unique stable ids and keeps the current shuffle item", () => {
    const tracks = [track("a", 1), track("b", 1), track("a", 1), track("c", 1)];

    expect(buildMusicPlayerQueue(tracks, "sequence", "b")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      buildMusicPlayerQueue(tracks, "shuffle", "b", randomSequence(0))
    ).toEqual(["b", "c", "a"]);
  });

  test("resolves cyclic neighbors without mutating a selection", () => {
    const queue = ["a", "c", "b"];

    expect(nextMusicTrackId(queue, "b", "sequence")).toBe("a");
    expect(previousMusicTrackId(queue, "a", "sequence")).toBe("b");
    expect(nextMusicTrackId(queue, "c", "repeat-one")).toBe("c");
    expect(previousMusicTrackId(queue, "c", "repeat-one")).toBe("c");
    expect(nextMusicTrackId([], "a", "sequence")).toBeNull();
  });
});

describe("music-player store", () => {
  test("bootstraps validated persisted preferences without browser storage", () => {
    const store = createMusicPlayerStore(randomSequence(0));

    store.getState().bootstrap(
      1,
      [track("a", 1), track("b", 1), track("a", 1), track("c", 1)],
      {
        versionId: "1",
        trackId: "b",
        queue: ["c", "b", "missing", "c"],
        mode: "shuffle",
        volume: 4,
        muted: true,
      }
    );

    expect(store.getState()).toMatchObject({
      versionId: "1",
      trackId: "b",
      queue: ["c", "b", "a"],
      mode: "shuffle",
      status: "idle",
      volume: 1,
      muted: true,
      error: null,
      hydrated: true,
      restorePending: false,
    });
    expect(store.getState().tracksByVersion["1"].map(({ id }) => id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("keeps the active session when the player UI remounts during navigation", () => {
    const store = createMusicPlayerStore();

    store.getState().bootstrap("1", [track("a", 1), track("b", 1)]);
    store.getState().selectTrack("b");
    store.getState().setStatus("playing");
    store.getState().setVolume(0.4);

    store.getState().bootstrap("2", [track("c", 2)], {
      versionId: "2",
      trackId: "c",
      volume: 1,
    });

    expect(store.getState()).toMatchObject({
      versionId: "1",
      trackId: "b",
      queue: ["a", "b"],
      status: "playing",
      volume: 0.4,
      hydrated: true,
    });
  });

  test("defers an unavailable persisted version until the full manifest loads", () => {
    const store = createMusicPlayerStore(randomSequence(0));

    store.getState().bootstrap("1", [track("a", 1)], {
      versionId: "2",
      trackId: "c",
      mode: "sequence",
      volume: 0.35,
    });

    expect(store.getState()).toMatchObject({
      versionId: "1",
      trackId: "a",
      queue: ["a"],
      volume: 0.35,
      restorePending: true,
    });

    store.getState().loadManifest({
      generatedAt: "ignored by the store",
      playlists: {
        "1": [track("a", 1)],
        "2": [track("b", 2), track("c", 2)],
      },
    } as {
      generatedAt: string;
      playlists: Record<string, MusicTrack[]>;
    });

    expect(store.getState()).toMatchObject({
      versionId: "2",
      trackId: "c",
      queue: ["b", "c"],
      status: "loading",
      restorePending: false,
    });
  });

  test("defers a persisted track omitted from the slim initial playlist", () => {
    const store = createMusicPlayerStore();

    store.getState().bootstrap("1", [track("a", 1)], {
      versionId: "1",
      trackId: "b",
      mode: "sequence",
    });

    expect(store.getState()).toMatchObject({
      versionId: "1",
      trackId: "a",
      restorePending: true,
    });

    store.getState().loadManifest({
      "1": [track("a", 1), track("b", 1)],
    });

    expect(store.getState()).toMatchObject({
      versionId: "1",
      trackId: "b",
      queue: ["a", "b"],
      restorePending: false,
    });
  });

  test("loads a playlist map and preserves an available version and track", () => {
    const store = createMusicPlayerStore();
    const sharedV1 = track("shared", 1);
    const sharedV2 = track("shared", 2);

    store.getState().bootstrap("1", [track("a", 1), sharedV1]);
    store.getState().selectTrack("shared");
    store.getState().setStatus("playing");
    store.getState().loadManifest({
      "1": [track("new", 1), sharedV1, sharedV1],
      "2": [sharedV2, track("other", 2)],
    });

    expect(store.getState()).toMatchObject({
      versionId: "1",
      trackId: "shared",
      queue: ["new", "shared"],
      status: "playing",
    });
  });

  test("selects versions, preserves a shared id, and falls back to the first track", () => {
    const store = createMusicPlayerStore(randomSequence(0, 0));
    const sharedV1 = track("shared", 1);
    const sharedV2 = track("shared", 2);

    store.getState().bootstrap("1", [track("a", 1), sharedV1]);
    store.getState().loadManifest({
      "1": [track("a", 1), sharedV1],
      "2": [track("b", 2), sharedV2, track("c", 2), track("b", 2)],
      "3": [track("d", 3)],
    });
    store.getState().selectTrack("shared");
    store.getState().setMode("shuffle");
    store.getState().selectVersion("2");

    expect(store.getState()).toMatchObject({
      versionId: "2",
      trackId: "shared",
      queue: ["shared", "c", "b"],
      status: "loading",
    });

    store.getState().selectVersion(3);
    expect(store.getState()).toMatchObject({
      versionId: "3",
      trackId: "d",
      queue: ["d"],
    });

    store.getState().selectVersion("missing");
    expect(store.getState().versionId).toBe("3");
  });

  test("rebuilds the queue on mode changes without changing the current track", () => {
    const store = createMusicPlayerStore(randomSequence(0));
    store
      .getState()
      .bootstrap("1", [track("a", 1), track("b", 1), track("c", 1)]);
    store.getState().selectTrack("b");

    store.getState().setMode("shuffle");
    expect(store.getState()).toMatchObject({
      trackId: "b",
      mode: "shuffle",
      queue: ["b", "c", "a"],
    });

    store.getState().setMode("repeat-one");
    expect(store.getState()).toMatchObject({
      trackId: "b",
      mode: "repeat-one",
      queue: ["a", "b", "c"],
    });
  });

  test("neighbor actions only return ids and leave selection to the caller", () => {
    const store = createMusicPlayerStore();
    store
      .getState()
      .bootstrap("1", [track("a", 1), track("b", 1), track("c", 1)]);
    store.getState().selectTrack("c");

    expect(store.getState().nextTrackId()).toBe("a");
    expect(store.getState().previousTrackId()).toBe("b");
    expect(store.getState().trackId).toBe("c");

    store.getState().setMode("repeat-one");
    expect(store.getState().nextTrackId()).toBe("c");
    expect(store.getState().previousTrackId()).toBe("c");
    expect(store.getState().trackId).toBe("c");
  });

  test("updates playback flags and clamps volume", () => {
    const store = createMusicPlayerStore();

    store.getState().setStatus("playing");
    store.getState().setVolume(-0.5);
    store.getState().setMuted(true);
    store.getState().setError("network");

    expect(store.getState()).toMatchObject({
      status: "playing",
      volume: 0,
      muted: true,
      error: "network",
    });

    store.getState().setVolume(Number.NaN);
    store.getState().setError(null);
    expect(store.getState().volume).toBe(0);
    expect(store.getState().error).toBeNull();
  });
  test("a remote play request is a token, so a repeat ask replays the version", () => {
    const store = createMusicPlayerStore();
    store.getState().bootstrap("1", [track("a", 1)]);

    store.getState().requestVersionPlayback(2);
    const first = store.getState().playRequest;
    expect(first).toMatchObject({ versionId: "2" });

    store.getState().requestVersionPlayback(2);
    expect(store.getState().playRequest?.versionId).toBe("2");
    expect(store.getState().playRequest?.token).toBe(first!.token + 1);

    store.getState().clearPlayRequest();
    expect(store.getState().playRequest).toBeNull();
  });

  test("a play request drops a pending restore so it cannot steal playback back", () => {
    const store = createMusicPlayerStore();
    store
      .getState()
      .bootstrap("1", [track("a", 1)], { versionId: "9", trackId: "z" });
    expect(store.getState().restorePending).toBe(true);

    store.getState().requestVersionPlayback(9);
    store
      .getState()
      .loadManifest({ "1": [track("a", 1)], "9": [track("z", 9), track("y", 9)] });

    expect(store.getState().restorePending).toBe(false);
    expect(store.getState().versionId).toBe("1");
  });

  test("an unusable version id is not turned into a request", () => {
    const store = createMusicPlayerStore();
    store.getState().bootstrap("1", [track("a", 1)]);

    store.getState().requestVersionPlayback("");
    expect(store.getState().playRequest).toBeNull();
  });
});
