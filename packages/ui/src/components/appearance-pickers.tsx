"use client";

import { MonitorIcon, MoonStarIcon, SparklesIcon, SunMediumIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";
import { MOTION_MODES, type MotionMode, useMotionPreference } from "../motion";
import { ACCENT_COLORS, type AccentColor, type ThemePreference } from "../theme/constants";
import { useTheme } from "../theme/theme-provider";

/**
 * One option of a settings choice group: a bordered button that takes the
 * accent tint while active. Exported so an app's own settings (web's download
 * and music options) look like these pickers.
 */
export function choiceClass(active: boolean): string {
  return cn(
    "flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0",
    active
      ? "border-primary/50 bg-primary/10 text-foreground ring-1 ring-primary/15"
      : "border-border bg-card/40 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
  );
}

const THEME_OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];

const themeIcons: Record<ThemePreference, React.ReactNode> = {
  system: <MonitorIcon aria-hidden="true" />,
  light: <SunMediumIcon aria-hidden="true" />,
  dark: <MoonStarIcon aria-hidden="true" />,
};

export type ThemePickerLabels = Record<ThemePreference, string>;

/** Follow the system / light / dark, read from and saved to ThemeProvider. */
export function ThemePicker({ labels }: { labels: ThemePickerLabels }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-2">
      {THEME_OPTIONS.map((option) => {
        const active = theme === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(option)}
            className={choiceClass(active)}
          >
            {themeIcons[option]}
            <span>{labels[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

const accentSwatches: Record<AccentColor, string> = {
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
};

export type AccentPickerLabels = Record<AccentColor, string>;

/** The accent presets, each with a color swatch, read from and saved to ThemeProvider. */
export function AccentPicker({ labels }: { labels: AccentPickerLabels }) {
  const { accent, setAccent } = useTheme();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {ACCENT_COLORS.map((color) => {
        const active = accent === color;
        return (
          <button
            key={color}
            type="button"
            aria-pressed={active}
            onClick={() => setAccent(color)}
            className={cn(choiceClass(active), "justify-start sm:flex-col sm:justify-center")}
          >
            <span
              aria-hidden="true"
              className={cn("size-4 shrink-0 rounded-full ring-1 ring-black/10", accentSwatches[color])}
            />
            <span>{labels[color]}</span>
          </button>
        );
      })}
    </div>
  );
}

const motionIcons: Record<MotionMode, React.ReactNode> = {
  system: <MonitorIcon aria-hidden="true" />,
  on: <SparklesIcon aria-hidden="true" />,
  off: <SparklesIcon aria-hidden="true" className="opacity-50" />,
};

export type MotionPickerLabels = {
  /** The name of each mode. */
  modes: Record<MotionMode, string>;
  /** The line under each name. */
  hints: Record<MotionMode, string>;
};

/** Follow the system / always animate / reduce motion, read from and saved to MotionProvider. */
export function MotionPicker({ labels }: { labels: MotionPickerLabels }) {
  const { mode, setMode } = useMotionPreference();
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {MOTION_MODES.map((option) => {
        const active = mode === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setMode(option)}
            className={cn(choiceClass(active), "h-auto items-start py-2.5 text-left")}
          >
            <span className="mt-0.5">{motionIcons[option]}</span>
            <span className="min-w-0">
              <span className="block font-medium">{labels.modes[option]}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{labels.hints[option]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
