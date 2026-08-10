"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  FileArchiveIcon,
  FolderTreeIcon,
  GaugeIcon,
  Globe2Icon,
  LockKeyholeIcon,
  MonitorIcon,
  MoonStarIcon,
  Music2Icon,
  PaletteIcon,
  PlusIcon,
  SaveIcon,
  Settings2Icon,
  SparklesIcon,
  SunMediumIcon,
  Trash2Icon,
} from "lucide-react";

import { storePreferredLocale } from "@/app/locale-preference";
import { DownloadHistoryList } from "@/components/site/downloads/download-history";
import {
  ACCENT_COLORS,
  useTheme,
  type AccentColor,
  type ThemePreference,
} from "@/components/site/theme-provider";
import {
  configuredDownloadSources,
  downloadSourceBadge,
  downloadSourceCopy,
  downloadSourceStatusClass,
  downloadSourceStatusText,
  IDLE_DOWNLOAD_SOURCE_PROBE,
} from "@/components/site/downloads/download-source-selector";
import {
  BATCH_GROUPINGS,
  useDownloadsStore,
} from "@/components/site/downloads/downloads-store";
import { HEADER_ACTION_CLASS } from "@/components/site/header-actions";
import { getMusicPlayerCopy } from "@/components/site/music-player/music-player-copy";
import { useMusicPlayerPreferences } from "@/components/site/music-player/music-player-preferences";
import { useMotionPreference, type MotionMode } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ARCHIVE_FORMATS } from "@/lib/adx-archive-shared";
import {
  getDownloadSource,
  type CustomDownloadSourceConfig,
  type DownloadSource,
  type DownloadSourceId,
} from "@/lib/download-sources";
import {
  getHtmlLang,
  locales,
  switchLocale,
  type Locale,
  type SiteDictionary,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

const accentSwatches: Record<AccentColor, string> = {
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
};

const themeIcons: Record<ThemePreference, React.ReactNode> = {
  system: <MonitorIcon aria-hidden="true" />,
  light: <SunMediumIcon aria-hidden="true" />,
  dark: <MoonStarIcon aria-hidden="true" />,
};

const motionIcons: Record<MotionMode, React.ReactNode> = {
  system: <MonitorIcon aria-hidden="true" />,
  on: <SparklesIcon aria-hidden="true" />,
  off: <SparklesIcon aria-hidden="true" className="opacity-50" />,
};

type SiteSettingsPanelProps = {
  locale: Locale;
  pathname: string;
  dictionary: SiteDictionary;
};

export function SiteSettingsPanel({
  locale,
  pathname,
  dictionary,
}: SiteSettingsPanelProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const refreshSourceProbes = useDownloadsStore(
    (state) => state.refreshSourceProbes
  );
  const navigateLocale = React.useCallback(
    (href: string) => router.push(href, { scroll: false }),
    [router]
  );

  React.useEffect(() => {
    if (open) {
      void refreshSourceProbes();
    }
  }, [open, refreshSourceProbes]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={dictionary.settings.open}
          title={dictionary.settings.open}
          className={HEADER_ACTION_CLASS}
        >
          <Settings2Icon aria-hidden="true" />
          {/* The aria-label ("打开设置") stays the accessible name and contains
              this shorter visible one, so Label-in-Name still holds. */}
          <span className="hidden md:inline">{dictionary.settings.title}</span>
        </Button>
      </SheetTrigger>
      <SheetContent closeLabel={dictionary.settings.close}>
        <SiteSettingsContent
          locale={locale}
          pathname={pathname}
          dictionary={dictionary}
          withinDialog
          navigateLocale={navigateLocale}
        />
      </SheetContent>
    </Sheet>
  );
}

export function SiteSettingsContent({
  locale,
  pathname,
  dictionary,
  withinDialog = false,
  navigateLocale,
}: SiteSettingsPanelProps & {
  withinDialog?: boolean;
  navigateLocale?: (href: string) => void;
}) {
  const copy = dictionary.settings;
  const downloadsCopy = dictionary.downloads;
  const { theme, accent, setTheme, setAccent } = useTheme();
  const { mode: motionMode, setMode: setMotionMode } =
    useMotionPreference();
  const selectedSourceId = useDownloadsStore(
    (state) => state.selectedSourceId
  );
  const setSelectedSourceId = useDownloadsStore(
    (state) => state.setSelectedSourceId
  );
  const preferredBatchGrouping = useDownloadsStore(
    (state) => state.preferredBatchGrouping
  );
  const setPreferredBatchGrouping = useDownloadsStore(
    (state) => state.setPreferredBatchGrouping
  );
  const preferredFormat = useDownloadsStore((state) => state.preferredFormat);
  const setPreferredFormat = useDownloadsStore(
    (state) => state.setPreferredFormat
  );
  const customSources = useDownloadsStore((state) => state.customSources);
  const addCustomSource = useDownloadsStore(
    (state) => state.addCustomSource
  );
  const updateCustomSource = useDownloadsStore(
    (state) => state.updateCustomSource
  );
  const removeCustomSource = useDownloadsStore(
    (state) => state.removeCustomSource
  );
  const refreshSourceProbes = useDownloadsStore(
    (state) => state.refreshSourceProbes
  );
  const [newName, setNewName] = React.useState("");
  const [newUrl, setNewUrl] = React.useState("");
  const [newSourceError, setNewSourceError] = React.useState(false);

  const musicPlayerCopy = getMusicPlayerCopy(locale);
  const musicPlayerEnabled = useMusicPlayerPreferences(
    (state) => state.enabled
  );
  const setMusicPlayerEnabled = useMusicPlayerPreferences(
    (state) => state.setEnabled
  );
  const hydrateMusicPlayerPreferences = useMusicPlayerPreferences(
    (state) => state.hydrate
  );

  React.useEffect(() => {
    hydrateMusicPlayerPreferences();
  }, [hydrateMusicPlayerPreferences]);

  const handleLocaleSelect = (
    event: React.MouseEvent<HTMLAnchorElement>,
    targetLocale: Locale
  ) => {
    storePreferredLocale(targetLocale);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const { search, hash } = window.location;
    if (!search && !hash) {
      return;
    }
    event.preventDefault();
    const href = `${switchLocale(pathname, targetLocale)}${search}${hash}`;
    if (navigateLocale) {
      navigateLocale(href);
      return;
    }
    // Next.js integrates native history calls with the App Router. This
    // fallback keeps standalone uses client-side without forcing a reload.
    window.history.pushState(null, "", href);
  };

  const addSource = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = addCustomSource(newName, newUrl);
    if (id === null) {
      setNewSourceError(true);
      return;
    }
    setSelectedSourceId(id);
    setNewName("");
    setNewUrl("");
    setNewSourceError(false);
  };

  const themeOptions: ThemePreference[] = ["system", "light", "dark"];
  const motionOptions: MotionMode[] = ["system", "on", "off"];
  const sources = configuredDownloadSources(customSources);

  return (
    <>
      <SheetHeader className="border-b border-border px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] pr-14 sm:px-6 sm:pr-14">
        {withinDialog ? (
          <>
            <SheetTitle>{copy.title}</SheetTitle>
            <SheetDescription>{copy.description}</SheetDescription>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold tracking-tight">
              {copy.title}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {copy.description}
            </p>
          </>
        )}
      </SheetHeader>

      <div className="flex-1 space-y-8 overflow-y-auto overscroll-contain px-5 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <SettingsSection
          icon={<PaletteIcon />}
          title={copy.appearanceTitle}
          description={copy.appearanceDescription}
        >
          <SettingsField label={copy.languageLabel}>
            <div className="grid grid-cols-3 gap-2">
              {locales.map((targetLocale) => {
                const active = targetLocale === locale;
                return (
                  <Link
                    key={targetLocale}
                    href={switchLocale(pathname, targetLocale)}
                    lang={getHtmlLang(targetLocale)}
                    aria-current={active ? "true" : undefined}
                    onClick={(event) =>
                      handleLocaleSelect(event, targetLocale)
                    }
                    className={choiceClass(active)}
                  >
                    <Globe2Icon aria-hidden="true" />
                    <span>{dictionary.language[targetLocale]}</span>
                    {active ? (
                      <CheckIcon
                        aria-hidden="true"
                        className="ml-auto size-3.5"
                      />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </SettingsField>

          <SettingsField label={copy.themeLabel}>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map((option) => {
                const active = theme === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(option)}
                    className={choiceClass(active)}
                  >
                    {themeIcons[option]}
                    <span>{dictionary.theme[option]}</span>
                  </button>
                );
              })}
            </div>
          </SettingsField>

          <SettingsField label={copy.accentLabel}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {ACCENT_COLORS.map((color) => {
                const active = accent === color;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAccent(color)}
                    className={cn(
                      choiceClass(active),
                      "justify-start sm:flex-col sm:justify-center"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 rounded-full ring-1 ring-black/10",
                        accentSwatches[color]
                      )}
                    />
                    <span>{copy.accents[color]}</span>
                  </button>
                );
              })}
            </div>
          </SettingsField>

          <SettingsField label={copy.motionLabel}>
            <div className="grid gap-2 sm:grid-cols-3">
              {motionOptions.map((option) => {
                const active = motionMode === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMotionMode(option)}
                    className={cn(
                      choiceClass(active),
                      "h-auto items-start py-2.5 text-left"
                    )}
                  >
                    <span className="mt-0.5">{motionIcons[option]}</span>
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {copy.motion[option]}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {copy.motionHints[option]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </SettingsField>
        </SettingsSection>

        <SettingsSection
          icon={<Music2Icon />}
          title={musicPlayerCopy.settings.title}
          description={musicPlayerCopy.settings.description}
        >
          <div className="grid grid-cols-2 gap-2">
            {([true, false] as const).map((value) => {
              const active = musicPlayerEnabled === value;
              return (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMusicPlayerEnabled(value)}
                  className={choiceClass(active)}
                >
                  <Music2Icon
                    aria-hidden="true"
                    className={value ? undefined : "opacity-50"}
                  />
                  <span>
                    {value
                      ? musicPlayerCopy.settings.enable
                      : musicPlayerCopy.settings.disable}
                  </span>
                  {active ? (
                    <CheckIcon aria-hidden="true" className="ml-auto size-3.5" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection
          icon={<FileArchiveIcon />}
          title={copy.downloadsTitle}
          description={copy.downloadsDescription}
        >
          <SettingsField label={copy.defaultFormatLabel}>
            <div className="grid gap-2 sm:grid-cols-3">
              {ARCHIVE_FORMATS.map((format) => {
                const active = preferredFormat === format;
                return (
                  <button
                    key={format}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPreferredFormat(format)}
                    className={cn(
                      choiceClass(active),
                      "h-auto items-start py-2.5 text-left"
                    )}
                  >
                    <span className="font-mono font-semibold">.{format}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {copy.formats[format]}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {copy.formatHelp}
            </p>
          </SettingsField>

          <SettingsField label={copy.batchGroupingLabel}>
            <div className="grid gap-2 sm:grid-cols-2">
              {BATCH_GROUPINGS.map((grouping) => {
                const active = preferredBatchGrouping === grouping;
                return (
                  <button
                    key={grouping}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPreferredBatchGrouping(grouping)}
                    className={cn(
                      choiceClass(active),
                      "h-auto items-start py-2.5 text-left"
                    )}
                  >
                    <FolderTreeIcon aria-hidden="true" className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {copy.batchGroupings[grouping].name}
                      </span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {copy.batchGroupings[grouping].description}
                      </span>
                    </span>
                    {active ? (
                      <CheckIcon aria-hidden="true" className="ml-auto mt-0.5 size-3.5" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {copy.batchGroupingHelp}
            </p>
          </SettingsField>

          {/* The tray only exists while a job does, so the history needs a home
              that is reachable at any time — this is where the other download
              preferences already live. */}
          <SettingsField label={downloadsCopy.historyTitle}>
            <DownloadHistoryList locale={locale} />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {downloadsCopy.historyDescription}
            </p>
          </SettingsField>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{copy.defaultSourceLabel}</h3>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => void refreshSourceProbes(true)}
              >
                <GaugeIcon data-icon="inline-start" />
                {copy.refreshLatency}
              </Button>
            </div>
            <div className="space-y-2">
              {sources.map((source) =>
                source.role === "custom" ? null : (
                  <SourceChoice
                    key={source.id}
                    source={source}
                    selected={selectedSourceId === source.id}
                    onSelect={setSelectedSourceId}
                    dictionary={dictionary}
                    lockedLabel={copy.builtInLocked}
                  />
                )
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">
              {copy.customSourcesLabel}
            </h3>
            {customSources.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                {copy.noCustomSources}
              </p>
            ) : (
              <div className="space-y-3">
                {customSources.map((source) => (
                  <CustomSourceEditor
                    key={`${source.id}:${source.name}:${source.baseUrl}`}
                    source={source}
                    selected={selectedSourceId === source.id}
                    onSelect={setSelectedSourceId}
                    onSave={updateCustomSource}
                    onRemove={removeCustomSource}
                    dictionary={dictionary}
                  />
                ))}
              </div>
            )}
          </div>

          <form
            noValidate
            onSubmit={addSource}
            className="space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <PlusIcon className="size-4" aria-hidden="true" />
              {copy.addCustomSource}
            </div>
            <SourceFields
              name={newName}
              url={newUrl}
              onNameChange={(value) => {
                setNewName(value);
                setNewSourceError(false);
              }}
              onUrlChange={(value) => {
                setNewUrl(value);
                setNewSourceError(false);
              }}
              invalid={newSourceError}
              dictionary={dictionary}
            />
            {newSourceError ? (
              <p role="alert" className="text-xs text-destructive">
                {copy.invalidCustomSource}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                {copy.customSourceHint}
              </p>
              <Button type="submit" size="sm">
                <PlusIcon data-icon="inline-start" />
                {copy.addCustomSource}
              </Button>
            </div>
          </form>
        </SettingsSection>
      </div>
    </>
  );
}

function CustomSourceEditor({
  source,
  selected,
  onSelect,
  onSave,
  onRemove,
  dictionary,
}: {
  source: CustomDownloadSourceConfig;
  selected: boolean;
  onSelect: (id: DownloadSourceId) => void;
  onSave: (
    id: CustomDownloadSourceConfig["id"],
    name: string,
    url: string
  ) => boolean;
  onRemove: (id: DownloadSourceId) => boolean;
  dictionary: SiteDictionary;
}) {
  const copy = dictionary.settings;
  const sourceCopy = dictionary.downloads.sourcePicker;
  const probe = useDownloadsStore(
    (state) => state.sourceProbes[source.id] ?? IDLE_DOWNLOAD_SOURCE_PROBE
  );
  const [name, setName] = React.useState(source.name);
  const [url, setUrl] = React.useState(source.baseUrl);
  const [invalid, setInvalid] = React.useState(false);

  const liveSource = getDownloadSource(source.id, source.baseUrl, source.name);
  const status = downloadSourceStatusText(liveSource, probe, sourceCopy);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const saved = onSave(source.id, name, url);
        setInvalid(!saved);
      }}
      className={cn(
        "space-y-3 rounded-xl border p-3 transition-colors",
        selected
          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/15"
          : "border-border bg-card/40"
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(source.id)}
        className="flex w-full items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <SelectionDot selected={selected} />
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            downloadSourceStatusClass(liveSource, probe)
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {source.name}
        </span>
        <Badge variant="outline">{sourceCopy.badges.custom}</Badge>
        <span className="shrink-0 text-xs text-muted-foreground">
          {status}
        </span>
      </button>

      <SourceFields
        name={name}
        url={url}
        onNameChange={(value) => {
          setName(value);
          setInvalid(false);
        }}
        onUrlChange={(value) => {
          setUrl(value);
          setInvalid(false);
        }}
        invalid={invalid}
        dictionary={dictionary}
      />
      {invalid ? (
        <p role="alert" className="text-xs text-destructive">
          {copy.invalidCustomSource}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={copy.removeCustomSource(source.name)}
          title={copy.removeCustomSource(source.name)}
          onClick={() => onRemove(source.id)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2Icon data-icon="inline-start" />
          {copy.removeCustomSource(source.name)}
        </Button>
        <Button type="submit" size="sm">
          <SaveIcon data-icon="inline-start" />
          {copy.saveCustomSource}
        </Button>
      </div>
    </form>
  );
}

function SourceFields({
  name,
  url,
  onNameChange,
  onUrlChange,
  invalid,
  dictionary,
}: {
  name: string;
  url: string;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  invalid: boolean;
  dictionary: SiteDictionary;
}) {
  const copy = dictionary.settings;
  const nameId = React.useId();
  const urlId = React.useId();
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.3fr)]">
      <label htmlFor={nameId} className="space-y-1.5">
        <span className="block text-xs font-medium">{copy.sourceNameLabel}</span>
        <Input
          id={nameId}
          value={name}
          maxLength={48}
          placeholder={copy.sourceNamePlaceholder}
          aria-invalid={invalid || undefined}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <label htmlFor={urlId} className="space-y-1.5">
        <span className="block text-xs font-medium">{copy.sourceUrlLabel}</span>
        <Input
          id={urlId}
          type="url"
          value={url}
          placeholder={copy.sourceUrlPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          onChange={(event) => onUrlChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function SourceChoice({
  source,
  selected,
  onSelect,
  dictionary,
  lockedLabel,
}: {
  source: DownloadSource;
  selected: boolean;
  onSelect: (id: DownloadSourceId) => void;
  dictionary: SiteDictionary;
  lockedLabel: string;
}) {
  const sourceCopy = dictionary.downloads.sourcePicker;
  const probe = useDownloadsStore(
    (state) => state.sourceProbes[source.id] ?? IDLE_DOWNLOAD_SOURCE_PROBE
  );
  const option = downloadSourceCopy(source, sourceCopy);
  const status = downloadSourceStatusText(source, probe, sourceCopy);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(source.id)}
      className={cn(
        "flex w-full items-start gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/15"
          : "border-border bg-card/40 hover:bg-accent/50"
      )}
    >
      <SelectionDot selected={selected} />
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          downloadSourceStatusClass(source, probe)
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{option.name}</span>
          <Badge
            variant={source.role === "primary" ? "secondary" : "outline"}
          >
            {downloadSourceBadge(source, sourceCopy)}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {status}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {option.description}
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <LockKeyholeIcon className="size-3" aria-hidden="true" />
          {lockedLabel}
        </span>
      </span>
    </button>
  );
}

function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
        selected ? "border-primary bg-primary" : "border-muted-foreground/50"
      )}
    >
      {selected ? (
        <span className="size-1.5 rounded-full bg-primary-foreground" />
      ) : null}
    </span>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&>svg]:size-4">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function SettingsField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{label}</h3>
      {children}
    </div>
  );
}

function choiceClass(active: boolean): string {
  return cn(
    "flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0",
    active
      ? "border-primary/50 bg-primary/10 text-foreground ring-1 ring-primary/15"
      : "border-border bg-card/40 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
  );
}
