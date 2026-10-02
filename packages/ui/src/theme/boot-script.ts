import { MOTION_MODES, MOTION_STORAGE_KEY } from "../motion/constants";
import { ACCENT_COLORS, ACCENT_STORAGE_KEY, THEME_STORAGE_KEY } from "./constants";

/**
 * The no-flash boot script. Inline it so it runs during HTML parse, before the
 * first paint: it puts the stored color mode, accent and motion settings on
 * <html> (the `dark` class, an inline `color-scheme`, `data-accent`,
 * `data-motion`, `data-reduced-motion`) exactly as ThemeProvider and
 * MotionProvider will after hydration, using the same storage keys and presets
 * (and the same mapping of the legacy "1"/"0" motion values).
 *
 * An explicit light/dark mode wins; otherwise the color mode follows the OS.
 * The inline colorScheme tells the browser the right canvas color while the
 * render-blocking stylesheet is still loading (the CSS `color-scheme` only
 * kicks in afterwards) — without it a dark-mode reload flashes white.
 *
 * Apps may append their own statements after it (web adds its music-player
 * attribute). The result contains no user input and no "<", so it is safe to
 * inline.
 */
export function themeBootScript(): string {
  const themeKey = JSON.stringify(THEME_STORAGE_KEY);
  const accentKey = JSON.stringify(ACCENT_STORAGE_KEY);
  const accents = JSON.stringify(ACCENT_COLORS);
  const motionKey = JSON.stringify(MOTION_STORAGE_KEY);
  const motionModes = JSON.stringify(MOTION_MODES);
  return [
    "(function(){var e=document.documentElement;",
    `try{var t=localStorage.getItem(${themeKey});var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='light'?false:(t==='dark'?true:m);e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(x){e.classList.add('dark');e.style.colorScheme='dark';}`,
    `try{var a=localStorage.getItem(${accentKey});var c=${accents};e.dataset.accent=c.indexOf(a)>=0?a:'blue';}catch(x){e.dataset.accent='blue';}`,
    `try{var p=localStorage.getItem(${motionKey});p=p==='1'?'off':(p==='0'?'system':p);p=${motionModes}.indexOf(p)>=0?p:'system';e.dataset.motion=p;e.toggleAttribute('data-reduced-motion',p==='off');}catch(x){e.dataset.motion='system';}`,
    "})();",
  ].join("");
}
