import type { ImgHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type CompatibleImageSources = {
  avif?: string;
  webp?: string;
  png: string;
};

export function compatibleSourcesFromPng(src: string): CompatibleImageSources {
  const base = src.replace(/\.png$/i, "");
  return {
    avif: `${base}.avif`,
    webp: `${base}.webp`,
    png: src,
  };
}

type CompatibleImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "alt"> & {
  sources: CompatibleImageSources;
  alt: string;
  pictureClassName?: string;
};

export function CompatibleImage({
  sources,
  alt,
  pictureClassName,
  className,
  decoding = "async",
  ...imgProps
}: CompatibleImageProps) {
  return (
    <picture className={pictureClassName ?? "contents"}>
      {sources.avif ? <source srcSet={sources.avif} type="image/avif" /> : null}
      {sources.webp ? <source srcSet={sources.webp} type="image/webp" /> : null}
      <img
        {...imgProps}
        src={sources.png}
        alt={alt}
        className={cn(className)}
        decoding={decoding}
      />
    </picture>
  );
}
