import { ImageIcon, Music4Icon, VideoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";

type EntryAssetBadgesProps = {
  entry: CatalogEntry;
  locale?: Locale;
};

export function EntryAssetBadges({ entry, locale = "zh" }: EntryAssetBadgesProps) {
  const labels = getDictionary(locale).assets;

  return (
    <>
      {entry.assets.has_audio ? (
        <Badge variant="secondary">
          <Music4Icon data-icon="inline-start" aria-hidden="true" />
          {labels.audio}
        </Badge>
      ) : null}
      {entry.assets.has_background ? (
        <Badge variant="secondary">
          <ImageIcon data-icon="inline-start" aria-hidden="true" />
          {labels.jacket}
        </Badge>
      ) : null}
      {entry.assets.has_pv ? (
        <Badge variant="secondary">
          <VideoIcon data-icon="inline-start" aria-hidden="true" />
          {labels.pv}
        </Badge>
      ) : null}
      {entry.assets.has_dx_chart ? <Badge variant="secondary">{labels.dxChart}</Badge> : null}
    </>
  );
}
