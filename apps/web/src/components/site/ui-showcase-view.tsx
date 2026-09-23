import { DownloadIcon, SearchIcon, StarIcon } from "lucide-react";

import { Reveal } from "@/components/motion";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { ChartCard, CHART_CARD_SIZES, CHART_GRID_CLASS } from "@/components/site/chart-card";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { EntryAssetBadges } from "@/components/site/entry-asset-badges";
import { GenreBadge } from "@/components/site/genre-badge";
import { VersionBadge } from "@/components/site/version-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogEntry } from "@/lib/catalog";
import {
  DIFFICULTY_DOT_CLASS,
  DIFFICULTY_TONE_CLASS,
  toCatalogCardEntry,
  type DifficultyTone,
} from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";

/**
 * Semantic colour tokens, as the Tailwind utility that reads each one. Kept as
 * literal class strings rather than built from the token name: Tailwind only
 * emits a utility it can see spelled out in the source.
 */
const SURFACE_TOKENS: readonly (readonly [string, string])[] = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["popover", "bg-popover"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["primary", "bg-primary"],
  ["secondary", "bg-secondary"],
  ["destructive", "bg-destructive"],
];

/** Tokens that only ever appear as text or a hairline, so a filled swatch would lie. */
const LINE_TOKENS: readonly (readonly [string, string])[] = [
  ["border", "border-border"],
  ["input", "border-input"],
  ["ring", "border-ring"],
];

const DIFFICULTY_TONES: readonly DifficultyTone[] = [
  "basic",
  "advanced",
  "expert",
  "master",
  "remaster",
  "utage",
  "default",
];

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The /ui design-system showcase.
 *
 * Renders the real components against real catalogue data rather than a
 * hand-written copy, so it cannot drift from the code the way a static
 * rendition does — that is the whole reason it lives in the app instead of
 * being a document. Not indexed, not in the nav, not in the sitemap.
 *
 * Entries arrive as a prop rather than being read here: the route components
 * do the loading (mirroring charts/page.tsx), which keeps this a synchronous
 * component that the route tests can render with renderToStaticMarkup.
 */
export function UiShowcaseView({
  locale = "zh",
  entries,
}: {
  locale?: Locale;
  entries: CatalogEntry[];
}) {
  const { ui, catalogBrowser } = getDictionary(locale);
  // Deterministic slice so the page is stable across builds.
  const sample = entries.slice(0, 6);
  const cardEntries = sample.slice(0, 4).map(toCatalogCardEntry);
  const badgeEntry = sample[0];

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10"
    >
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{ui.title}</h1>
        <p className="text-muted-foreground">{ui.description}</p>
        <p className="text-sm text-muted-foreground">{ui.intro}</p>
      </Reveal>

      <Separator />

      <Section title={ui.sections.palette}>
        <p className="text-sm text-muted-foreground">{ui.themeNote}</p>
        <ul className="flex list-none flex-wrap gap-3 p-0">
          {SURFACE_TOKENS.map(([name, className]) => (
            <li key={name} className="text-center">
              <div className={`h-14 w-24 rounded-lg border border-border/60 ${className}`} />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">{name}</span>
            </li>
          ))}
        </ul>
        <ul className="flex list-none flex-wrap gap-3 p-0">
          {LINE_TOKENS.map(([name, className]) => (
            <li key={name} className="text-center">
              <div className={`h-8 w-24 rounded-lg border-2 ${className}`} />
              <span className="mt-1 block font-mono text-xs text-muted-foreground">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Separator />

      <Section title={ui.sections.difficulty}>
        <ul className="flex list-none flex-wrap items-center gap-2 p-0">
          {DIFFICULTY_TONES.map((tone) => (
            <li
              key={tone}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${DIFFICULTY_TONE_CLASS[tone]}`}
            >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${DIFFICULTY_DOT_CLASS[tone]}`}
              />
              <span className="font-mono">{tone}</span>
            </li>
          ))}
        </ul>
        {badgeEntry ? (
          <div className="flex flex-wrap items-center gap-2">
            {badgeEntry.difficulties.map((difficulty) => (
              <DifficultyPill
                key={`${difficulty.slot}-${difficulty.level}`}
                difficulty={difficulty}
                showLabel
                showConstant
              />
            ))}
          </div>
        ) : null}
      </Section>

      <Separator />

      <Section title={ui.sections.typography}>
        <h3 className="text-4xl font-bold">AstroDX 谱面资源</h3>
        <h4 className="text-2xl font-semibold">系ぎて / Tsunagite</h4>
        <p className="max-w-prose leading-7">
          搜索、试玩并下载社区谱面，按版本与曲风浏览，再一键导入 AstroDX。Latin text sits beside
          CJK in the same paragraph, which is exactly where a mismatched fallback shows.
        </p>
        <p className="text-sm text-muted-foreground">{ui.typographyNote}</p>
      </Section>

      <Separator />

      <Section title={ui.sections.buttons}>
        <div className="flex flex-wrap items-center gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {BUTTON_SIZES.map((size) => (
            <Button key={size} size={size} variant="outline">
              <SearchIcon data-icon="inline-start" aria-hidden="true" />
              {size}
            </Button>
          ))}
          <Button size="icon" variant="outline" aria-label="icon">
            <StarIcon aria-hidden="true" />
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="icon-sm">
            <StarIcon aria-hidden="true" />
          </Button>
          <Button disabled>
            <DownloadIcon data-icon="inline-start" aria-hidden="true" />
            disabled
          </Button>
        </div>
      </Section>

      <Separator />

      <Section title={ui.sections.badges}>
        <p className="text-sm font-medium">{ui.badgesUi}</p>
        <div className="flex flex-wrap items-center gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
        {badgeEntry ? (
          <>
            <p className="text-sm font-medium">{ui.badgesDomain}</p>
            <div className="flex flex-wrap items-center gap-2">
              <VersionBadge version={badgeEntry.version} />
              <GenreBadge entry={badgeEntry} locale={locale} />
              <CabinetBadge cabinet={badgeEntry.cabinet} />
              <EntryAssetBadges entry={badgeEntry} locale={locale} />
            </div>
          </>
        ) : null}
      </Section>

      <Separator />

      <Section title={ui.sections.cards}>
        <p className="text-sm text-muted-foreground">{ui.cardsNote}</p>
        <ul className={CHART_GRID_CLASS}>
          {cardEntries.map((entry) => (
            <li key={entry.id}>
              <ChartCard entry={entry} locale={locale} sizes={CHART_CARD_SIZES} />
            </li>
          ))}
        </ul>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Card</CardTitle>
            <CardDescription>CardHeader · CardTitle · CardDescription</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">CardContent</CardContent>
        </Card>
      </Section>

      <Separator />

      <Section title={ui.sections.controls}>
        <div className="grid max-w-xl gap-4">
          <Input placeholder={catalogBrowser.searchPlaceholder} />
          <Select defaultValue="all">
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Select · SelectItem</SelectItem>
              <SelectItem value="one">SelectItem</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Textarea" />
        </div>
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">TabsTrigger</TabsTrigger>
            <TabsTrigger value="two">TabsTrigger</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="mt-4 text-sm text-muted-foreground">
            TabsContent
          </TabsContent>
          <TabsContent value="two" className="mt-4 text-sm text-muted-foreground">
            TabsContent
          </TabsContent>
        </Tabs>
      </Section>

      <Separator />

      <Section title={ui.sections.loading}>
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </Section>
    </main>
  );
}
