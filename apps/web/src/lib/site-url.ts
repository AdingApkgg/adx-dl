const defaultSiteUrl = "https://adxdls.saop.cc";

export function resolveSiteUrl(rawSiteUrl?: string | null): string {
  const trimmedSiteUrl = rawSiteUrl?.trim();

  if (!trimmedSiteUrl) {
    return defaultSiteUrl;
  }

  return trimmedSiteUrl;
}
