"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { FilmIcon, Maximize2Icon, MessageCircleIcon, XIcon } from "lucide-react";

import { ChartPreviewIsland } from "@/components/chart-preview/chart-preview-island";
import { ChartComments } from "@/components/site/chart-comments";
import { ChartMediaPlayer } from "@/components/site/chart-media-player";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatEntryTitle, type CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { cn } from "@/lib/utils";

type DetailPanel = "media" | "preview" | "comments" | null;

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
  const hasMedia =
    (entry.assets.has_pv && Boolean(entry.media.pv_url)) ||
    (entry.assets.has_audio && Boolean(entry.media.audio_url));
  const hasChartPreview = Boolean(entry.files.maidata);
  const portalRoot = typeof document === "undefined" ? null : document.body;

  React.useEffect(() => {
    if (!activePanel) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePanel]);

  const overlay =
    activePanel === "media" ? (
      <CenteredDialog title={mediaLabel} closeLabel={closeLabel} onClose={() => setActivePanel(null)}>
        <ChartMediaPlayer entry={entry} locale={locale} />
      </CenteredDialog>
    ) : activePanel === "comments" ? (
      <CenteredDialog
        title={detail.comments}
        closeLabel={closeLabel}
        className="max-w-3xl"
        onClose={() => setActivePanel(null)}
      >
        <ChartComments
          pageKey={`/charts/${entrySlug(entry)}`}
          pageTitle={title}
          locale={locale}
        />
      </CenteredDialog>
    ) : activePanel === "preview" ? (
      <FullscreenOverlay
        title={detail.chartPreview}
        closeLabel={closeLabel}
        onClose={() => setActivePanel(null)}
      >
        <ChartPreviewIsland
          maidataUrl={entry.files.maidata}
          audioUrl={entry.media.audio_url || undefined}
          videoUrl={entry.media.pv_url || entry.files.pv || undefined}
          chartName={`${entry.short_id || entry.id}-${title}`}
          locale={locale}
          levels={Object.fromEntries(entry.difficulties.map((d) => [d.slot, d.level]))}
          defaultDifficulty={
            entry.difficulties.length > 0
              ? Math.max(...entry.difficulties.map((d) => d.slot))
              : undefined
          }
        />
      </FullscreenOverlay>
    ) : null;

  return (
    <>
      <TooltipProvider>
        <div className="flex items-center gap-1.5" aria-label={detail.preview}>
          {hasMedia ? (
            <ActionIconButton
              label={mediaLabel}
              onClick={() => setActivePanel("media")}
            >
              <FilmIcon aria-hidden="true" />
            </ActionIconButton>
          ) : null}
          {hasChartPreview ? (
            <ActionIconButton label={detail.chartPreview} onClick={() => setActivePanel("preview")}>
              <Maximize2Icon aria-hidden="true" />
            </ActionIconButton>
          ) : null}
          <ActionIconButton label={detail.comments} onClick={() => setActivePanel("comments")}>
            <MessageCircleIcon aria-hidden="true" />
          </ActionIconButton>
        </div>
      </TooltipProvider>
      {portalRoot && overlay ? createPortal(overlay, portalRoot) : null}
    </>
  );
}

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
        <Button type="button" variant="outline" size="icon" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

function CenteredDialog({
  title,
  closeLabel,
  className,
  children,
  onClose,
}: {
  title: string;
  closeLabel: string;
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={cn(
          "flex max-h-[min(88vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/70 bg-popover shadow-2xl",
          className
        )}
      >
        <DialogHeader title={title} closeLabel={closeLabel} onClose={onClose} />
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function FullscreenOverlay({
  title,
  closeLabel,
  children,
  onClose,
}: {
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex min-h-dvh flex-col bg-background"
    >
      <DialogHeader title={title} closeLabel={closeLabel} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 md:px-6">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </div>
    </div>
  );
}

function DialogHeader({
  title,
  closeLabel,
  onClose,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={onClose}>
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
