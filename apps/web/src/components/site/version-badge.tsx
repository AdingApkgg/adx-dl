import { Badge } from "@/components/ui/badge";
import { CompatibleImage } from "@/components/site/compatible-image";
import { cn } from "@/lib/utils";
import { VERSION_IMAGE_DIMENSIONS, versionImageSources } from "@/lib/version-image";

type VersionBadgeProps = {
  /** Raw catalog version string used to resolve the version icon. */
  version: string;
  /** Visible/alt text; falls back to `version`. Useful when a branch label differs. */
  label?: string;
  className?: string;
};

// Shows the maimai version icon when the version maps to one; otherwise renders
// the version/branch text as a regular outline Badge.
export function VersionBadge({ version, label, className }: VersionBadgeProps) {
  const sources = versionImageSources(version);
  const text = (label ?? version ?? "").trim();

  if (!sources) {
    return text ? (
      <Badge variant="outline" className={className}>
        {text}
      </Badge>
    ) : null;
  }

  return (
    <CompatibleImage
      sources={sources}
      alt={text || "maimai version"}
      title={text || undefined}
      width={VERSION_IMAGE_DIMENSIONS.width}
      height={VERSION_IMAGE_DIMENSIONS.height}
      className={cn("h-7 w-auto rounded-md", className)}
    />
  );
}
