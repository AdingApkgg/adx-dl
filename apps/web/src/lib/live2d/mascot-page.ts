import { stripLocalePrefix } from "@/lib/i18n";

/** The dedicated mascot page, in every locale tree (/live2d, /en/live2d, /ja/live2d). */
export const MASCOT_PAGE_PATH = "/live2d";

export function isMascotPagePath(pathname: string): boolean {
  return stripLocalePrefix(pathname) === MASCOT_PAGE_PATH;
}

export type MascotPlacement = "dock" | "stage";

/**
 * Where the one mascot instance lives. On the mascot page she always takes the
 * stage — that page is the way in for everyone the corner leaves out (phones,
 * touch screens, simple compatibility mode, or a dismissed corner). Elsewhere
 * she sits in the corner only when the corner is allowed; null = not mounted.
 */
export function mascotPlacement({
  onMascotPage,
  cornerAllowed,
}: {
  onMascotPage: boolean;
  cornerAllowed: boolean;
}): MascotPlacement | null {
  if (onMascotPage) return "stage";
  return cornerAllowed ? "dock" : null;
}
