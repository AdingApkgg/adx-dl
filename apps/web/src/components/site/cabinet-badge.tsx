import Image from "next/image";

import { cn } from "@/lib/utils";

// Cabinet/chart-type icon. DX and ST are the standard cabinets; every other
// prefix (宴/協/奏/… and other single-char markers) is a UTAGE (宴) chart type.
type CabinetIcon = { src: string; label: string; width: number; height: number };

const DX: CabinetIcon = { src: "/cabinet/DX.png", label: "DX", width: 200, height: 64 };
const ST: CabinetIcon = { src: "/cabinet/ST.png", label: "Standard", width: 200, height: 64 };
const UTG: CabinetIcon = { src: "/cabinet/UTG.png", label: "宴 / UTAGE", width: 236, height: 64 };

function cabinetIcon(cabinet: string): CabinetIcon | null {
  const key = cabinet.trim();
  if (!key) return null;
  if (key === "DX") return DX;
  if (key === "ST") return ST;
  return UTG;
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
    <Image
      src={icon.src}
      alt={icon.label}
      title={icon.label}
      width={icon.width}
      height={icon.height}
      unoptimized
      className={cn("h-6 w-auto rounded", className)}
    />
  );
}
