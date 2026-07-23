import { describe, expect, test } from "bun:test";

import {
  getOrCreateMusicPlayerAudio,
  MUSIC_PLAYER_AUDIO_ID,
  type MusicPlayerAudioDocument,
} from "./music-player-audio";

type FakeAudio = {
  controls: boolean;
  hidden: boolean;
  id: string;
  preload: string;
  tagName: "AUDIO";
};

function asAudioElement(audio: FakeAudio) {
  return audio as unknown as HTMLAudioElement;
}

function createHarness() {
  const nodes = new Map<string, HTMLAudioElement>();
  const appended: HTMLAudioElement[] = [];
  const ownerDocument: MusicPlayerAudioDocument = {
    body: {
      appendChild(node) {
        appended.push(node);
        nodes.set(node.id, node);
        return node;
      },
    },
    getElementById(id) {
      return nodes.get(id) ?? null;
    },
  };

  return { appended, nodes, ownerDocument };
}

describe("global music player audio", () => {
  test("returns null without a browser document", () => {
    expect(getOrCreateMusicPlayerAudio(null)).toBeNull();
  });

  test("creates, configures, and appends a hidden audio element", () => {
    const { appended, ownerDocument } = createHarness();
    const audio = asAudioElement({
      controls: true,
      hidden: false,
      id: "",
      preload: "",
      tagName: "AUDIO",
    });

    expect(getOrCreateMusicPlayerAudio(ownerDocument, () => audio)).toBe(
      audio
    );
    expect(audio.id).toBe(MUSIC_PLAYER_AUDIO_ID);
    expect(audio.preload).toBe("metadata");
    expect(audio.hidden).toBe(true);
    expect(audio.controls).toBe(false);
    expect(appended).toEqual([audio]);
  });

  test("reuses the document-level element across repeated calls", () => {
    const { appended, ownerDocument } = createHarness();
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      return asAudioElement({
        controls: true,
        hidden: false,
        id: "",
        preload: "",
        tagName: "AUDIO",
      });
    };

    const first = getOrCreateMusicPlayerAudio(ownerDocument, factory);
    const second = getOrCreateMusicPlayerAudio(ownerDocument, factory);

    expect(second).toBe(first);
    expect(factoryCalls).toBe(1);
    expect(appended).toHaveLength(1);
  });

  test("reuses and reattaches the same element after it is detached", () => {
    const { appended, nodes, ownerDocument } = createHarness();
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      return asAudioElement({
        controls: true,
        hidden: false,
        id: "",
        preload: "",
        tagName: "AUDIO",
      });
    };

    const first = getOrCreateMusicPlayerAudio(ownerDocument, factory);
    nodes.delete(MUSIC_PLAYER_AUDIO_ID);
    const reattached = getOrCreateMusicPlayerAudio(ownerDocument, factory);

    expect(reattached).toBe(first);
    expect(factoryCalls).toBe(1);
    expect(appended).toEqual([first, first]);
  });

  test("normalizes an existing audio element before returning it", () => {
    const { nodes, ownerDocument } = createHarness();
    const existing = asAudioElement({
      controls: true,
      hidden: false,
      id: MUSIC_PLAYER_AUDIO_ID,
      preload: "none",
      tagName: "AUDIO",
    });
    nodes.set(MUSIC_PLAYER_AUDIO_ID, existing);

    expect(
      getOrCreateMusicPlayerAudio(ownerDocument, () => {
        throw new Error("factory should not run");
      })
    ).toBe(existing);
    expect(existing.preload).toBe("metadata");
    expect(existing.hidden).toBe(true);
    expect(existing.controls).toBe(false);
  });
});
