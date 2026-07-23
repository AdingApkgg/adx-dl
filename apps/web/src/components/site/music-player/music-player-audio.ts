export const MUSIC_PLAYER_AUDIO_ID = "astrodx-global-music-player-audio";

export type MusicPlayerAudioDocument = {
  body: {
    appendChild(node: HTMLAudioElement): unknown;
  } | null;
  createElement?: (tagName: "audio") => HTMLAudioElement;
  getElementById(id: string): unknown;
};

export type MusicPlayerAudioFactory = (
  ownerDocument: MusicPlayerAudioDocument
) => HTMLAudioElement;

const AUDIO_INSTANCE_KEY = Symbol.for(
  "astrodx.music-player.document-audio-instance"
);
const audioByDocument = new WeakMap<
  MusicPlayerAudioDocument,
  HTMLAudioElement
>();

function browserDocument(): MusicPlayerAudioDocument | null {
  return typeof document === "undefined" ? null : document;
}

function isAudioElement(value: unknown): value is HTMLAudioElement {
  if (typeof value !== "object" || value === null || !("tagName" in value)) {
    return false;
  }

  return String(value.tagName).toLowerCase() === "audio";
}

function configureAudioElement(audio: HTMLAudioElement) {
  audio.id = MUSIC_PLAYER_AUDIO_ID;
  audio.preload = "metadata";
  audio.hidden = true;
  audio.controls = false;
  return audio;
}

function rememberAudioElement(
  ownerDocument: MusicPlayerAudioDocument,
  audio: HTMLAudioElement
) {
  audioByDocument.set(ownerDocument, audio);
  Reflect.set(ownerDocument, AUDIO_INSTANCE_KEY, audio);
}

function rememberedAudioElement(
  ownerDocument: MusicPlayerAudioDocument
): HTMLAudioElement | null {
  const moduleCached = audioByDocument.get(ownerDocument);
  if (isAudioElement(moduleCached)) {
    return moduleCached;
  }

  const documentCached = Reflect.get(ownerDocument, AUDIO_INSTANCE_KEY);
  if (isAudioElement(documentCached)) {
    audioByDocument.set(ownerDocument, documentCached);
    return documentCached;
  }

  const attached = ownerDocument.getElementById(MUSIC_PLAYER_AUDIO_ID);
  if (isAudioElement(attached)) {
    rememberAudioElement(ownerDocument, attached);
    return attached;
  }

  return null;
}

export function getOrCreateMusicPlayerAudio(
  ownerDocument: MusicPlayerAudioDocument | null = browserDocument(),
  createAudio?: MusicPlayerAudioFactory
): HTMLAudioElement | null {
  if (!ownerDocument?.body) {
    return null;
  }

  const existing = rememberedAudioElement(ownerDocument);
  if (existing) {
    const configured = configureAudioElement(existing);
    if (ownerDocument.getElementById(MUSIC_PLAYER_AUDIO_ID) !== configured) {
      ownerDocument.body.appendChild(configured);
    }
    return configured;
  }

  const audio =
    createAudio?.(ownerDocument) ?? ownerDocument.createElement?.("audio");
  if (!audio) {
    return null;
  }

  configureAudioElement(audio);
  ownerDocument.body.appendChild(audio);
  rememberAudioElement(ownerDocument, audio);
  return audio;
}
