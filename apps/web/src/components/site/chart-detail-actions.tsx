"use client";

import * as React from "react";
import {
  CheckIcon,
  FilmIcon,
  MessageCircleIcon,
  PlayCircleIcon,
  Share2Icon,
} from "lucide-react";

import { ChartPreviewIsland } from "@/components/chart-preview/chart-preview-island";
import { ChartComments } from "@/components/site/chart-comments";
import { ChartMediaPlayer } from "@/components/site/chart-media-player";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatEntryTitle, localChartAssetUrl, type CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { cn, TAP_TARGET_44 } from "@/lib/utils";

type DetailPanel = "media" | "preview" | "comments" | null;

/**
 * Asks the (client) actions block to open the preview on a specific difficulty.
 *
 * The difficulty table lives in the server-rendered page body, so a shared
 * window event is what connects the two without pulling the whole table into a
 * client component or forcing a full page navigation through `?diff=`.
 */
export const OPEN_CHART_PREVIEW_EVENT = "astrodx-open-chart-preview";

export type OpenChartPreviewDetail = { slot?: number };

/** Reads `?diff=` — the difficulty half of a shared preview deep link. */
function readDifficultyParam(params: URLSearchParams): number | null {
  // Empty (`?diff=`) must stay "unset": Number("") is 0, which is a real slot.
  const raw = params.get("diff")?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

type ChartDetailActionsProps = {
  entry: CatalogEntry;
  locale: Locale;
};

export function getChartPreviewAssets(entry: CatalogEntry) {
  return {
    maidataUrl: localChartAssetUrl(entry, "maidata.txt"),
    coverUrl:
      entry.assets.has_background || Boolean(entry.media.cover_url)
        ? entry.media.cover_url || undefined
        : undefined,
    audioUrl: entry.media.audio_url || undefined,
    videoUrl: entry.media.pv_url || undefined,
  };
}

export function ChartDetailActions({ entry, locale }: ChartDetailActionsProps) {
  const [activePanel, setActivePanel] = React.useState<DetailPanel>(null);

  const dictionary = getDictionary(locale);
  const detail = dictionary.detail;
  const closeLabel = dictionary.downloads.dismiss;
  const title = formatEntryTitle(entry, locale);
  const mediaLabel = entry.assets.has_pv ? detail.pvLabel : detail.audioLabel;
  const previewAssets = getChartPreviewAssets(entry);
  const hasMedia =
    (entry.assets.has_pv && Boolean(entry.media.pv_url)) ||
    (entry.assets.has_audio && Boolean(entry.media.audio_url));
  const hasChartPreview = Boolean(entry.files.maidata);

  // Which difficulty the preview opens on. Null = the chart's highest, which is
  // what a bare link means. A `?diff=` link (or a click on a difficulty row)
  // pins a specific slot: without it, a link copied on EXPERT reopened on
  // MASTER at the same beat — a completely different chart at that timestamp.
  const [previewDifficulty, setPreviewDifficulty] = React.useState<number | null>(null);
  const highestDifficulty =
    entry.difficulties.length > 0
      ? Math.max(...entry.difficulties.map((difficulty) => difficulty.slot))
      : undefined;

  React.useEffect(() => {
    if (!hasChartPreview) return;
    const openPreview = (event: Event) => {
      const detail = (event as CustomEvent<OpenChartPreviewDetail>).detail;
      if (typeof detail?.slot === "number") {
        setPreviewDifficulty(detail.slot);
      }
      setActivePanel("preview");
    };
    window.addEventListener(OPEN_CHART_PREVIEW_EVENT, openPreview);
    return () => window.removeEventListener(OPEN_CHART_PREVIEW_EVENT, openPreview);
  }, [hasChartPreview]);

  // ?preview=1&diff= deep link + URL sync, in ONE effect so ordering stays
  // right. The deep link applies after hydration — the server always renders
  // the closed state, and deciding from location during the hydration render
  // mismatches the trees. On that first pass the URL is left untouched
  // (?beat= must survive until the preview mounts and consumes it); after
  // that, replaceState (no history spam) mirrors the toggle so a refresh
  // restores an open preview, and closing clears the flag plus a stale beat.
  const previewFlagInitializedRef = React.useRef(false);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const flagged = url.searchParams.get("preview") === "1";
    if (!previewFlagInitializedRef.current) {
      previewFlagInitializedRef.current = true;
      if (flagged && hasChartPreview) {
        const requested = readDifficultyParam(url.searchParams);
        /* eslint-disable react-hooks/set-state-in-effect -- one-time URL-derived initial state, applied post-hydration on purpose */
        if (requested !== null) {
          setPreviewDifficulty(requested);
        }
        setActivePanel("preview");
        /* eslint-enable react-hooks/set-state-in-effect */
        return;
      }
    }
    if (activePanel === "preview") {
      const slot = previewDifficulty;
      const diffParam = slot === null ? null : String(slot);
      if (flagged && url.searchParams.get("diff") === diffParam) {
        return;
      }
      url.searchParams.set("preview", "1");
      if (diffParam === null) {
        url.searchParams.delete("diff");
      } else {
        url.searchParams.set("diff", diffParam);
      }
    } else if (
      flagged ||
      url.searchParams.has("beat") ||
      url.searchParams.has("diff")
    ) {
      url.searchParams.delete("preview");
      url.searchParams.delete("beat");
      url.searchParams.delete("diff");
    } else {
      return;
    }
    window.history.replaceState(window.history.state, "", url);
  }, [activePanel, hasChartPreview, previewDifficulty]);

  const [shareCopied, setShareCopied] = React.useState(false);
  const shareResetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (shareResetTimer.current) {
        clearTimeout(shareResetTimer.current);
      }
    };
  }, []);

  const handleShare = React.useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }
    const url = window.location.href;
    // Prefer the native share sheet where available (mostly mobile).
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // The user dismissing the sheet is a normal outcome, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Any other failure falls through to the clipboard path below.
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
      setShareCopied(true);
      if (shareResetTimer.current) {
        clearTimeout(shareResetTimer.current);
      }
      shareResetTimer.current = setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard access denied — nothing more we can do silently.
    }
  }, [title]);

  // Radix owns Escape, the scroll lock and the focus lifecycle now; only one
  // panel is mounted at a time, so `activePanel` alone decides which.
  const closePanel = React.useCallback(() => setActivePanel(null), []);

  const overlay =
    activePanel === "media" ? (
      <DetailPanel
        title={mediaLabel}
        closeLabel={closeLabel}
        variant="centered"
        onClose={closePanel}
      >
        <div className="p-4">
          <ChartMediaPlayer entry={entry} locale={locale} />
        </div>
      </DetailPanel>
    ) : activePanel === "comments" ? (
      <DetailPanel
        title={detail.comments}
        closeLabel={closeLabel}
        variant="centered"
        className="max-w-3xl"
        onClose={closePanel}
      >
        <div className="p-4">
          <ChartComments
            pageKey={`/charts/${entrySlug(entry)}`}
            pageTitle={title}
            locale={locale}
          />
        </div>
      </DetailPanel>
    ) : activePanel === "preview" ? (
      <DetailPanel
        title={detail.chartPreview}
        closeLabel={closeLabel}
        variant="fullscreen"
        onClose={closePanel}
      >
        <div className="mx-auto w-full max-w-7xl px-4 pb-6 pt-4 md:px-6">
          <ChartPreviewIsland
            maidataUrl={previewAssets.maidataUrl}
            audioUrl={previewAssets.audioUrl}
            videoUrl={previewAssets.videoUrl}
            coverUrl={previewAssets.coverUrl}
            chartName={`${entry.short_id || entry.id}-${title}`}
            locale={locale}
            deferUntilNearViewport={false}
            levels={Object.fromEntries(entry.difficulties.map((d) => [d.slot, d.level]))}
            defaultDifficulty={previewDifficulty ?? highestDifficulty}
          />
        </div>
      </DetailPanel>
    ) : null;

  return (
    <>
      <TooltipProvider>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3" role="group" aria-label={detail.actionsLabel}>
            {/* The preview is the one action worth a full-width button: it was
                a 40px Maximize2 icon, which everyone reads as "enlarge the
                cover", behind a Radix tooltip that bails out on touch
                pointers — i.e. an unlabelled square on every phone. */}
            {hasChartPreview ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setActivePanel("preview")}
              >
                <PlayCircleIcon data-icon="inline-start" aria-hidden="true" />
                {detail.chartPreview}
              </Button>
            ) : null}
            {hasMedia ? (
              <ActionIconButton
                label={mediaLabel}
                onClick={() => setActivePanel("media")}
              >
                <FilmIcon aria-hidden="true" />
              </ActionIconButton>
            ) : null}
            <ActionIconButton label={detail.comments} onClick={() => setActivePanel("comments")}>
              <MessageCircleIcon aria-hidden="true" />
            </ActionIconButton>
            <ActionIconButton
              label={shareCopied ? detail.shareCopied : detail.share}
              onClick={handleShare}
            >
              {shareCopied ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <Share2Icon aria-hidden="true" />
              )}
            </ActionIconButton>
          </div>
          {hasChartPreview ? (
            <p className="max-w-xs text-xs text-muted-foreground">
              {detail.chartPreviewDescription}
            </p>
          ) : null}
        </div>
      </TooltipProvider>
      {/* Radix portals the panel itself, so no extra portal here. */}
      {overlay}
    </>
  );
}

/**
 * Icon action that stops being icon-only where a tooltip can never appear.
 *
 * Radix Tooltip returns early on touch pointers by design, so on a phone these
 * were four unlabelled squares. Rather than bolt a tap-to-reveal popover on
 * top, the label itself becomes visible under `(hover: none)` — no JS, no
 * hydration branch, and it survives a device that reports both input types.
 */
function ActionIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            TAP_TARGET_44,
            "[@media(hover:none)]:size-auto [@media(hover:none)]:h-8 [@media(hover:none)]:gap-1.5 [@media(hover:none)]:px-2.5"
          )}
          aria-label={label}
          onClick={onClick}
        >
          {children}
          <span className="sr-only [@media(hover:none)]:not-sr-only" aria-hidden="true">
            {label}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A difficulty row that opens the preview already switched to that difficulty.
 * Rendered inside the (server) difficulty table, so it only carries the click →
 * event hop; all preview state stays in ChartDetailActions.
 */
export function PreviewDifficultyTrigger({
  slot,
  label,
  className,
  children,
}: {
  slot: number;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "rounded-md transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className
      )}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent<OpenChartPreviewDetail>(OPEN_CHART_PREVIEW_EVENT, {
            detail: { slot },
          })
        )
      }
    >
      {children}
    </button>
  );
}

/**
 * Panel shell for the detail overlays.
 *
 * These were hand-rolled `motion.div`s with `role="dialog"`, an Esc handler and
 * a body scroll lock — but no focus trap, no initial focus and no focus
 * restore, so a keyboard user tabbed straight out of the open panel into the
 * page behind it and never got their place back on close. Radix Dialog (via
 * ui/sheet) gives all three, plus the aria-modal wiring, for free; the only
 * thing left here is the layout choice.
 */
function DetailPanel({
  title,
  closeLabel,
  variant,
  className,
  children,
  onClose,
}: {
  title: string;
  closeLabel: string;
  variant: "centered" | "fullscreen";
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent
        variant={variant}
        closeLabel={closeLabel}
        // No prose description exists for any of these panels; telling Radix so
        // explicitly is what silences its development warning.
        aria-describedby={undefined}
        className={cn("overflow-hidden", className)}
      >
        <SheetHeader className="flex h-12 shrink-0 flex-row items-center gap-3 space-y-0 border-b border-border/70 pl-4 pr-12">
          <SheetTitle className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </SheetTitle>
        </SheetHeader>
        {/* `flex-auto`, not `flex-1`. The centered variant sizes itself with
            `h-fit`, and a `flex: 1 1 0%` child has no basis to contribute to a
            fit-content parent — WebKit resolves that to zero, which collapsed
            the audio and comment panels on iOS to just their title bar. With
            `flex: 1 1 auto` the body's own content is the basis, so the panel
            grows to fit, and `min-h-0` still lets it shrink and scroll once the
            container hits its max height. The fullscreen variant has a definite
            height, so it is unaffected either way. */}
        <div className="min-h-0 flex-auto overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
