"use client";

import * as React from "react";
import {
  CheckIcon,
  FilmIcon,
  MessageCircleIcon,
  PlayCircleIcon,
  SearchIcon,
  Share2Icon,
} from "lucide-react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildPreviewHref, legacyPreviewHref } from "@/lib/chart-preview-route";
export { getChartPreviewAssets } from "@/lib/chart-preview-route";
import { ChartComments } from "@/components/site/chart-comments";
import { ChartMediaPlayer } from "@/components/site/chart-media-player";
import { Button } from "@astrodx/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@astrodx/ui/components/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@astrodx/ui/components/tooltip";
import { formatEntryTitle, type CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { cn, TAP_TARGET_44 } from "@astrodx/ui/lib/utils";

type DetailPanel = "media" | "comments" | null;

type ChartDetailActionsProps = {
  entry: CatalogEntry;
  locale: Locale;
};

export function ChartDetailActions({ entry, locale }: ChartDetailActionsProps) {
  const [activePanel, setActivePanel] = React.useState<DetailPanel>(null);

  const dictionary = getDictionary(locale);
  const detail = dictionary.detail;
  const closeLabel = dictionary.downloads.dismiss;
  const title = formatEntryTitle(entry, locale);
  const mediaLabel = entry.assets.has_pv ? detail.pvLabel : detail.audioLabel;
  const router = useRouter();
  const hasMedia =
    (entry.assets.has_pv && Boolean(entry.media.pv_url)) ||
    (entry.assets.has_audio && Boolean(entry.media.audio_url));
  const hasChartPreview = Boolean(entry.files.maidata);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (hasChartPreview && url.searchParams.get("preview") === "1") {
      router.replace(legacyPreviewHref(url, entry, locale));
    }
  }, [entry, hasChartPreview, locale, router]);

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
    ) : null;

  return (
    <>
      <TooltipProvider>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3" role="group" aria-label={detail.actionsLabel}>
            {/* Visible labels keep preview and gameplay search discoverable on touch screens. */}
            {hasChartPreview ? (
              <Button variant="secondary" className="min-h-11" asChild>
                <Link href={buildPreviewHref(entry, locale)}>
                  <PlayCircleIcon data-icon="inline-start" aria-hidden="true" />
                  {detail.chartPreview}
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" className="min-h-11" asChild>
              <a href={`https://search.bilibili.com/video?keyword=${encodeURIComponent(`${entry.title} maimai 手元`)}`} target="_blank" rel="noopener noreferrer" title={detail.chartConfirmHint}>
                <SearchIcon data-icon="inline-start" aria-hidden="true" />
                {detail.chartConfirm}
              </a>
            </Button>
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

/** A crawlable link directly to the requested preview difficulty. */
export function PreviewDifficultyTrigger({ href, label, className, children }: {
  href: string; label: string; className?: string; children: React.ReactNode;
}) {
  return <Link href={href} title={label} aria-label={label} className={cn("rounded-md transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}>{children}</Link>;
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
