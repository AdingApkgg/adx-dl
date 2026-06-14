"use client";

import * as React from "react";

type SyncedVideoAudioProps = {
  /** Silent PV (pv.mp4); ships without an audio track. */
  videoSrc: string;
  /** The song (track.mp3); same length as the PV, offset 0. */
  audioSrc: string;
  poster?: string;
  ariaLabel: string;
  unsupportedLabel: string;
  className?: string;
};

// The remote PV carries no audio track, while the song lives in a separate
// track.mp3 of identical length (offset 0). Muxing them into one file at build
// time would mean hosting ~18 GB of combined video on a static GitHub Pages site,
// so we keep both remote and slave a hidden <audio> to the visible <video>:
// every play / pause / seek / rate / volume on the video is mirrored onto the
// audio, and the audio is nudged back whenever it drifts. Net effect is the
// requested one — pressing play on the video plays the song in sync.
export function SyncedVideoAudio({
  videoSrc,
  audioSrc,
  poster,
  ariaLabel,
  unsupportedLabel,
  className,
}: SyncedVideoAudioProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const audioRef = React.useRef<HTMLAudioElement>(null);

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

    const startAudio = () => {
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
    // The PV is silent, so the video's own volume UI is wired to the song instead.
    const onVolumeChange = () => {
      audio.volume = video.volume;
      audio.muted = video.muted;
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

    audio.volume = video.volume;
    audio.muted = video.muted;
    audio.playbackRate = video.playbackRate;

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeek);
    video.addEventListener("seeked", onSeek);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("volumechange", onVolumeChange);
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
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      audio.pause();
    };
  }, []);

  return (
    <>
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
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      />
    </>
  );
}
