import { CompatibleImage, type CompatibleImageSources } from "@/components/site/compatible-image";
import { cn } from "@/lib/utils";

// Cabinet/chart-type icon. DX and ST are the standard cabinets; every other
// prefix (宴/協/奏/… and other single-char markers) is a UTAGE (宴) chart type.
type CabinetIcon = { sources: CompatibleImageSources; label: string; width: number; height: number };

const DX: CabinetIcon = {
  sources: { avif: "/cabinet/DX.avif", webp: "/cabinet/DX.webp", png: "/cabinet/DX.png" },
  label: "DX",
  width: 200,
  height: 64,
};
const ST: CabinetIcon = {
  sources: { avif: "/cabinet/ST.avif", webp: "/cabinet/ST.webp", png: "/cabinet/ST.png" },
  label: "Standard",
  width: 200,
  height: 64,
};
const UTAGE: CabinetIcon = {
  sources: {
    avif: "/cabinet/UTAGE.avif",
    webp: "/cabinet/UTAGE.webp",
    png: "/cabinet/UTAGE.png",
  },
  label: "宴 / UTAGE",
  width: 236,
  height: 64,
};

function cabinetIcon(cabinet: string): CabinetIcon | null {
  const key = cabinet.trim();
  if (!key) return null;
  if (key === "DX") return DX;
  if (key === "ST") return ST;
  return UTAGE;
}

type CabinetBadgeProps = {
  cabinet: string;
  className?: string;
};

export function CabinetBadge({ cabinet, className }: CabinetBadgeProps) {
  const icon = cabinetIcon(cabinet);
  if (!icon) {
    return null;
  }

  return (
    <CompatibleImage
      sources={icon.sources}
      alt={icon.label}
      title={icon.label}
      width={icon.width}
      height={icon.height}
      className={cn("h-6 w-auto rounded", className)}
    />
  );
}
