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

export const MEDIA_ACTIVITY_EVENT = "astrodx:media-activity";

const activeOwners = new Set<MediaOwner>();

/**
 * Records whether a media surface is actively playing — start AND stop, unlike
 * the one-shot announceMediaPlay above, which only marks a moment of audio
 * focus. Consumers that should stand down for the whole playback (the Live2D
 * mascot pausing its WebGL loop while the chart preview renders) read the
 * current state with isMediaActive and follow changes with
 * subscribeMediaActivity, so one that mounts mid-playback still knows.
 * Fires only on an actual change.
 */
export function setMediaActive(owner: MediaOwner, active: boolean): void {
  if (activeOwners.has(owner) === active) {
    return;
  }
  if (active) {
    activeOwners.add(owner);
  } else {
    activeOwners.delete(owner);
  }
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(MEDIA_ACTIVITY_EVENT));
}

export function isMediaActive(owner: MediaOwner): boolean {
  return activeOwners.has(owner);
}

export function subscribeMediaActivity(onChange: () => void): () => void {
  window.addEventListener(MEDIA_ACTIVITY_EVENT, onChange);
  return () => window.removeEventListener(MEDIA_ACTIVITY_EVENT, onChange);
}
