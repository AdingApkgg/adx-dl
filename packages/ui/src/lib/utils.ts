import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Grows a 32px control's hit area to the ~44px touch minimum without touching
 * its visual box: a transparent ::after overlay, so nothing shifts and the icon
 * strip keeps its density. Callers must leave at least `gap-3` between
 * neighbours, otherwise the expanded areas overlap and steal each other's taps.
 */
export const TAP_TARGET_44 = "relative after:absolute after:-inset-1.5 after:content-['']"
