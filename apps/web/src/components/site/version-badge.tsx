import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VERSION_IMAGE_DIMENSIONS, versionImageSrc } from "@/lib/version-image";

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
  const src = versionImageSrc(version);
  const text = (label ?? version ?? "").trim();

  if (!src) {
    return text ? (
      <Badge variant="outline" className={className}>
        {text}
      </Badge>
    ) : null;
  }

  return (
    <Image
      src={src}
      alt={text || "maimai version"}
      title={text || undefined}
      width={VERSION_IMAGE_DIMENSIONS.width}
      height={VERSION_IMAGE_DIMENSIONS.height}
      unoptimized
      className={cn("h-7 w-auto rounded-md", className)}
    />
  );
}
