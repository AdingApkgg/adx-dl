import { describe, expect, test } from "bun:test";

import {
  clampPlaybackTime,
  formatPlaybackTime,
  musicTrackArtist,
  musicTrackTitle,
} from "./music-player-utils";

const track = {
  id: "1-test",
  slug: "1",
  title: "原题",
  titleEn: "English title",
  artist: "原作者",
  artistEn: "English artist",
  versionId: 1,
  versionName: "maimai PLUS",
  coverUrl: "https://example.test/bg.png",
  audioUrl: "https://example.test/track.mp3",
};

describe("music player formatting", () => {
  test("uses English metadata only for the English locale", () => {
    expect(musicTrackTitle(track, "en")).toBe("English title");
    expect(musicTrackArtist(track, "en")).toBe("English artist");
    expect(musicTrackTitle(track, "zh")).toBe("原题");
    expect(musicTrackArtist(track, "ja")).toBe("原作者");
  });

  test("formats and clamps playback positions", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(65.9)).toBe("1:05");
    expect(formatPlaybackTime(Number.NaN)).toBe("0:00");
    expect(clampPlaybackTime(-5, 100)).toBe(0);
    expect(clampPlaybackTime(120, 100)).toBe(100);
  });
});
