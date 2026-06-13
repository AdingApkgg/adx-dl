"use client";

import * as React from "react";
import { MoonStarIcon, SunMediumIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/site/theme-provider";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  return (
    <Button
      variant="outline"
      size="icon-sm"
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <SunMediumIcon /> : <MoonStarIcon />}
    </Button>
  );
}
