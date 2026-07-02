"use client";

import * as React from "react";
import { Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react";

type SyncedVideoAudioProps = {
  /** Silent PV (pv.mp4); ships without an audio track. */
  videoSrc: string;
  /** The song (track.mp3); same length as the PV, offset 0. */
  audioSrc: string;
  poster?: string;
  ariaLabel: string;
  unsupportedLabel: string;
  volumeLabel: string;
  muteLabel: string;
  className?: string;
};

// The remote PV carries no audio track, while the song lives in a separate
// track.mp3 of identical length (offset 0). Muxing them into one file at build
// time would mean hosting ~18 GB of combined video on a static GitHub Pages site,
// so we keep both remote and slave a hidden <audio> to the visible <video>:
// every play / pause / seek / rate on the video is mirrored onto the audio, and
// the audio is nudged back whenever it drifts. Net effect is the requested one —
// pressing play on the video plays the song in sync.
//
// Because the video has no audio track, the browser's native controls omit the
// volume slider entirely, so there is nothing to map the audio's volume onto. We
// render our own mute + volume control underneath and drive the <audio> directly.
export function SyncedVideoAudio({
  videoSrc,
  audioSrc,
  poster,
  ariaLabel,
  unsupportedLabel,
  volumeLabel,
  muteLabel,
  className,
}: SyncedVideoAudioProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);

  // Playback sync: the video is the clock the audio follows.
  React.useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) {
      return;
    }

    // Past this gap (seconds) we hard-resync the audio to the video clock.
    const DRIFT_TOLERANCE = 0.3;

    const matchClock = () => {
      if (Math.abs(audio.currentTime - video.currentTime) > DRIFT_TOLERANCE) {
        audio.currentTime = video.currentTime;
      }
    };

    // The song only starts downloading on first play (preload="none" below):
    // loading it eagerly would double-download the same mp3 alongside the
    // chart-preview player on the page.
    const ensureAudioLoading = () => {
      if (audio.preload === "none") {
        audio.preload = "auto";
        audio.load();
      }
    };

    const startAudio = () => {
      ensureAudioLoading();
      audio.currentTime = video.currentTime;
      audio.playbackRate = video.playbackRate;
      // play() rejects if the gesture is lost; the video is still usable, just muted.
      void audio.play().catch(() => {});
    };

    const onPlay = () => startAudio();
    const onPause = () => audio.pause();
    const onSeek = () => {
      audio.currentTime = video.currentTime;
    };
    const onRateChange = () => {
      audio.playbackRate = video.playbackRate;
    };
    const onEnded = () => audio.pause();
    const onTimeUpdate = () => {
      if (!video.paused) {
        matchClock();
      }
    };
    // Hold the audio while the video stalls to buffer, then realign on resume.
    const onWaiting = () => audio.pause();
    const onPlaying = () => {
      if (!video.paused) {
        startAudio();
      }
    };

    audio.playbackRate = video.playbackRate;

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeek);
    video.addEventListener("seeked", onSeek);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeking", onSeek);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      audio.pause();
    };
  }, []);

  // Volume + mute live in React state and are applied to the audio element.
  React.useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [volume, muted]);

  const effectiveVolume = muted ? 0 : volume;
  const VolumeIcon =
    effectiveVolume === 0 ? VolumeXIcon : effectiveVolume < 0.5 ? Volume1Icon : Volume2Icon;

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={poster}
        src={videoSrc}
        aria-label={ariaLabel}
        className={className}
      >
        {unsupportedLabel}
      </video>
      <audio ref={audioRef} src={audioSrc} preload="none" aria-hidden="true" tabIndex={-1} className="sr-only" />
      <div className="flex items-center gap-3 self-start rounded-full border border-border/60 bg-muted/40 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muteLabel}
          aria-pressed={muted}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <VolumeIcon className="size-4" aria-hidden="true" />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={effectiveVolume}
          onChange={(event) => {
            setVolume(Number(event.target.value));
            setMuted(false);
          }}
          aria-label={volumeLabel}
          className="h-1 w-32 cursor-pointer accent-foreground"
        />
      </div>
    </div>
  );
}
