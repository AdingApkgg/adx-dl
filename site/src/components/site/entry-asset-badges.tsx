import { ImageIcon, Music4Icon, VideoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CatalogEntry } from "@/lib/catalog-shared";

type EntryAssetBadgesProps = {
  entry: CatalogEntry;
};

export function EntryAssetBadges({ entry }: EntryAssetBadgesProps) {
  return (
    <>
      {entry.assets.has_audio ? (
        <Badge variant="secondary">
          <Music4Icon data-icon="inline-start" />
          Audio
        </Badge>
      ) : null}
      {entry.assets.has_background ? (
        <Badge variant="secondary">
          <ImageIcon data-icon="inline-start" />
          Jacket
        </Badge>
      ) : null}
      {entry.assets.has_pv ? (
        <Badge variant="secondary">
          <VideoIcon data-icon="inline-start" />
          PV
        </Badge>
      ) : null}
      {entry.assets.has_dx_chart ? <Badge variant="secondary">DX Chart</Badge> : null}
    </>
  );
}
