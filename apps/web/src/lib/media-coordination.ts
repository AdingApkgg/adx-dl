export const MEDIA_PLAY_EVENT = "astrodx:media-play";

export type MediaOwner = "global-music" | "chart-preview";

/**
 * Announces that one of the site's media surfaces has started audible playback.
 * Consumers use this as a lightweight audio-focus protocol and pause themselves
 * when another owner takes focus.
 */
export function announceMediaPlay(owner: MediaOwner): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MediaOwner>(MEDIA_PLAY_EVENT, {
      detail: owner,
    }),
  );
}
