"use client";

import * as React from "react";
import { animate, motionValue, useMotionValue, useTransform } from "framer-motion";

import { EASE_OUT, motion, useReducedMotion } from "@/components/motion";
import { CompatibleImage } from "@/components/site/compatible-image";
import { SyncedVideoAudio } from "@/components/site/synced-video-audio";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatEntryTitle, type CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";

type ChartMediaPlayerProps = {
  entry: CatalogEntry;
  locale: Locale;
};

// Sources are remote (the chart-media R2 host); we preconnect to that host in the root
// layout. The PV ships without an audio track and the song lives in a separate
// track.mp3 of identical length, so when both exist we render a single player
// (<SyncedVideoAudio>) that slaves the audio to the video — playing the video
// plays the song in sync. The PV-only fallback stays a plain native element;
// the audio-only branch adds an audio-reactive cover glow + mini EQ (client-only
// portal content, so hooks here never hit the static prerender).
export function ChartMediaPlayer({ entry, locale }: ChartMediaPlayerProps) {
  const hasPv = entry.assets.has_pv && Boolean(entry.media.pv_url);
  const hasAudio = entry.assets.has_audio && Boolean(entry.media.audio_url);

  if (!hasPv && !hasAudio) {
    return null;
  }

  const detail = getDictionary(locale).detail;
  const title = formatEntryTitle(entry, locale);
  // The video `poster` attribute cannot express an AVIF -> WebP -> PNG fallback
  // chain like <picture>, so use the original cover URL for broad compatibility.
  const poster = entry.media.cover_url || undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{detail.preview}</CardTitle>
        <CardDescription>{detail.previewDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {hasPv && hasAudio ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.pvLabel}</h3>
            <SyncedVideoAudio
              videoSrc={entry.media.pv_url}
              audioSrc={entry.media.audio_url}
              poster={poster}
              ariaLabel={`${title} ${detail.pvLabel}`}
              unsupportedLabel={detail.mediaUnsupported}
              volumeLabel={detail.volumeLabel}
              muteLabel={detail.muteLabel}
              className="aspect-video w-full rounded-xl border border-border/60 bg-black [color-scheme:dark]"
            />
          </div>
        ) : hasPv ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.pvLabel}</h3>
            <video
              controls
              playsInline
              preload="metadata"
              poster={poster}
              src={entry.media.pv_url}
              aria-label={`${title} ${detail.pvLabel}`}
              className="aspect-video w-full rounded-xl border border-border/60 bg-black [color-scheme:dark]"
            >
              {detail.mediaUnsupported}
            </video>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.audioLabel}</h3>
            <ReactiveAudioPlayer
              src={entry.media.audio_url}
              coverUrl={poster}
              ariaLabel={`${title} ${detail.audioLabel}`}
              unsupportedLabel={detail.mediaUnsupported}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Audio-reactive player --------------------------------------------------
//
// While the song plays, an AnalyserNode feeds two visuals through motion values
// (no per-frame React state): a primary-tinted glow behind the cover breathing
// with low-band energy, and a small EQ strip beside the native controls.

const BAR_REST = 0.15;
// fftSize 256 -> 128 usable bins; roughly log-spaced [start, end) bin ranges.
const EQ_BANDS: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [4, 8],
  [8, 16],
  [16, 32],
  [32, 64],
  [64, 112],
];
const LOW_BAND_BINS = 8;

function ReactiveAudioPlayer({
  src,
  coverUrl,
  ariaLabel,
  unsupportedLabel,
}: {
  src: string;
  coverUrl?: string;
  ariaLabel: string;
  unsupportedLabel: string;
}) {
  const reduced = useReducedMotion();
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const dataRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = React.useRef(0);
  // Set once wiring fails (no CORS, no Web Audio, source error) — playback then
  // stays plain forever; we never retry a path that could silence the element.
  const deadRef = React.useRef(false);
  const setupPendingRef = React.useRef(false);

  // Wiring a MediaElementAudioSourceNode on a non-CORS element silences
  // playback, so the element starts in CORS mode. If the CORS media fetch
  // itself fails, onError drops back to a plain request (and kills the
  // visualizer) so the song still plays.
  const [corsMode, setCorsMode] = React.useState<"anonymous" | undefined>("anonymous");
  const [analyserReady, setAnalyserReady] = React.useState(false);

  // Low-band energy (0..1) drives both glow channels; the bars each own a value.
  const glow = useMotionValue(0);
  const glowOpacity = useTransform(glow, [0, 1], [0, 0.85]);
  const glowScale = useTransform(glow, [0, 1], [0.92, 1.1]);
  const [bars] = React.useState(() => EQ_BANDS.map(() => motionValue(BAR_REST)));

  const stopLoop = React.useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const settle = React.useCallback(() => {
    animate(glow, 0, { duration: 0.5, ease: EASE_OUT });
    for (const bar of bars) {
      animate(bar, BAR_REST, { duration: 0.4, ease: EASE_OUT });
    }
  }, [glow, bars]);

  const startLoop = React.useCallback(() => {
    const analyser = analyserRef.current;
    if (rafRef.current || !analyser) {
      return;
    }
    if (!dataRef.current || dataRef.current.length !== analyser.frequencyBinCount) {
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    }
    const data = dataRef.current;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || document.hidden) {
        rafRef.current = 0;
        settle();
        return;
      }
      analyser.getByteFrequencyData(data);
      let low = 0;
      for (let i = 0; i < LOW_BAND_BINS; i++) {
        low += data[i];
      }
      glow.set(low / (LOW_BAND_BINS * 255));
      for (let b = 0; b < EQ_BANDS.length; b++) {
        const [start, end] = EQ_BANDS[b];
        let sum = 0;
        for (let i = start; i < end; i++) {
          sum += data[i];
        }
        bars[b].set(BAR_REST + (sum / ((end - start) * 255)) * (1 - BAR_REST));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [glow, bars, settle]);

  const handlePlay = React.useCallback(async () => {
    if (reduced || deadRef.current || setupPendingRef.current) {
      return;
    }
    if (analyserRef.current) {
      // Lazily created contexts start suspended until a gesture; play is one.
      void audioCtxRef.current?.resume().catch(() => {});
      startLoop();
      return;
    }
    setupPendingRef.current = true;
    let ctx: AudioContext | null = null;
    try {
      const audio = audioRef.current;
      if (!audio || audio.crossOrigin !== "anonymous") {
        deadRef.current = true;
        return;
      }
      // Created inside the play gesture (before any await) so the autoplay
      // policy lets it run; wiring the element in happens only after the CORS
      // check below.
      ctx = new AudioContext();
      // Double-check CORS before wiring: a MediaElementAudioSourceNode on a
      // non-CORS element mutes the song entirely, which is far worse than
      // skipping the visualizer.
      const head = await fetch(src, { method: "HEAD", mode: "cors" });
      if (!head.ok) {
        deadRef.current = true;
        return;
      }
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      void ctx.resume().catch(() => {});
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      setAnalyserReady(true);
      if (!audio.paused) {
        startLoop();
      }
    } catch {
      deadRef.current = true;
    } finally {
      if (deadRef.current) {
        void ctx?.close().catch(() => {});
      }
      setupPendingRef.current = false;
    }
  }, [reduced, src, startLoop]);

  const handleStop = React.useCallback(() => {
    stopLoop();
    settle();
  }, [stopLoop, settle]);

  const handleError = React.useCallback(() => {
    const audio = audioRef.current;
    // Most likely the CORS-mode media fetch was rejected; retry the same URL as
    // a plain request so playback survives, giving up the visualizer.
    if (audio && audio.crossOrigin === "anonymous" && !analyserRef.current) {
      deadRef.current = true;
      setCorsMode(undefined);
    }
  }, []);

  const corsModeInitialized = React.useRef(false);
  React.useEffect(() => {
    if (!corsModeInitialized.current) {
      corsModeInitialized.current = true;
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      // Reload without crossOrigin, then resume — the user's play gesture is
      // usually still fresh enough for the autoplay policy.
      audio.load();
      void audio.play().catch(() => {});
    }
  }, [corsMode]);

  React.useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopLoop();
        return;
      }
      const audio = audioRef.current;
      if (audio && !audio.paused && analyserRef.current) {
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopLoop, startLoop]);

  React.useEffect(
    () => () => {
      stopLoop();
      void audioCtxRef.current?.close().catch(() => {});
    },
    [stopLoop]
  );

  const showVisuals = !reduced;

  return (
    <div className="flex flex-col gap-3">
      {coverUrl ? (
        <div className="relative mx-auto w-44 max-w-full">
          {showVisuals ? (
            // Constant blur; only opacity/scale animate (GPU-safe).
            <motion.div
              aria-hidden="true"
              className="absolute inset-1 rounded-2xl bg-primary/50 blur-xl"
              style={{ opacity: glowOpacity, scale: glowScale }}
            />
          ) : null}
          {/* Remote original only (same broad-compatibility rationale as the
              video poster); fabricating .avif/.webp URLs here could 404 and
              <picture> does not fall back from a matched-but-failed source. */}
          <CompatibleImage
            sources={{ png: coverUrl }}
            alt=""
            loading="lazy"
            pictureClassName="relative block"
            className="aspect-square w-full rounded-xl border border-border/60 object-cover"
          />
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <audio
          ref={audioRef}
          controls
          preload="none"
          crossOrigin={corsMode}
          src={src}
          aria-label={ariaLabel}
          onPlay={() => void handlePlay()}
          onPause={handleStop}
          onEnded={handleStop}
          onError={handleError}
          className="min-w-0 flex-1 rounded-full dark:[color-scheme:dark]"
        >
          {unsupportedLabel}
        </audio>
        {showVisuals && analyserReady ? (
          <div className="flex h-6 shrink-0 items-end gap-[3px]" aria-hidden="true">
            {bars.map((bar, index) => (
              <motion.div
                key={index}
                className="h-full w-1 origin-bottom rounded-full bg-primary/80"
                style={{ scaleY: bar }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
