"use client";

import * as React from "react";
import { MonitorIcon, MoonStarIcon, SunMediumIcon } from "lucide-react";
import { useReducedMotion } from "framer-motion";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/site/theme-provider";

type ThemeToggleLabels = {
  toggleLabel: string;
  light: string;
  dark: string;
  system: string;
};

type ThemeSetting = "light" | "dark" | "system";

// startViewTransition is not in every TS DOM lib / browser yet — feature-detect.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

export function ThemeToggle({ labels }: { labels: ThemeToggleLabels }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const handleThemeChange = (value: ThemeSetting) => {
    const doc = document as DocumentWithViewTransition;
    const nextResolved =
      value === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : value;
    // Wipe only when the palette actually flips; otherwise (and on unsupported
    // browsers / reduced motion) fall back to a plain theme change.
    if (!doc.startViewTransition || prefersReducedMotion || nextResolved === resolvedTheme) {
      setTheme(value);
      return;
    }
    const root = document.documentElement;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      root.style.setProperty("--theme-wipe-x", `${rect.left + rect.width / 2}px`);
      root.style.setProperty("--theme-wipe-y", `${rect.top + rect.height / 2}px`);
    }
    // globals.css swaps the page transition for a radial wipe while this
    // attribute is present.
    root.dataset.themeWipe = "";
    const transition = doc.startViewTransition(() => {
      // Flip the class synchronously so the "new" snapshot already carries the
      // next palette; ThemeProvider's effect re-applies the same class later.
      root.classList.toggle("dark", nextResolved === "dark");
      setTheme(value);
    });
    const cleanup = () => {
      delete root.dataset.themeWipe;
      root.style.removeProperty("--theme-wipe-x");
      root.style.removeProperty("--theme-wipe-y");
    };
    transition.finished.then(cleanup, cleanup);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size="icon-sm"
          type="button"
          aria-label={labels.toggleLabel}
          title={labels.toggleLabel}
          className="overflow-hidden"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isDark ? "dark" : "light"}
              initial={{ y: 12, opacity: 0, rotate: -30 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: -12, opacity: 0, rotate: 30 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="inline-flex"
            >
              {isDark ? <SunMediumIcon /> : <MoonStarIcon />}
            </motion.span>
          </AnimatePresence>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => handleThemeChange(value as ThemeSetting)}
        >
          <DropdownMenuRadioItem value="light">
            <SunMediumIcon />
            {labels.light}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonStarIcon />
            {labels.dark}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon />
            {labels.system}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
