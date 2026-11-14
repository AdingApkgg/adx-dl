"use client";

import * as React from "react";
import { MotionConfig, useInView } from "framer-motion";
import { MOTION_STORAGE_KEY, type MotionMode } from "./constants";
import { motionConfigPreference, parseMotionMode, resolveReducedMotion } from "./policy";

type MotionPreference = {
  forceReducedMotion: boolean;
  ready: boolean;
  mode: MotionMode;
  setMode: (mode: MotionMode) => void;
  /** Compatibility handle for the former binary header toggle. */
  userReduced: boolean;
  setUserReduced: (value: boolean) => void;
};

const MotionPreferenceContext = React.createContext<MotionPreference>({
  forceReducedMotion: false,
  // Standalone primitives work without a provider; mounted providers gate readiness.
  ready: true,
  mode: "system",
  setMode: () => {},
  userReduced: false,
  setUserReduced: () => {},
});

/** The header toggle's read/write handle for the site-level preference. */
export function useMotionPreference(): MotionPreference {
  return React.useContext(MotionPreferenceContext);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToOsMotion(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getOsMotionSnapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

const getServerMotionSnapshot = () => false;

/**
 * Site-wide reduced-motion signal, with an explicit site choice overriding OS.
 * Import this instead of framer-motion's own `useReducedMotion` so hand-gated
 * animations (parallax, marquees, springs) also honor the site toggle.
 * The server snapshot is reused during hydration, then React reads the OS
 * setting and subscribes to changes. Conditional decorations must render the
 * same initial tree on the server and client, even when the OS reduces motion.
 */
export function useReducedMotion(): boolean {
  const os = useOsReducedMotion();
  const { mode, forceReducedMotion } = React.useContext(MotionPreferenceContext);
  return resolveReducedMotion(mode, os, forceReducedMotion);
}

/** Owns the persisted preference and effective CSS/Motion reduction policy. */
export function MotionProvider({ children, forceReducedMotion = false }: {
  children: React.ReactNode;
  /** Temporary compatibility override; does not change the saved motion mode. */
  forceReducedMotion?: boolean;
}) {
  const [mode, setModeState] = React.useState<MotionMode>("system");
  const [preferenceReady, setPreferenceReady] = React.useState(false);
  const osReduced = useOsReducedMotion();
  const reduced = resolveReducedMotion(mode, osReduced, forceReducedMotion);

  React.useEffect(() => {
    try {
      // One-time localStorage sync after hydration.
      setModeState(
        parseMotionMode(window.localStorage.getItem(MOTION_STORAGE_KEY))
      );
    } catch {
      // Storage unavailable (private mode) — follow the OS.
    } finally {
      setPreferenceReady(true);
    }
  }, []);

  React.useEffect(() => {
    if (!preferenceReady) {
      return;
    }
    document.documentElement.dataset.motion = mode;
    document.documentElement.toggleAttribute("data-reduced-motion", reduced);
  }, [mode, preferenceReady, reduced]);

  const setMode = React.useCallback((value: MotionMode) => {
    const normalized = parseMotionMode(value);
    setModeState(normalized);
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, normalized);
    } catch {
      // Storage unavailable — the preference still works for this session.
    }
  }, []);
  const setUserReduced = React.useCallback(
    (value: boolean) => setMode(value ? "off" : "system"),
    [setMode]
  );

  const preference = React.useMemo(
    () => ({
      forceReducedMotion,
      ready: preferenceReady,
      mode,
      setMode,
      userReduced: mode === "off",
      setUserReduced,
    }),
    [mode, setMode, setUserReduced, forceReducedMotion, preferenceReady]
  );

  return (
    <MotionPreferenceContext.Provider value={preference}>
      <MotionConfig reducedMotion={motionConfigPreference(reduced ? "off" : "on")}>
        {children}
      </MotionConfig>
    </MotionPreferenceContext.Provider>
  );
}


function useOsReducedMotion() {
  return React.useSyncExternalStore(subscribeToOsMotion, getOsMotionSnapshot, getServerMotionSnapshot);
}

export function useMotionReady(): boolean {
  return React.useContext(MotionPreferenceContext).ready;
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const getVisibility = () => document.visibilityState !== "hidden";
const getServerVisibility = () => false;

/** Gate continuous decorations; explicit 'on' never overrides resource limits. */
export function useMotionActivity(ref: React.RefObject<Element | null>): boolean {
  const visible = useInView(ref);
  const foreground = React.useSyncExternalStore(subscribeToVisibility, getVisibility, getServerVisibility);
  const reduced = useReducedMotion();
  return useMotionReady() && !reduced && visible && foreground;
}
