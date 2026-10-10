export type DownloadPlatform = "ios" | "android" | "desktop";

/** iPadOS can request desktop pages and identify itself as a Mac. */
export function detectDownloadPlatform(
  device: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">
): DownloadPlatform {
  if (/Android/i.test(device.userAgent)) {
    return "android";
  }
  if (/iPad|iPhone|iPod/i.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1)) {
    return "ios";
  }
  return "desktop";
}
