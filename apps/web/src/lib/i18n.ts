export const locales = ["zh", "en", "ja"] as const;

export type Locale = (typeof locales)[number];
export type SiteLocale = Locale;
export type PrefixedLocale = Exclude<Locale, "zh">;

export const defaultLocale: Locale = "zh";
export const prefixedLocales = locales.filter(
  (locale): locale is PrefixedLocale => locale !== defaultLocale
);

export type SiteDictionary = {
  localeLabel: string;
  /**
   * The archive's name in this locale. Single source of truth for the metadata
   * title suffix, og:site_name, the header lockup and the manifest — four
   * places that had each hardcoded a different name.
   */
  siteName: string;
  nav: {
    home: string;
    browse: string;
    skipToContent: string;
    primaryLabel: string;
    languageLabel: string;
    menuLabel: string;
    moreLabel: string;
    randomLabel: string;
    searchLabel: string;
  };
  language: {
    zh: string;
    en: string;
    ja: string;
  };
  theme: {
    toggleLabel: string;
    light: string;
    dark: string;
    system: string;
  };
  motionToggle: {
    label: string;
    enabledHint: string;
  };
  settings: {
    open: string;
    title: string;
    description: string;
    close: string;
    appearanceTitle: string;
    appearanceDescription: string;
    languageLabel: string;
    themeLabel: string;
    accentLabel: string;
    accents: {
      blue: string;
      violet: string;
      teal: string;
      orange: string;
      rose: string;
    };
    motionLabel: string;
    motion: {
      system: string;
      on: string;
      off: string;
    };
    motionHints: {
      system: string;
      on: string;
      off: string;
    };
    downloadsTitle: string;
    downloadsDescription: string;
    defaultSourceLabel: string;
    refreshLatency: string;
    builtInLabel: string;
    builtInLocked: string;
    customSourcesLabel: string;
    noCustomSources: string;
    addCustomSource: string;
    sourceNameLabel: string;
    sourceNamePlaceholder: string;
    sourceUrlLabel: string;
    sourceUrlPlaceholder: string;
    saveCustomSource: string;
    removeCustomSource: (name: string) => string;
    invalidCustomSource: string;
    customSourceHint: string;
    defaultFormatLabel: string;
    formatHelp: string;
    formats: {
      adx: string;
      zip: string;
      "tar.gz": string;
    };
    batchGroupingLabel: string;
    batchGroupingHelp: string;
    batchGroupings: {
      version: { name: string; description: string };
      genre: { name: string; description: string };
    };
  };
  home: {
    badge: string;
    /** Visible homepage hero copy; kept separate from the SEO page title. */
    heroTitle: string;
    /** Locale-specific phrase that should stay intact when the hero title wraps. */
    heroTitleNoBreak?: string;
    heroDescription: string;
    title: string;
    description: string;
    searchCta: string;
    /** Rotating placeholder examples; one per field the fuzzy search matches on. */
    searchExamples: string[];
    browseCta: string;
    getAppCta: string;
    /** Onboarding page (/guide) shortcut. */
    guideCta: string;
    /** Bilibili walkthrough of importing a downloaded .adx. */
    importVideoCta: string;
    videoCta: string;
    randomCta: string;
    whatIsAstroDX: string;
    heroActionsLabel: string;
    quickGenresLabel: string;
    genresDescription: string;
    /** Accessible name for the hero search's instant-suggestion listbox. */
    searchSuggestionsLabel: string;
    spotlightLabel: string;
    spotlightCarouselRole: string;
    spotlightSlideRole: string;
    spotlightPrevious: string;
    spotlightNext: string;
    spotlightPause: string;
    spotlightResume: string;
    featuredTitle: string;
    featuredDescription: string;
    viewMore: string;
    tagline: string;
    entriesBadge: (count: number) => string;
    metricsTotal: string;
    metricsCategories: string;
    metricsVersions: string;
    metricsArtists: string;
    metricsUpdated: string;
    branchesTitle: string;
    branchesDescription: string;
    versionsCta: string;
    latestTitle: string;
    latestDescription: string;
    openDetail: string;
    pipelineTitle: string;
    pipelineDescription: string;
    pipelineBadge: string;
    staticTitle: string;
    staticDescription: string;
    staticBadge: string;
    downloadsTitle: string;
    downloadsDescription: string;
    downloadsBadge: string;
    faqHeading: string;
    /**
     * `id` is the stable fragment each question answers to. It is part of the
     * dictionary rather than derived from the question text so a reworded
     * question (or a locale switch) never breaks a link someone already shared.
     */
    faq: (
      total: number,
      versions: number
    ) => { id: string; q: string; a: string }[];
    /** Fragment the hero's "what is AstroDX?" shortcut jumps to. */
    faqEntryId: string;
  };
  charts: {
    title: string;
    description: string;
    intro: (count: number, versions: number) => string;
  };
  statusPage: {
    // The in-site status page was removed; `title` labels the external monitor
    // link in the nav/footer, and `loading` doubles as the generic route-loading
    // skeleton label (see app/(default)/loading.tsx).
    title: string;
    loading: string;
  };
  catalogBrowser: {
    searchPlaceholder: string;
    /** Accessible name for the browse search box and its `role="search"` landmark. */
    searchLabel: string;
    randomChart: string;
    allCategories: string;
    allSubcategories: string;
    allGenres: string;
    /** Prefix shown on a result card when the query matched a song alias (别名), not its title. */
    aliasMatchLabel: string;
    /** Corner marker on a chart card the archive imported in the last two weeks. */
    newBadge: string;
    newBadgeHint: string;
    details: string;
    download: string;
    source: string;
    emptyState: string;
    clearSearch: string;
    clearFilters: string;
    activeFiltersLabel: string;
    removeFilter: (label: string) => string;
    advancedFilters: string;
    filterAll: string;
    filterVersion: string;
    filterLevel: string;
    filterGenre: string;
    filterCabinet: string;
    filterBpm: string;
    filterAssets: string;
    filterDesigner: string;
    /** Placeholder inside the charter combobox (hundreds of names, so it is typed into). */
    designerSearchPlaceholder: string;
    designerListLabel: string;
    designerNoMatch: string;
    /** Accessible name for a filter chip that also shows its facet count. */
    chipCountLabel: (label: string, count: number) => string;
    /** Sort picker in the results toolbar. */
    sortLabel: string;
    sortOptions: {
      default: string;
      imported: string;
      "level-desc": string;
      "level-asc": string;
      "bpm-desc": string;
      "bpm-asc": string;
      "title-asc": string;
    };
    /** Lead-in above the "drop one filter" buttons in the empty state. */
    emptySuggestionsTitle: string;
    /** One such button: dropping this dimension would leave `count` charts. */
    dropFilterSuggestion: (label: string, count: number) => string;
    /** Dimension name for the search query itself, used by the suggestions above. */
    filterSearch: string;
    cabinetStandard: string;
    cabinetUtage: string;
    assetHasPv: string;
    assetNoPv: string;
    resultsSummary: (count: number) => string;
    previousPage: string;
    nextPage: string;
    goToPage: (page: number) => string;
    pageLabel: (current: number, total: number) => string;
    rangeLabel: (start: number, end: number, total: number) => string;
    selectMode: string;
    exitSelectMode: string;
    selectAll: string;
    selectAllFiltered: (count: number) => string;
    selectAllVersions: (count: number) => string;
    clearSelection: string;
    selectedCount: (count: number) => string;
    batchDownload: string;
    batchDefaultName: string;
    /** Accessible name for the difficulty-level filter select. */
    levelFilterLabel: string;
    allLevels: string;
    levelOption: (level: string) => string;
    /** Thumb labels on the level/BPM range sliders. */
    rangeMin: string;
    rangeMax: string;
    /** Applied-filter chip for a level / BPM span. */
    levelRangeLabel: (low: string, high: string) => string;
    bpmRangeLabel: (low: number, high: number) => string;
    /** Shown while the batch download manifest loads after entering select mode. */
    specsLoading: string;
    specsError: string;
  };
  detail: {
    onsiteDownload: string;
    onsitePending: string;
    downloadFormatLabel: string;
    downloadFormatRecommended: string;
    /** Caption on the .adx format item explaining what the format is for. */
    formatHintAdx: string;
    downloadIncludeVideo: string;
    downloadPreparing: string;
    downloadPacking: (completed: number, total: number) => string;
    downloadSuccess: string;
    downloadErrorPrefix: string;
    sourceLink: string;
    metadata: string;
    metadataDescription: string;
    difficulties: string;
    source: string;
    sourceDescription: string;
    /** Accessible name for the chart-detail breadcrumb nav. */
    breadcrumbLabel: string;
    versionLabel: string;
    genreLabel: string;
    bpmLabel: string;
    /** Wraps a BPM span for the 174 charts that change tempo mid-song. */
    bpmVariableLabel: (range: string) => string;
    durationLabel: string;
    shortIdLabel: string;
    aliasesLabel: string;
    unknownValue: string;
    notAvailableValue: string;
    tableDifficulty: string;
    tableLevel: string;
    tableCharter: string;
    tableNotes: string;
    /** Judged-object buckets shown under a difficulty's note total. */
    noteTypeTap: string;
    noteTypeHold: string;
    noteTypeSlide: string;
    noteTypeTouch: string;
    noteTypeTouchHold: string;
    noteTypeBreak: string;
    /** Sidebar card carrying the measured note / duration / size numbers. */
    statsTitle: string;
    statsDescription: string;
    statsNotesLabel: string;
    statsDownloadLabel: string;
    /** Size quoted before a download starts; always an estimate (zip overhead). */
    sizeEstimate: (size: string) => string;
    sizeEstimateWithVideo: (total: string, video: string) => string;
    /** Source card: the maidata path row and the collapsed license note. */
    sourceMaidataLabel: string;
    licenseLabel: string;
    /** Level chip legend on the difficulty table (display level vs 定数). */
    levelConstantHint: string;
    preview: string;
    previewDescription: string;
    /** Accessible name for the row of secondary chart actions. */
    actionsLabel: string;
    chartPreview: string;
    chartPreviewDescription: string;
    /** Opens the preview already switched to one difficulty (from the table). */
    chartPreviewAt: (difficulty: string) => string;
    pvLabel: string;
    audioLabel: string;
    mediaUnsupported: string;
    volumeLabel: string;
    muteLabel: string;
    comments: string;
    relatedTitle: string;
    relatedDescription: string;
    /** Chip on a related card explaining why it was picked (shared artist/genre/version). */
    relatedReasonArtist: string;
    relatedReasonGenre: string;
    relatedReasonVersion: string;
    commentsLoading: string;
    commentsError: string;
    commentsRetry: string;
    share: string;
    shareCopied: string;
  };
  /** Floating tray that keeps download progress visible after navigating between pages. */
  downloads: {
    sourcePicker: {
      label: string;
      options: {
        r2: { name: string; description: string };
        alice: { name: string; description: string };
        tsumugi: { name: string; description: string };
        awmc: { name: string; description: string };
        g510: { name: string; description: string };
        g400s: { name: string; description: string };
        custom: { name: string; description: string };
      };
      statuses: {
        available: string;
        degraded: string;
        maintenance: string;
      };
      probe: {
        idle: string;
        testing: string;
        timeout: string;
        unavailable: string;
        unconfigured: string;
      };
      badges: {
        primary: string;
        backup: string;
        custom: string;
      };
      customUrlLabel: string;
      customUrlPlaceholder: string;
      customSaveAndTest: string;
      customReset: string;
      customHint: string;
      customInvalid: string;
      manageInSettings: string;
      switchAndRestart: string;
      restartHint: string;
    };
    trayTitle: string;
    dismiss: string;
    resume: string;
    cancel: string;
    paused: string;
    pause: string;
    /** Job accepted but waiting for a download slot. */
    queued: string;
    /** Roll-up shown by a batch surface that started several queued jobs. */
    queueSummary: (done: number, total: number) => string;
    collapse: string;
    expand: string;
    jobsCount: (count: number) => string;
    archiving: string;
    completed: string;
    importHint: string;
    confirmDiscard: string;
    errorOffline: string;
    errorNetwork: string;
    errorGeneric: string;
    batchSummary: (charts: number, files: number) => string;
    batchSplitSummary: (archives: number) => string;
    batchSplitSummaryGenre: (archives: number) => string;
    groupingLabel: string;
    groupingVersion: string;
    groupingGenre: string;
    batchVideoSummary: (count: number) => string;
    batchNoVideoSummary: string;
    batchVideoLargeHint: string;
    batchConfirm: (count: number, includeVideo: boolean) => string;
    batchConfirmStart: string;
    /** Remaining time at the smoothed transfer rate, e.g. "剩余 1:20". */
    etaRemaining: (clock: string) => string;
    errorMissing: string;
    errorServer: string;
    errorDetailLabel: string;
    copyDetail: string;
    copiedDetail: string;
    skippedTitle: string;
    skippedSummary: (count: number) => string;
    autoSwitched: (name: string) => string;
    autoResumed: (count: number) => string;
    /** Shown once a checkpoint write failed: resume-after-reload is gone. */
    checkpointsUnavailable: string;
    storageTight: (available: string) => string;
    storageInsufficient: (available: string, required: string) => string;
    historyTitle: string;
    historyDescription: string;
    historyEmpty: string;
    historyRerun: string;
    historyClear: string;
    historyEntrySummary: (files: number) => string;
  };
  /** In-browser playable chart preview player on chart detail pages. */
  preview: {
    loading: string;
    loadFailedTitle: string;
    loadFailedBody: string;
    retry: string;
    audioFailedBody: string;
    playWithoutAudio: string;
    audioLoading: string;
    canvasLabel: (title: string) => string;
    keyboardHint: string;
    prevMeasure: string;
    prevPosition: string;
    play: string;
    pause: string;
    nextPosition: string;
    nextMeasure: string;
    replayMeasure: string;
    progress: string;
    soundOn: string;
    soundOff: string;
    settings: string;
    fullscreen: string;
    exitFullscreen: string;
    lockUi: string;
    unlockUi: string;
    rotateView: (currentDeg: number) => string;
    copyFrame: string;
    copyTimeUrl: string;
    exportMenu: string;
    shareFrame: string;
    saveFrame: string;
    gifCancel: string;
    gifRangeHint: (duration: string) => string;
    /** GIF export is capped at 15 s; a loop range may legitimately be longer. */
    gifRangeTooLong: (max: string) => string;
    exportGif: string;
    /** A–B repeat over the range the GIF handles already select. */
    loopRange: string;
    loopRangeOff: string;
    loopActiveHint: (duration: string) => string;
    /** Speed panel toggle, reachable without leaving fullscreen. */
    speedPanel: string;
    /** HUD text the engine paints into the canvas (and into exported GIFs). */
    hudCombo: string;
    hudBreakNoEx: string;
    hudNoteTotalToggle: string;
    hudBreakCountToggle: string;
    exportingPercent: (percent: number) => string;
    cancel: string;
    gifExportedTitle: string;
    gifExportedBody: string;
    gifFailedTitle: string;
    gifFailedBody: string;
    frameSavedTitle: string;
    frameSavedBody: string;
    frameFailedTitle: string;
    frameFailedBody: string;
    copiedTitle: string;
    copiedBody: string;
    copyFailedTitle: string;
    copyFailedBody: string;
    simaiTitle: string;
    resumeAutoScroll: string;
    legendLabel: string;
    noteTap: string;
    noteHold: string;
    noteSlide: string;
    noteTouch: string;
    noteBreak: string;
  };
  assets: {
    audio: string;
    jacket: string;
    pv: string;
    dxChart: string;
  };
  cover: {
    alt: (title: string) => string;
    placeholder: string;
  };
  footer: {
    description: string;
    lastUpdated: (date: string) => string;
    disclaimer: string;
    aiNotice: string;
    mitLicense: { before: string; link: string; after: string };
    sourceLabel: string;
    getAppLabel: string;
    navLabel: string;
  };
  pageViews: {
    siteViews: string;
    siteVisitors: string;
    pageViews: string;
    /** Compact label for the read-only count chip on browse cards. */
    views: string;
    /** Screen-reader fallback announced when the counter backend is unreachable. */
    unavailable: string;
  };
  versions: {
    title: string;
    description: string;
    navLabel: string;
    backToIndex: string;
    intro: (count: number) => string;
    chartCount: (count: number) => string;
    unknownLabel: string;
    detailTitle: (label: string) => string;
    detailIntro: (label: string, count: number) => string;
    selectedVersionsCount: (count: number) => string;
  };
  guestbook: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    /** Hand-off of a /post or /survey draft into the Artalk composer. */
    prefill: {
      pending: string;
      success: string;
      failedTitle: string;
      failedBody: string;
      draftLabel: string;
      copy: string;
      copied: string;
    };
  };
  links: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    // Same template rationale as community.join: ja reads 「MaiViewer にアクセス」.
    visitLink: (name: string) => string;
  };
  community: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    // Card aria-label CTA. A template (not a "verb + name" concat) so ja can
    // put the object first: 「QQ グループに参加」.
    join: (name: string) => string;
  };
  donate: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    // Same template rationale as community.join: ja reads 「爱发电を開く」.
    open: (name: string) => string;
    viewOnExplorer: string;
    addressTitle: string;
    addressDescription: string;
    copyAddress: string;
    copied: string;
    thanks: string;
  };
  resources: {
    official: string;
    wiki: string;
    video: string;
    cloudDrive: string;
    netDisk: string;
  };
  about: {
    navLabel: string;
    title: string;
    description: string;
  };
  /** Nav/footer label for /license; the page's own long-form copy lives in license-view.tsx. */
  license: {
    navLabel: string;
  };
  /** Long-form onboarding page (/guide): install, download, import, fix. */
  guide: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    /** Accessible name for the in-page section jump list. */
    tocLabel: string;
  };
  /** Browsable entry point for the global music player's per-version playlists. */
  music: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    trackCount: (count: number) => string;
    // Same template rationale as community.join: ja reads 「maimai DX を再生」.
    playVersion: (name: string) => string;
    empty: string;
  };
  /** Dated import batches (/changelog). */
  changelog: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    batchHeading: (date: string) => string;
    batchCount: (count: number) => string;
    /** Link that replaces the charts a large batch's preview leaves out. */
    viewRest: (count: number) => string;
    versionsLabel: string;
    versionLink: (name: string, count: number) => string;
    /** Trailing link when a batch spans more versions than the row lists. */
    moreVersions: (count: number) => string;
    empty: string;
  };
  post: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    songTitleLabel: string;
    songTitlePlaceholder: string;
    sourceLabel: string;
    sourcePlaceholder: string;
    notesLabel: string;
    notesPlaceholder: string;
    requiredHint: string;
    /** Per-field message, linked by aria-describedby so the error names its field. */
    songTitleRequired: string;
    sourceRequired: string;
    submit: string;
    submitting: string;
    composedTitle: string;
  };
  survey: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
    selectPlaceholder: string;
    platformLabel: string;
    platformOptions: { value: string; label: string }[];
    discoverLabel: string;
    discoverPlaceholder: string;
    satisfactionLabel: string;
    satisfactionOptions: { value: string; label: string }[];
    wishLabel: string;
    wishPlaceholder: string;
    otherLabel: string;
    otherPlaceholder: string;
    requiredHint: string;
    platformRequired: string;
    satisfactionRequired: string;
    submit: string;
    submitting: string;
    composedTitle: string;
  };
  notFound: {
    title: string;
    description: string;
    backHome: string;
    browseCharts: string;
    /** A mistyped CJK slug is the likeliest way to land here, so the page searches. */
    searchLabel: string;
    searchSubmit: string;
  };
  /** Client-side crash screen rendered by the App Router `error.tsx` boundaries. */
  errorPage: {
    title: string;
    description: string;
    retry: string;
    backHome: string;
    browseCharts: string;
    detailsLabel: string;
  };
  /** Connectivity bar driven by the online/offline events. */
  connection: {
    offline: string;
    restored: string;
  };
  offline: {
    title: string;
    description: string;
    retry: string;
    backHome: string;
  };
  /** One-line bar offering to continue in the visitor's preferred language (no auto-redirect). */
  localeBanner: {
    continueIn: string;
    dismiss: string;
  };
  /**
   * Long-form SEO meta descriptions (~150 chars), kept separate from the short
   * on-page `description` subtitles. Consumed only by the metadata builders so
   * crawlers get a rich summary while the visible UI stays concise.
   */
  seo: {
    home: string;
    charts: string;
    versions: string;
    versionDetail: (label: string, count: number) => string;
    guestbook: string;
    links: string;
    community: string;
    donate: string;
    about: string;
    guide: string;
    music: string;
    changelog: string;
    post: string;
    survey: string;
  };
};

export type StaticPageMetadataKey = "home" | "charts";
export type StaticPageMetadataEntry = {
  pathname: "/" | "/charts";
  title: string;
  description: string;
  keywords: string[];
};

const dictionaries: Record<Locale, SiteDictionary> = {
  zh: {
    localeLabel: "中文",
    siteName: "ADX 谱面资源",
    nav: {
      home: "首页",
      browse: "曲库",
      skipToContent: "跳到主要内容",
      primaryLabel: "主导航",
      languageLabel: "语言切换",
      menuLabel: "导航菜单",
      moreLabel: "更多",
      randomLabel: "随机",
      searchLabel: "搜索",
    },
    language: { zh: "中文", en: "English", ja: "日本語" },
    theme: { toggleLabel: "切换主题", light: "浅色", dark: "深色", system: "跟随系统" },
    motionToggle: { label: "减弱动画", enabledHint: "恢复动画" },
    settings: {
      open: "打开设置",
      title: "设置",
      description: "统一管理显示偏好、下载格式和下载线路。设置仅保存在当前设备。",
      close: "关闭设置",
      appearanceTitle: "外观与体验",
      appearanceDescription: "调整语言、明暗模式、界面强调色和动画。",
      languageLabel: "界面语言",
      themeLabel: "明暗模式",
      accentLabel: "主题强调色",
      accents: {
        blue: "蓝色",
        violet: "紫色",
        teal: "青绿色",
        orange: "橙色",
        rose: "玫红色",
      },
      motionLabel: "动画",
      motion: {
        system: "跟随系统",
        on: "开启动画",
        off: "减少动画",
      },
      motionHints: {
        system: "遵循设备的“减少动态效果”设置",
        on: "始终播放界面动画",
        off: "关闭非必要动画和过渡",
      },
      downloadsTitle: "下载",
      downloadsDescription: "选择默认格式和线路；下载任务开始后会保留当时的配置。",
      defaultSourceLabel: "默认下载线路",
      refreshLatency: "重新测速",
      builtInLabel: "内置",
      builtInLocked: "内置线路不可删除",
      customSourcesLabel: "自定义线路",
      noCustomSources: "尚未添加自定义线路。",
      addCustomSource: "添加线路",
      sourceNameLabel: "线路名称",
      sourceNamePlaceholder: "例如：我的镜像",
      sourceUrlLabel: "线路地址",
      sourceUrlPlaceholder: "https://mirror.example.com",
      saveCustomSource: "保存并测速",
      removeCustomSource: (name) => `删除线路“${name}”`,
      invalidCustomSource: "请填写名称和有效的 HTTPS 地址；本机开发地址可使用 HTTP。",
      customSourceHint: "镜像需保持与内置线路相同的目录结构，并允许跨域下载。",
      defaultFormatLabel: "默认下载格式",
      formatHelp: "下载按钮会直接使用此格式，菜单中仍可仅为本次下载临时选择其他格式。",
      formats: {
        adx: "AstroDX 导入格式（推荐）",
        zip: "通用 ZIP 压缩包",
        "tar.gz": "TAR.GZ 压缩包",
      },
      batchGroupingLabel: "批量下载分类路径",
      batchGroupingHelp:
        "决定批量下载时谱面在压缩包内的文件夹层级；选择跨越多个分类时，会按该分类拆分为多个压缩包。已开始的任务保持开始时的分类方式。",
      batchGroupings: {
        version: { name: "按版本", description: "如「25 CiRCLE」" },
        genre: { name: "按曲风", description: "如「東方Project」" },
      },
    },
    home: {
      badge: "为 AstroDX 玩家打造",
      heroTitle: "为 AstroDX 找到下一首谱面。",
      heroTitleNoBreak: "找到下一首谱面。",
      heroDescription: "搜索、试玩并下载社区谱面，按版本与曲风浏览，再一键导入 AstroDX。",
      title: "AstroDX 谱面资料站与下载入口。",
      description:
        "搜索、试玩并下载 maimai 谱面，一键导入 AstroDX 模拟器。可按版本与曲风浏览，也支持整包批量下载。",
      searchCta: "搜索曲库",
      searchExamples: ["PANDORA PARADOXXX", "潘多拉", "sasakure.UK", "niconico＆VOCALOID", "系ぎて"],
      browseCta: "浏览版本",
      getAppCta: "获取 AstroDX",
      guideCta: "上手指南",
      importVideoCta: "谱面导入教程",
      videoCta: "观看演示视频",
      randomCta: "随机来一首",
      whatIsAstroDX: "什么是 AstroDX？",
      heroActionsLabel: "快捷入口",
      quickGenresLabel: "按曲风浏览",
      genresDescription: "按曲风快速筛选目录，直接进入对应分类的谱面。",
      searchSuggestionsLabel: "搜索建议",
      spotlightLabel: "今日精选",
      spotlightCarouselRole: "轮播",
      spotlightSlideRole: "精选谱面",
      spotlightPrevious: "上一首精选",
      spotlightNext: "下一首精选",
      spotlightPause: "暂停自动轮播",
      spotlightResume: "继续自动轮播",
      featuredTitle: "随机精选",
      featuredDescription: "随目录更新轮换的随机推荐，发现冷门好谱。",
      viewMore: "查看更多",
      tagline: "资料与下载入口",
      entriesBadge: (count) => `${count} 条目`,
      metricsTotal: "收录谱面",
      metricsCategories: "分类数",
      metricsVersions: "版本数",
      metricsArtists: "曲师数",
      metricsUpdated: "目录更新",
      branchesTitle: "按版本浏览",
      branchesDescription: "从 maimai 初代到最新版本，挑一个版本开始浏览。",
      versionsCta: "查看全部版本",
      latestTitle: "最新谱面",
      latestDescription: "最近索引的远端谱面及其封面。",
      openDetail: "查看详情",
      pipelineTitle: "数据管线",
      pipelineDescription: "远端目录扫描、maidata 解析与静态目录生成。",
      pipelineBadge: "远端索引构建",
      staticTitle: "静态输出",
      staticDescription: "Next.js 16 静态导出，便于静态托管部署。",
      staticBadge: "Bun + Turbopack",
      downloadsTitle: "下载",
      downloadsDescription: "依据构建时检测到的远端目录内容生成下载操作。",
      downloadsBadge: "远端目录驱动",
      faqHeading: "常见问题",
      faq: (total, versions) => [
        {
          id: "what-is-astrodx",
          q: "AstroDX 是什么？",
          a: "AstroDX 是一款社区开发的 maimai 风格音乐游戏模拟器。本站「ADX 谱面资源」收录 AstroDX 谱面，提供元数据、封面与下载链接，是非官方的资料站。",
        },
        {
          id: "what-is-maimai-dx",
          q: "maimai DX 是什么？",
          a: "maimai DX 是 SEGA 的街机音乐游戏，AstroDX 谱面还原其玩法。本目录按 FESTiVAL、PRiSM、BUDDiES、UNiVERSE 等 maimai DX 版本归类谱面。",
        },
        {
          id: "how-to-download",
          q: "如何下载谱面？",
          a: "打开任意谱面的详情页，使用站内下载按钮即可获取从远端 AstroDX 目录构建的谱面文件包。",
        },
        {
          id: "how-to-import",
          q: "如何将谱面导入 AstroDX？",
          a: "本站下载到的 .adx 可以直接导入，无需解压。iOS：在「文件」App 里把 .adx 移动到 AstroDX 文件夹本身（不要放进里面的 levels）。Android：点一下 .adx，用 AstroDX 打开，或长按「分享 → AstroDX」。导入前记得先启动过一次游戏。完整步骤见上手指南。",
        },
        {
          id: "catalog-size",
          q: "目录收录了多少谱面？",
          a: `目前共收录 ${total} 首谱面，覆盖 ${versions} 个 maimai DX 版本分支，并会随远端目录持续更新。`,
        },
      ],
      faqEntryId: "what-is-astrodx",
    },
    charts: {
      title: "浏览曲目",
      description: "按分类、分支与显示语言浏览 AstroDX 目录条目。",
      intro: (count, versions) =>
        `本目录共收录 ${count} 首谱面，覆盖 ${versions} 个 maimai DX 版本分支，可按分类、分支与显示语言浏览。`,
    },
    statusPage: {
      title: "服务器状态",
      loading: "加载中",
    },
    catalogBrowser: {
      searchPlaceholder: "搜索曲名、别名、罗马音、曲师、谱师、版本...",
      searchLabel: "搜索谱面",
      randomChart: "随机谱面",
      allCategories: "全部分类",
      allSubcategories: "全部版本",
      allGenres: "全部曲风",
      aliasMatchLabel: "别名命中",
      newBadge: "新",
      newBadgeHint: "最近两周新收录",
      details: "详情",
      download: "下载",
      source: "来源",
      emptyState: "没有匹配到曲目，可以试试别名、罗马音或曲师名。",
      clearSearch: "清空搜索",
      clearFilters: "清除全部筛选",
      activeFiltersLabel: "已应用筛选",
      removeFilter: (label) => `移除筛选：${label}`,
      advancedFilters: "高级筛选",
      filterAll: "全部",
      filterVersion: "版本",
      filterLevel: "等级",
      filterGenre: "曲风",
      filterCabinet: "类型",
      filterBpm: "BPM",
      filterAssets: "资源",
      filterDesigner: "谱师",
      designerSearchPlaceholder: "输入谱师名筛选…",
      designerListLabel: "谱师候选",
      designerNoMatch: "没有匹配的谱师",
      chipCountLabel: (label, count) => `${label}（${count} 首）`,
      sortLabel: "排序",
      sortOptions: {
        default: "默认排序",
        imported: "最新收录",
        "level-desc": "难度 高→低",
        "level-asc": "难度 低→高",
        "bpm-desc": "BPM 高→低",
        "bpm-asc": "BPM 低→高",
        "title-asc": "曲名 A→Z",
      },
      emptySuggestionsTitle: "去掉一个条件试试：",
      dropFilterSuggestion: (label, count) => `去掉「${label}」筛选 → ${count} 首`,
      filterSearch: "搜索词",
      cabinetStandard: "标准",
      cabinetUtage: "宴会场",
      assetHasPv: "包含 BGA 视频",
      assetNoPv: "不含 BGA 视频",
      resultsSummary: (count) => `共 ${count} 首谱面`,
      previousPage: "上一页",
      nextPage: "下一页",
      goToPage: (page) => `第 ${page} 页`,
      pageLabel: (current, total) => `第 ${current} / ${total} 页`,
      rangeLabel: (start, end, total) => `显示 ${start}-${end} / 共 ${total} 条`,
      selectMode: "多选",
      exitSelectMode: "退出多选",
      selectAll: "全选当前结果",
      selectAllFiltered: (count) => `全选 ${count} 首结果`,
      selectAllVersions: (count) => `全选 ${count} 个版本`,
      clearSelection: "清空",
      selectedCount: (count) => `已选 ${count} 首`,
      batchDownload: "打包下载",
      batchDefaultName: "AstroDX Charts",
      levelFilterLabel: "等级筛选",
      allLevels: "全部等级",
      levelOption: (level) => `等级 ${level}`,
      rangeMin: "最低",
      rangeMax: "最高",
      levelRangeLabel: (low, high) => (low === high ? `等级 ${low}` : `等级 ${low}–${high}`),
      bpmRangeLabel: (low, high) => (low === high ? `BPM ${low}` : `BPM ${low}–${high}`),
      specsLoading: "正在加载下载清单…",
      specsError: "下载清单加载失败，请稍后重试。",
    },
    detail: {
      onsiteDownload: "站内下载",
      onsitePending: "站内下载待接入",
      downloadFormatLabel: "选择格式",
      downloadFormatRecommended: "推荐",
      formatHintAdx: "AstroDX 导入格式 · 推荐",
      downloadIncludeVideo: "包含 BGA 视频",
      downloadPreparing: "正在读取目录",
      downloadPacking: (completed, total) => `正在下载并打包（${completed}/${total}）`,
      downloadSuccess: "下载已开始",
      downloadErrorPrefix: "下载失败：",
      sourceLink: "来源链接",
      metadata: "谱面信息",
      metadataDescription: "直接解析自远端 AstroDX 目录资源。",
      difficulties: "难度列表",
      source: "来源信息",
      sourceDescription: "基于远端 AstroDX 目录索引构建。",
      breadcrumbLabel: "面包屑导航",
      versionLabel: "版本",
      genreLabel: "曲风",
      bpmLabel: "BPM",
      bpmVariableLabel: (range) => `${range}（变速）`,
      durationLabel: "时长",
      shortIdLabel: "短 ID",
      aliasesLabel: "别名",
      unknownValue: "未知",
      notAvailableValue: "暂无",
      tableDifficulty: "难度",
      tableLevel: "等级",
      tableCharter: "谱师",
      tableNotes: "物量",
      noteTypeTap: "Tap",
      noteTypeHold: "Hold",
      noteTypeSlide: "Slide",
      noteTypeTouch: "Touch",
      noteTypeTouchHold: "Touch Hold",
      noteTypeBreak: "Break",
      statsTitle: "谱面数据",
      statsDescription: "构建时解析 maidata 得到的物量、时长与文件体积。",
      statsNotesLabel: "最高物量",
      statsDownloadLabel: "下载体积",
      sizeEstimate: (size) => `约 ${size}`,
      sizeEstimateWithVideo: (total, video) => `约 ${total}（含 BGA ${video}）`,
      sourceMaidataLabel: "谱面文件",
      licenseLabel: "授权说明",
      levelConstantHint: "加粗为显示等级，浅色数字为定数。",
      preview: "预览",
      previewDescription: "在线观看 PV 或试听音频（资源来自远端目录）。",
      actionsLabel: "谱面操作",
      chartPreview: "谱面预览",
      chartPreviewDescription: "在浏览器中播放谱面，与音频同步。",
      chartPreviewAt: (difficulty) => `预览 ${difficulty} 难度`,
      pvLabel: "PV 影像",
      audioLabel: "音频试听",
      mediaUnsupported: "你的浏览器不支持播放该媒体。",
      volumeLabel: "音量",
      muteLabel: "静音",
      comments: "评论",
      relatedTitle: "相关谱面",
      relatedDescription: "来自相同曲师、曲风或版本的更多谱面。",
      relatedReasonArtist: "同曲师",
      relatedReasonGenre: "同曲风",
      relatedReasonVersion: "同版本",
      commentsLoading: "评论加载中…",
      commentsError: "评论加载失败，请检查网络连接后重试。",
      commentsRetry: "重试",
      share: "分享",
      shareCopied: "链接已复制",
    },
    downloads: {
      sourcePicker: {
        label: "下载线路",
        options: {
          r2: { name: "R2", description: "Cloudflare R2 主线路，默认选择" },
          alice: { name: "Alice", description: "Alice 下载分流" },
          tsumugi: { name: "Tsumugi", description: "Tsumugi 下载分流" },
          awmc: { name: "AWMC", description: "AWMC 下载分流" },
          g510: { name: "G510", description: "G510 下载分流" },
          g400s: { name: "G400s", description: "G400s 下载分流" },
          custom: { name: "自定义", description: "使用你自己的同结构镜像地址" },
        },
        statuses: {
          available: "可用",
          degraded: "拥挤",
          maintenance: "维护中",
        },
        probe: {
          idle: "-- ms",
          testing: "测速中…",
          timeout: "超时",
          unavailable: "不可用",
          unconfigured: "未配置",
        },
        badges: {
          primary: "推荐",
          backup: "备用",
          custom: "自定义",
        },
        customUrlLabel: "自定义线路地址",
        customUrlPlaceholder: "https://mirror.example.com",
        customSaveAndTest: "保存并测速",
        customReset: "恢复 R2",
        customHint: "仅保存在本机；镜像需保持相同目录结构并允许跨域下载。",
        customInvalid: "请输入有效的 HTTPS 地址（本机开发可用 HTTP），且不要包含账号、查询参数或锚点。",
        manageInSettings: "可在右上角设置中添加和管理自定义线路。",
        switchAndRestart: "换线路继续",
        restartHint: "切换线路后，已完成文件会保留；未完成文件将通过新线路从头下载。",
      },
      trayTitle: "下载",
      dismiss: "关闭",
      resume: "继续",
      cancel: "取消",
      paused: "已暂停",
      pause: "暂停",
      queued: "排队中，等待前面的任务",
      queueSummary: (done, total) => `已完成 ${done} / ${total} 个下载任务`,
      collapse: "收起下载列表",
      expand: "展开下载列表",
      jobsCount: (count) => `${count} 个下载任务`,
      archiving: "正在打包归档…",
      completed: "打包完成，已保存到浏览器下载",
      importHint: "将文件导入 AstroDX 即可游玩（.adx 可直接导入）。",
      confirmDiscard: "再点一次将放弃已下载的数据",
      errorOffline: "网络已断开；已完成文件会保留，联网后点「继续」下载剩余文件",
      errorNetwork: "下载失败；已完成文件会保留，可点「继续」重试剩余文件",
      errorGeneric: "下载出错；已完成文件会保留，可点「继续」重试剩余文件",
      batchSummary: (charts, files) => `将打包 ${charts} 首谱面，共 ${files} 个文件`,
      batchSplitSummary: (archives) =>
        `跨版本选择，将拆成 ${archives} 个下载任务加入队列，每个版本一个压缩包`,
      batchSplitSummaryGenre: (archives) =>
        `跨曲风选择，将拆成 ${archives} 个下载任务加入队列，每种曲风一个压缩包`,
      groupingLabel: "分类路径",
      groupingVersion: "按版本分文件夹",
      groupingGenre: "按曲风分文件夹",
      batchVideoSummary: (count) => `包含 ${count} 个 BGA 视频文件`,
      batchNoVideoSummary: "不包含 BGA 视频，下载会更轻",
      batchVideoLargeHint: "包含 BGA 会显著增大体积，网络慢或手机流量下建议关闭。",
      batchConfirm: (count, includeVideo) =>
        includeVideo
          ? `确认开始下载 ${count} 首谱面？当前包含 BGA 视频。`
          : `确认开始下载 ${count} 首谱面？`,
      batchConfirmStart: "确认开始",
      etaRemaining: (clock) => `剩余 ${clock}`,
      errorMissing: "服务器上没有这个文件；换条线路可能就有，重试同一条不会有变化",
      errorServer: "线路暂时故障；已完成文件会保留，可稍后重试或换线路",
      errorDetailLabel: "错误详情",
      copyDetail: "复制详情",
      copiedDetail: "已复制",
      skippedTitle: "已跳过的可选文件",
      skippedSummary: (count) => `跳过了 ${count} 个可选文件（封面或 BGA），谱面本体完整`,
      autoSwitched: (name) => `已自动切换到 ${name}`,
      autoResumed: (count) => `网络恢复，已自动继续 ${count} 个下载任务`,
      checkpointsUnavailable:
        "浏览器存储写入失败，本次下载不再支持刷新后续传；请保持页面打开直到完成。",
      storageTight: (available) => `设备可用存储仅剩约 ${available}，大批量下载可能中途失败。`,
      storageInsufficient: (available, required) =>
        `设备可用存储约 ${available}，不足以完成约 ${required} 的下载，请先清理空间或减少选择。`,
      historyTitle: "最近下载",
      historyDescription: "已完成的下载会保留在本机，可一键重新下载同一批谱面。",
      historyEmpty: "还没有已完成的下载记录。",
      historyRerun: "重新下载",
      historyClear: "清空记录",
      historyEntrySummary: (files) => `${files} 个文件`,
    },
    preview: {
      loading: "正在加载谱面…",
      loadFailedTitle: "谱面加载失败",
      loadFailedBody: "无法获取谱面数据，请检查网络后重试。",
      retry: "重试",
      audioFailedBody: "音频加载失败，可重试或直接无音频播放。",
      playWithoutAudio: "无音频播放",
      audioLoading: "正在加载音频…",
      canvasLabel: (title) => `谱面预览：${title}`,
      keyboardHint: "点击或聚焦播放器后可使用键盘快捷键。",
      prevMeasure: "上一小节",
      prevPosition: "上一位置",
      play: "播放",
      pause: "暂停",
      nextPosition: "下一位置",
      nextMeasure: "下一小节",
      replayMeasure: "重播当前小节",
      progress: "进度",
      soundOn: "开启判定音",
      soundOff: "关闭判定音",
      settings: "设置",
      fullscreen: "全屏",
      exitFullscreen: "退出全屏",
      lockUi: "锁定界面（跟打时防误触）",
      unlockUi: "解锁界面",
      rotateView: (currentDeg) => `旋转画面（当前 ${currentDeg}°，点按 +90°）`,
      copyFrame: "复制当前帧",
      copyTimeUrl: "复制当前时间点链接",
      exportMenu: "画面导出",
      shareFrame: "系统分享",
      saveFrame: "保存当前帧",
      gifCancel: "取消 GIF 导出",
      gifRangeHint: (duration) => `区间 ${duration}，拖动时间轴上的手柄调整`,
      gifRangeTooLong: (max) => `GIF 最长 ${max}，请缩短区间后再导出`,
      exportGif: "导出 GIF",
      loopRange: "A-B 循环",
      loopRangeOff: "关闭 A-B 循环",
      loopActiveHint: (duration) => `正在循环 ${duration} 区间`,
      speedPanel: "速度",
      hudCombo: "连击",
      hudBreakNoEx: "无保护",
      hudNoteTotalToggle: "画面内连击数",
      hudBreakCountToggle: "画面内绝赞数",
      exportingPercent: (percent) => `导出中 ${percent}%`,
      cancel: "取消",
      gifExportedTitle: "已导出",
      gifExportedBody: "GIF 已下载",
      gifFailedTitle: "导出失败",
      gifFailedBody: "GIF 生成出错",
      frameSavedTitle: "已保存",
      frameSavedBody: "当前帧已下载为 PNG",
      frameFailedTitle: "导出失败",
      frameFailedBody: "无法获取当前帧",
      copiedTitle: "已复制",
      copiedBody: "当前帧已复制到剪贴板",
      copyFailedTitle: "复制失败",
      copyFailedBody: "剪贴板不可用",
      simaiTitle: "Simai 语句",
      resumeAutoScroll: "恢复自动滚动",
      legendLabel: "音符类型",
      noteTap: "Tap",
      noteHold: "Hold",
      noteSlide: "Slide",
      noteTouch: "Touch",
      noteBreak: "Break",
    },
    assets: { audio: "音频", jacket: "封面图", pv: "PV", dxChart: "DX 谱面" },
    cover: {
      alt: (title) => `${title} 封面`,
      placeholder: "AstroDX 封面占位图",
    },
    footer: {
      description: "ADX 谱面资源，基于远端目录构建的非官方索引。",
      lastUpdated: (date) => `目录更新于 ${date}`,
      disclaimer: "非官方爱好者资料站。AstroDX 与 maimai 的相关权利归各自所有者所有。",
      aiNotice: "项目由 Claude 与 GPT 联合开发。所有内容均由人工智能生成。",
      mitLicense: { before: "本站源代码以 ", link: "MIT License", after: " 开源。" },
      sourceLabel: "源代码",
      getAppLabel: "获取 AstroDX",
      navLabel: "页脚导航",
    },
    pageViews: {
      siteViews: "本站总访问量",
      siteVisitors: "访客数",
      pageViews: "本页浏览量",
      views: "浏览量",
      unavailable: "暂无数据",
    },
    versions: {
      title: "按版本浏览",
      description: "按 maimai DX 版本浏览 AstroDX 谱面。",
      navLabel: "版本",
      backToIndex: "返回版本列表",
      intro: (count) => `共 ${count} 个版本分类。`,
      chartCount: (count) => `${count} 首`,
      unknownLabel: "未分类",
      detailTitle: (label) => `${label} 谱面`,
      detailIntro: (label, count) =>
        `「${label}」版本下的 ${count} 首 AstroDX 谱面，可在线浏览与下载。`,
      selectedVersionsCount: (count) => `已选 ${count} 个版本`,
    },
    guestbook: {
      navLabel: "留言板",
      title: "留言板",
      description: "在这里留言、反馈或闲聊。",
      intro: "欢迎留下你的想法、建议或问题。评论由 Artalk 提供支持，可匿名或登录后发表。",
      prefill: {
        pending: "正在把你填写的内容送入评论框…",
        success: "内容已填入下方评论框，检查无误后点击发送即可完成。",
        failedTitle: "没能自动填入评论框",
        failedBody:
          "评论组件可能被网络拦截或加载失败。你填写的内容仍在下面，可复制后手动粘贴，或通过社区渠道发给我们。",
        draftLabel: "你填写的内容",
        copy: "复制内容",
        copied: "已复制",
      },
    },
    links: {
      navLabel: "友情链接",
      title: "友情链接",
      description: "一些 maimai / AstroDX 相关的优秀站点与工具。",
      intro:
        "以下站点与工具均与本站无隶属关系，仅作社区分享。外部内容请自行甄别。",
      visitLink: (name) => `访问${name}`,
    },
    community: {
      navLabel: "社区",
      title: "社区",
      description: "加入玩家社区，交流谱面与游戏心得。",
      intro: "以下是本站相关的玩家交流群组，点击卡片即可加入。",
      join: (name) => `加入 ${name}`,
    },
    donate: {
      navLabel: "捐赠",
      title: "捐赠支持",
      description: "如果本站对你有帮助，欢迎请我们喝杯咖啡。",
      intro: "本站的服务器与流量成本均为个人承担，你的支持能帮助本站持续运营。",
      open: (name) => `前往 ${name}`,
      viewOnExplorer: "在 Tronscan 查看",
      addressTitle: "USDT (TRC20)",
      addressDescription: "使用 TRC20 网络向以下地址转账 USDT。",
      copyAddress: "复制地址",
      copied: "已复制",
      thanks: "感谢每一位支持者！",
    },
    resources: {
      official: "AstroDX",
      wiki: "维基",
      video: "演示视频",
      cloudDrive: "云盘",
      netDisk: "网盘",
    },
    about: {
      navLabel: "关于",
      title: "关于本站",
      description: "站点介绍、联系方式、开源信息与鸣谢。",
    },
    license: { navLabel: "许可与来源" },
    guide: {
      navLabel: "上手指南",
      title: "上手与排障",
      description: "从安装 AstroDX 到导入第一首谱面，以及卡住时怎么办。",
      intro:
        "本站只提供谱面，AstroDX 本体需要另行安装。下面按「装应用 → 找谱下载 → 导入 → 排障」的顺序说明；Android 与 iOS 的步骤并不相同，请对照自己的设备阅读。",
      tocLabel: "本页目录",
    },
    music: {
      navLabel: "音乐",
      title: "音乐库",
      description: "按 maimai 版本连续播放曲库中的音源。",
      intro:
        "选一个版本即可开始播放，播放器会停在页面左下角，切换页面也不会中断。曲目清单在首次播放时才会载入。",
      trackCount: (count) => `${count} 首`,
      playVersion: (name) => `播放「${name}」`,
      empty: "目前还没有可播放的曲目。",
    },
    changelog: {
      navLabel: "更新日志",
      title: "更新日志",
      description: "按入库日期排列的谱面收录记录。",
      intro:
        "每一批都是一次目录同步的结果，最新的排在最前面。批次很大时只展示前几首，其余可以按版本进入曲库查看。",
      batchHeading: (date) => `${date} 入库`,
      batchCount: (count) => `${count} 首谱面`,
      viewRest: (count) => `查看其余 ${count} 首`,
      versionsLabel: "涉及版本",
      versionLink: (name, count) => `${name}（${count} 首）`,
      moreVersions: (count) => `另有 ${count} 个版本`,
      empty: "还没有带入库时间的谱面记录。",
    },
    post: {
      navLabel: "投稿",
      title: "谱面投稿",
      description: "想让某首谱面被收录？把它推荐给我们。",
      intro:
        "填写下方信息并提交，内容会自动预填到留言板的评论框中，确认无误后发布即完成投稿。站长看到后会尽快处理。",
      songTitleLabel: "曲名（可含别名）",
      songTitlePlaceholder: "例：系ぎて / Tsunagite",
      sourceLabel: "谱面来源 / 下载链接",
      sourcePlaceholder: "例：majdata.net 链接、网盘链接等",
      notesLabel: "补充说明（可选）",
      notesPlaceholder: "例：谱面作者、难度、版本归属等",
      requiredHint: "请先填写曲名与谱面来源。",
      songTitleRequired: "请填写曲名。",
      sourceRequired: "请填写谱面来源或下载链接。",
      submit: "前往留言板投稿",
      submitting: "正在前往留言板…",
      composedTitle: "【谱面投稿】",
    },
    survey: {
      navLabel: "问卷",
      title: "问卷调查",
      description: "花一分钟告诉我们你的使用体验。",
      intro:
        "你的回答对本站今后的发展很重要！提交后内容会自动预填到留言板的评论框中，确认无误后发布即可。",
      selectPlaceholder: "请选择…",
      platformLabel: "你在哪个平台游玩 AstroDX？",
      platformOptions: [
        { value: "Android", label: "Android" },
        { value: "iOS", label: "iOS / iPadOS" },
        { value: "其他", label: "其他 / 尚未游玩" },
      ],
      discoverLabel: "你是如何得知本站的？",
      discoverPlaceholder: "例：朋友推荐、搜索引擎、QQ 群等",
      satisfactionLabel: "对本站的整体满意度？",
      satisfactionOptions: [
        { value: "5", label: "5 - 非常满意" },
        { value: "4", label: "4 - 满意" },
        { value: "3", label: "3 - 一般" },
        { value: "2", label: "2 - 不满意" },
        { value: "1", label: "1 - 很不满意" },
      ],
      wishLabel: "最希望本站增加什么功能或内容？",
      wishPlaceholder: "例：更多谱面、更好的搜索、深色模式优化等",
      otherLabel: "其他建议（可选）",
      otherPlaceholder: "任何想说的话都可以写在这里",
      requiredHint: "请先选择平台并填写满意度。",
      platformRequired: "请选择你的游玩平台。",
      satisfactionRequired: "请选择整体满意度。",
      submit: "前往留言板提交",
      submitting: "正在前往留言板…",
      composedTitle: "【问卷反馈】",
    },
    notFound: {
      title: "页面不存在",
      description: "你访问的页面不存在或已被移动，试试从首页或曲库重新出发。",
      backHome: "返回首页",
      browseCharts: "浏览曲库",
      searchLabel: "搜索曲库",
      searchSubmit: "搜索",
    },
    errorPage: {
      title: "页面出错了",
      description: "这一页在你的浏览器里没能正常加载。多数情况下重试一次就好；如果反复出现，请到留言板告诉我们。",
      retry: "重试",
      backHome: "返回首页",
      browseCharts: "浏览曲库",
      detailsLabel: "错误详情",
    },
    connection: {
      offline: "当前离线，部分内容可能无法加载。",
      restored: "网络已恢复。",
    },
    offline: {
      title: "当前处于离线状态",
      description: "无法连接到网络。已缓存的页面和封面仍可浏览；恢复网络后请重试。",
      retry: "重试",
      backHome: "返回首页",
    },
    localeBanner: {
      continueIn: "继续以中文浏览",
      dismiss: "关闭",
    },
    seo: {
      home: "ADX 谱面资源是一个非官方的 AstroDX 谱面资料站，收录大量 maimai 风格谱面，提供曲目元数据、封面、难度定数与 BPM 等信息，支持按 maimai DX 版本与分类浏览、关键字搜索、在线预览谱面并一键下载导入 AstroDX 模拟器。",
      charts:
        "浏览本站收录的全部 AstroDX 谱面，可按 maimai DX 版本分支、谱面分类与显示语言筛选，每首曲目均提供封面、难度等级、谱面定数与 BPM 等信息，支持在线预览并下载导入 AstroDX 模拟器。",
      versions:
        "按 maimai DX 版本分支浏览全部 AstroDX 谱面，从初代 maimai 到最新版本逐一分类整理，可快速定位某个版本收录的曲目，查看谱面数量、封面与难度信息，支持在线预览与下载。",
      versionDetail: (label, count) =>
        `浏览 maimai DX「${label}」版本收录的全部 ${count} 首 AstroDX 谱面，含每首曲目的封面、难度等级、谱面定数与 BPM 等完整信息，支持在线预览谱面并一键下载导入 AstroDX 模拟器，是查找与收藏该版本 maimai 谱面资源的完整归档目录。`,
      guestbook:
        "欢迎在 ADX 谱面资源留言板留下你的想法、建议、问题或反馈，与其他 maimai 与 AstroDX 玩家交流。评论系统由 Artalk 提供支持，可匿名发表，也可登录后留言。",
      links:
        "这里收集了一些与 maimai 和 AstroDX 相关的优秀站点、工具与资源，包括查分器、谱面工具、社群与教程等友情链接，方便你发现更多 maimai 玩家常用的实用资源。",
      community:
        "加入 AstroDX 玩家社区：QQ 交流群与 Telegram 群组，交流 maimai 谱面、反馈问题，并获取本站与 AstroDX 模拟器的最新动态。",
      donate:
        "如果 ADX 谱面资源对你有帮助，欢迎通过爱发电、Patreon 或 USDT (TRC20) 捐赠支持，帮助本站持续承担服务器与流量成本。",
      about:
        "了解 ADX 谱面资源：非官方 AstroDX 谱面资料站的定位与维护理念、联系方式、开源仓库与技术栈、鸣谢名单及免责声明。",
      guide:
        "AstroDX 上手指南：Android 与 iOS 的安装方式、在本站搜索与下载谱面（.adx / .zip / .tar.gz 与 BGA 的区别）、按平台导入谱面的步骤，以及下载卡住、压缩包打不开、谱面不显示、缺音频封面等常见故障的排查方法。",
      music:
        "ADX 谱面资源音乐库：按 maimai DX 版本连续播放曲库中的音源，跨页面播放不中断，可随时切换版本、随机播放或单曲循环。",
      changelog:
        "ADX 谱面资源更新日志：按入库日期查看每一批新收录的 AstroDX 谱面，了解各批次涉及的 maimai DX 版本与谱面数量，快速找到最近新增的曲目。",
      post:
        "向 ADX 谱面资源投稿谱面：填写曲名与谱面来源，内容会预填到留言板评论框，发布即完成投稿，帮助更多 AstroDX 玩家找到好谱。",
      survey:
        "参与 ADX 谱面资源问卷调查：告诉我们你的游玩平台与使用体验，你的反馈将直接影响本站的功能规划与内容方向。",
    },
  },
  en: {
    localeLabel: "English",
    siteName: "ADX Chart Archive",
    nav: {
      home: "Home",
      browse: "Browse",
      skipToContent: "Skip to main content",
      primaryLabel: "Primary",
      languageLabel: "Language",
      menuLabel: "Navigation menu",
      moreLabel: "More",
      randomLabel: "Random",
      searchLabel: "Search",
    },
    language: { zh: "中文", en: "English", ja: "日本語" },
    theme: { toggleLabel: "Toggle theme", light: "Light", dark: "Dark", system: "System" },
    motionToggle: { label: "Reduce motion", enabledHint: "Restore motion" },
    settings: {
      open: "Open settings",
      title: "Settings",
      description:
        "Manage display preferences, download format, and download routes in one place. Settings stay on this device.",
      close: "Close settings",
      appearanceTitle: "Appearance & experience",
      appearanceDescription:
        "Adjust language, color mode, interface accent, and motion.",
      languageLabel: "Interface language",
      themeLabel: "Color mode",
      accentLabel: "Theme accent",
      accents: {
        blue: "Blue",
        violet: "Violet",
        teal: "Teal",
        orange: "Orange",
        rose: "Rose",
      },
      motionLabel: "Motion",
      motion: {
        system: "Follow system",
        on: "Motion on",
        off: "Reduce motion",
      },
      motionHints: {
        system: "Follow your device’s reduced-motion preference",
        on: "Always play interface motion",
        off: "Disable nonessential animation and transitions",
      },
      downloadsTitle: "Downloads",
      downloadsDescription:
        "Choose the default format and route. Running jobs keep the configuration they started with.",
      defaultSourceLabel: "Default download route",
      refreshLatency: "Retest latency",
      builtInLabel: "Built in",
      builtInLocked: "Built-in routes cannot be deleted",
      customSourcesLabel: "Custom routes",
      noCustomSources: "No custom routes have been added.",
      addCustomSource: "Add route",
      sourceNameLabel: "Route name",
      sourceNamePlaceholder: "For example: My mirror",
      sourceUrlLabel: "Route URL",
      sourceUrlPlaceholder: "https://mirror.example.com",
      saveCustomSource: "Save and test",
      removeCustomSource: (name) => `Remove route “${name}”`,
      invalidCustomSource:
        "Enter a name and valid HTTPS URL. Local development URLs may use HTTP.",
      customSourceHint:
        "The mirror must preserve the built-in path structure and allow cross-origin downloads.",
      defaultFormatLabel: "Default download format",
      formatHelp:
        "Download buttons use this format directly; their menus can still override it for one download.",
      formats: {
        adx: "AstroDX import format (recommended)",
        zip: "Standard ZIP archive",
        "tar.gz": "TAR.GZ archive",
      },
      batchGroupingLabel: "Batch download folder layout",
      batchGroupingHelp:
        "Sets the folder level charts are packed under in a batch download. A selection spanning several of them is split into one archive each. Running jobs keep the layout they started with.",
      batchGroupings: {
        version: { name: "By version", description: "e.g. “25 CiRCLE”" },
        genre: { name: "By genre", description: "e.g. “東方Project”" },
      },
    },
    home: {
      badge: "Built for AstroDX players",
      heroTitle: "Find your next chart for AstroDX.",
      heroDescription:
        "Search, preview, and download community charts. Browse by release or genre, then import them into AstroDX.",
      title: "AstroDX chart archive for browsing, indexing, and downloads.",
      description:
        "Search, preview, and download maimai charts, then import them into the AstroDX simulator in one click. Browse by version or genre, or grab whole sets at once.",
      searchCta: "Search Catalog",
      searchExamples: ["PANDORA PARADOXXX", "pandora", "sasakure.UK", "niconico＆VOCALOID", "tsunagite"],
      browseCta: "Browse Releases",
      getAppCta: "Get AstroDX",
      guideCta: "Getting Started",
      importVideoCta: "Chart Import Tutorial",
      videoCta: "Watch the Demo",
      randomCta: "Surprise Me",
      whatIsAstroDX: "What is AstroDX?",
      heroActionsLabel: "Quick actions",
      quickGenresLabel: "Browse by genre",
      genresDescription: "Filter the catalog by genre and jump straight to matching charts.",
      searchSuggestionsLabel: "Search suggestions",
      spotlightLabel: "Today's picks",
      spotlightCarouselRole: "carousel",
      spotlightSlideRole: "featured chart",
      spotlightPrevious: "Previous pick",
      spotlightNext: "Next pick",
      spotlightPause: "Pause automatic rotation",
      spotlightResume: "Resume automatic rotation",
      featuredTitle: "Random picks",
      featuredDescription: "A rotating random selection refreshed with each catalog update — discover hidden gems.",
      viewMore: "View more",
      tagline: "Archive & Download Portal",
      entriesBadge: (count) => (count === 1 ? "1 entry" : `${count} entries`),
      metricsTotal: "Charts",
      metricsCategories: "Catalog categories",
      metricsVersions: "Versions",
      metricsArtists: "Artists",
      metricsUpdated: "Updated",
      branchesTitle: "Browse by version",
      branchesDescription: "From the original maimai to the latest release — pick a version to start.",
      versionsCta: "View all versions",
      latestTitle: "Latest Charts",
      latestDescription: "Recently indexed remote charts with ready-to-browse cover art.",
      openDetail: "Open Detail",
      pipelineTitle: "Data pipeline",
      pipelineDescription: "Remote directory scanning, maidata parsing, and static catalog generation.",
      pipelineBadge: "Remote index builder",
      staticTitle: "Static output",
      staticDescription: "Next.js 16 static export for static-host friendly deployment.",
      staticBadge: "Bun + Turbopack",
      downloadsTitle: "Downloads",
      downloadsDescription:
        "Builds download actions from the remote directory contents detected at catalog build time.",
      downloadsBadge: "Remote directory-driven",
      faqHeading: "Frequently Asked Questions",
      faq: (total, versions) => [
        {
          id: "what-is-astrodx",
          q: "What is AstroDX?",
          a: "AstroDX is a community-built simulator for maimai-style rhythm-game charts. This site, the ADX Chart Archive, is an unofficial index of AstroDX charts with metadata, cover art, and download links.",
        },
        {
          id: "what-is-maimai-dx",
          q: "What is maimai DX?",
          a: "maimai DX is SEGA's arcade rhythm game, and AstroDX charts recreate its play format. The catalog groups charts by maimai DX versions such as FESTiVAL, PRiSM, BUDDiES, and UNiVERSE.",
        },
        {
          id: "how-to-download",
          q: "How do I download a chart?",
          a: "Open any chart's detail page and use the on-site download button to fetch the chart package built from the remote AstroDX directory.",
        },
        {
          id: "how-to-import",
          q: "How do I import charts into AstroDX?",
          a: "The .adx you download here imports as-is — no extracting. On iOS, use the Files app to move it into the AstroDX folder itself (not the levels folder inside it). On Android, tap the .adx and open it with AstroDX, or long-press and share it to AstroDX. Launch the game once before your first import. Full walkthrough in the guide.",
        },
        {
          id: "catalog-size",
          q: "How many charts are in the archive?",
          a: `The archive currently lists ${total} charts across ${versions} maimai DX version branches, and is updated as the remote directory changes.`,
        },
      ],
      faqEntryId: "what-is-astrodx",
    },
    charts: {
      title: "Browse Charts",
      description:
        "Explore AstroDX directory entries by category, branch, and display language.",
      intro: (count, versions) =>
        `This catalog lists ${count} charts across ${versions} maimai DX version branches. Browse by category, branch, and display language.`,
    },
    statusPage: {
      title: "Server Status",
      loading: "Loading",
    },
    catalogBrowser: {
      searchPlaceholder: "Search title, romaji, alias, artist, charter, version...",
      searchLabel: "Search charts",
      randomChart: "Random chart",
      allCategories: "All Categories",
      allSubcategories: "All Versions",
      allGenres: "All Genres",
      aliasMatchLabel: "Alias match",
      newBadge: "New",
      newBadgeHint: "Added in the last two weeks",
      details: "Details",
      download: "Download",
      source: "Source",
      emptyState:
        "No matching charts were found. Try the romaji reading, an alias, or the artist.",
      clearSearch: "Clear search",
      clearFilters: "Clear all filters",
      activeFiltersLabel: "Active filters",
      removeFilter: (label) => `Remove filter: ${label}`,
      advancedFilters: "Advanced filters",
      filterAll: "All",
      filterVersion: "Version",
      filterLevel: "Level",
      filterGenre: "Genre",
      filterCabinet: "Type",
      filterBpm: "BPM",
      filterAssets: "Assets",
      filterDesigner: "Charter",
      designerSearchPlaceholder: "Type a charter's name…",
      designerListLabel: "Charter suggestions",
      designerNoMatch: "No charter matches that",
      chipCountLabel: (label, count) =>
        count === 1 ? `${label} (1 chart)` : `${label} (${count} charts)`,
      sortLabel: "Sort",
      sortOptions: {
        default: "Default order",
        imported: "Recently added",
        "level-desc": "Level: high to low",
        "level-asc": "Level: low to high",
        "bpm-desc": "BPM: high to low",
        "bpm-asc": "BPM: low to high",
        "title-asc": "Title: A to Z",
      },
      emptySuggestionsTitle: "Try dropping one condition:",
      dropFilterSuggestion: (label, count) =>
        count === 1
          ? `Without the ${label} filter → 1 chart`
          : `Without the ${label} filter → ${count} charts`,
      filterSearch: "Search",
      cabinetStandard: "Standard",
      cabinetUtage: "Utage",
      assetHasPv: "With BGA video",
      assetNoPv: "Without BGA video",
      resultsSummary: (count) => (count === 1 ? "1 chart" : `${count} charts`),
      previousPage: "Previous",
      nextPage: "Next",
      goToPage: (page) => `Page ${page}`,
      pageLabel: (current, total) => `Page ${current} of ${total}`,
      rangeLabel: (start, end, total) => `Showing ${start}-${end} of ${total}`,
      selectMode: "Select",
      exitSelectMode: "Done",
      selectAll: "Select all results",
      selectAllFiltered: (count) => (count === 1 ? "Select 1 result" : `Select ${count} results`),
      selectAllVersions: (count) =>
        count === 1 ? "Select 1 version" : `Select ${count} versions`,
      clearSelection: "Clear",
      selectedCount: (count) => `${count} selected`,
      batchDownload: "Download",
      batchDefaultName: "AstroDX Charts",
      levelFilterLabel: "Filter by level",
      allLevels: "All Levels",
      levelOption: (level) => `Level ${level}`,
      rangeMin: "Min",
      rangeMax: "Max",
      levelRangeLabel: (low, high) => (low === high ? `Level ${low}` : `Level ${low}–${high}`),
      bpmRangeLabel: (low, high) => (low === high ? `BPM ${low}` : `BPM ${low}–${high}`),
      specsLoading: "Loading download manifest…",
      specsError: "Couldn't load the download manifest. Please try again later.",
    },
    detail: {
      onsiteDownload: "Onsite Download",
      onsitePending: "Onsite Download Pending",
      downloadFormatLabel: "Choose format",
      downloadFormatRecommended: "Recommended",
      formatHintAdx: "AstroDX import format · recommended",
      downloadIncludeVideo: "Include BGA video",
      downloadPreparing: "Reading directory",
      downloadPacking: (completed, total) => `Downloading and packing (${completed}/${total})`,
      downloadSuccess: "Download started",
      downloadErrorPrefix: "Download failed: ",
      sourceLink: "Source Link",
      metadata: "Chart Metadata",
      metadataDescription: "Parsed directly from the remote AstroDX directory resources.",
      difficulties: "Difficulties",
      source: "Source",
      sourceDescription: "Built from the remote AstroDX directory index.",
      breadcrumbLabel: "Breadcrumb",
      versionLabel: "Version",
      genreLabel: "Genre",
      bpmLabel: "BPM",
      bpmVariableLabel: (range) => `${range} (variable)`,
      durationLabel: "Length",
      shortIdLabel: "Short ID",
      aliasesLabel: "Aliases",
      unknownValue: "Unknown",
      notAvailableValue: "Not available",
      tableDifficulty: "Difficulty",
      tableLevel: "Level",
      tableCharter: "Charter",
      tableNotes: "Notes",
      noteTypeTap: "Tap",
      noteTypeHold: "Hold",
      noteTypeSlide: "Slide",
      noteTypeTouch: "Touch",
      noteTypeTouchHold: "Touch Hold",
      noteTypeBreak: "Break",
      statsTitle: "Chart numbers",
      statsDescription: "Note counts, length and file sizes measured from the maidata at build time.",
      statsNotesLabel: "Most notes",
      statsDownloadLabel: "Download size",
      sizeEstimate: (size) => `about ${size}`,
      sizeEstimateWithVideo: (total, video) => `about ${total} (${video} of it BGA)`,
      sourceMaidataLabel: "Chart file",
      licenseLabel: "Licence note",
      levelConstantHint: "Bold is the display level; the faint number is the chart constant.",
      preview: "Preview",
      previewDescription: "Watch the PV or listen to the audio (served from the remote directory).",
      actionsLabel: "Chart actions",
      chartPreview: "Chart preview",
      chartPreviewDescription: "Play the chart in your browser, synced to the audio.",
      chartPreviewAt: (difficulty) => `Preview the ${difficulty} chart`,
      pvLabel: "Promotion Video (PV)",
      audioLabel: "Audio preview",
      mediaUnsupported: "Your browser does not support playing this media.",
      volumeLabel: "Volume",
      muteLabel: "Mute",
      comments: "Comments",
      relatedTitle: "Related charts",
      relatedDescription: "More charts sharing this one's artist, genre, or version.",
      relatedReasonArtist: "Same artist",
      relatedReasonGenre: "Same genre",
      relatedReasonVersion: "Same version",
      commentsLoading: "Loading comments…",
      commentsError: "Comments failed to load. Check your connection and try again.",
      commentsRetry: "Retry",
      share: "Share",
      shareCopied: "Link copied",
    },
    downloads: {
      sourcePicker: {
        label: "Download source",
        options: {
          r2: { name: "R2", description: "Primary Cloudflare R2 route, selected by default" },
          alice: { name: "Alice", description: "Alice download route" },
          tsumugi: { name: "Tsumugi", description: "Tsumugi download route" },
          awmc: { name: "AWMC", description: "AWMC download route" },
          g510: { name: "G510", description: "G510 download route" },
          g400s: { name: "G400s", description: "G400s download route" },
          custom: { name: "Custom", description: "Use your own path-compatible mirror" },
        },
        statuses: {
          available: "Available",
          degraded: "Busy",
          maintenance: "Maintenance",
        },
        probe: {
          idle: "-- ms",
          testing: "Testing…",
          timeout: "Timeout",
          unavailable: "Unavailable",
          unconfigured: "Not configured",
        },
        badges: {
          primary: "Recommended",
          backup: "Backup",
          custom: "Custom",
        },
        customUrlLabel: "Custom route URL",
        customUrlPlaceholder: "https://mirror.example.com",
        customSaveAndTest: "Save and test",
        customReset: "Restore R2",
        customHint: "Saved on this device only. The mirror must use the same paths and allow cross-origin downloads.",
        customInvalid: "Enter a valid HTTPS URL (local development may use HTTP) without credentials, query parameters, or a fragment.",
        manageInSettings: "Add and manage custom routes from Settings in the top-right corner.",
        switchAndRestart: "Switch and continue",
        restartHint: "Completed files are kept; unfinished files restart on the new route.",
      },
      trayTitle: "Downloads",
      dismiss: "Dismiss",
      resume: "Resume",
      cancel: "Cancel",
      paused: "Paused",
      pause: "Pause",
      queued: "Queued — waiting for earlier downloads",
      queueSummary: (done, total) => `${done} of ${total} downloads finished`,
      collapse: "Collapse downloads",
      expand: "Expand downloads",
      jobsCount: (count) => (count === 1 ? "1 download" : `${count} downloads`),
      archiving: "Packing archive…",
      completed: "Archive saved — check your browser downloads",
      importHint: "Import the file into AstroDX to play (.adx imports directly).",
      confirmDiscard: "Click again to discard the downloaded data",
      errorOffline: "You're offline — completed files are kept; Resume downloads the rest",
      errorNetwork: "Download failed — completed files are kept; Resume retries the rest",
      errorGeneric: "Download error — completed files are kept; Resume retries the rest",
      batchSummary: (charts, files) =>
        charts === 1
          ? `Packing 1 chart, ${files} files total`
          : `Packing ${charts} charts, ${files} files total`,
      batchSplitSummary: (archives) =>
        `Spans multiple versions — queued as ${archives} downloads, one archive per version`,
      batchSplitSummaryGenre: (archives) =>
        `Spans multiple genres — queued as ${archives} downloads, one archive per genre`,
      groupingLabel: "Folder layout",
      groupingVersion: "Group by version",
      groupingGenre: "Group by genre",
      batchVideoSummary: (count) =>
        count === 1 ? "Includes 1 BGA video file" : `Includes ${count} BGA video files`,
      batchNoVideoSummary: "BGA video excluded for a lighter download",
      batchVideoLargeHint:
        "BGA video can make the archive much larger. Turn it off on slow networks or mobile data.",
      batchConfirm: (count, includeVideo) =>
        includeVideo
          ? count === 1
            ? "Start downloading 1 chart with BGA video included?"
            : `Start downloading ${count} charts with BGA video included?`
          : count === 1
            ? "Start downloading 1 chart?"
            : `Start downloading ${count} charts?`,
      batchConfirmStart: "Start download",
      etaRemaining: (clock) => `${clock} left`,
      errorServer: "The mirror is failing right now. Finished files are kept — retry later or switch route.",
      errorMissing: "The server does not have this file. Another route may; retrying the same one will not help.",
      errorDetailLabel: "Error details",
      copyDetail: "Copy details",
      copiedDetail: "Copied",
      skippedTitle: "Skipped optional files",
      skippedSummary: (count) =>
        `Skipped ${count} optional file${count === 1 ? "" : "s"} (cover art or BGA). The chart itself is complete.`,
      autoSwitched: (name) => `Switched to ${name} automatically`,
      autoResumed: (count) =>
        `Back online — resumed ${count} download${count === 1 ? "" : "s"} automatically`,
      checkpointsUnavailable:
        "Browser storage writes are failing, so this download can no longer resume after a reload. Keep the page open until it finishes.",
      storageTight: (available) =>
        `Only about ${available} of device storage is free; a large batch may fail partway.`,
      storageInsufficient: (available, required) =>
        `About ${available} of device storage is free, which is not enough for roughly ${required}. Free up space or pick fewer charts.`,
      historyTitle: "Recent downloads",
      historyDescription:
        "Completed downloads are remembered on this device so the same set can be fetched again in one click.",
      historyEmpty: "No completed downloads yet.",
      historyRerun: "Download again",
      historyClear: "Clear history",
      historyEntrySummary: (files) => `${files} file${files === 1 ? "" : "s"}`,
    },
    preview: {
      loading: "Loading chart…",
      loadFailedTitle: "Failed to load the chart",
      loadFailedBody: "The chart data could not be fetched. Check your connection and try again.",
      retry: "Retry",
      audioFailedBody: "The audio failed to load. Retry, or play without audio.",
      playWithoutAudio: "Play without audio",
      audioLoading: "Loading audio…",
      canvasLabel: (title) => `Chart preview: ${title}`,
      keyboardHint: "Keyboard shortcuts work after you click or focus the player.",
      prevMeasure: "Previous measure",
      prevPosition: "Step backward",
      play: "Play",
      pause: "Pause",
      nextPosition: "Step forward",
      nextMeasure: "Next measure",
      replayMeasure: "Replay current measure",
      progress: "Progress",
      soundOn: "Enable answer SFX",
      soundOff: "Mute answer SFX",
      settings: "Settings",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      lockUi: "Lock UI (avoid accidental taps while playing along)",
      unlockUi: "Unlock UI",
      rotateView: (currentDeg) => `Rotate view (now ${currentDeg}°, tap for +90°)`,
      copyFrame: "Copy current frame",
      copyTimeUrl: "Copy link to current time",
      exportMenu: "Frame export",
      shareFrame: "System share",
      saveFrame: "Save current frame",
      gifCancel: "Cancel GIF export",
      gifRangeHint: (duration) => `Range ${duration} — drag the timeline handles to adjust`,
      gifRangeTooLong: (max) => `GIF export tops out at ${max}; shorten the range first`,
      exportGif: "Export GIF",
      loopRange: "A–B repeat",
      loopRangeOff: "Stop A–B repeat",
      loopActiveHint: (duration) => `Repeating a ${duration} section`,
      speedPanel: "Speed",
      hudCombo: "Combo",
      hudBreakNoEx: "no EX",
      hudNoteTotalToggle: "On-canvas combo",
      hudBreakCountToggle: "On-canvas break count",
      exportingPercent: (percent) => `Exporting ${percent}%`,
      cancel: "Cancel",
      gifExportedTitle: "Exported",
      gifExportedBody: "GIF downloaded",
      gifFailedTitle: "Export failed",
      gifFailedBody: "Could not generate the GIF",
      frameSavedTitle: "Saved",
      frameSavedBody: "Current frame downloaded as PNG",
      frameFailedTitle: "Export failed",
      frameFailedBody: "Could not capture the current frame",
      copiedTitle: "Copied",
      copiedBody: "Current frame copied to the clipboard",
      copyFailedTitle: "Copy failed",
      copyFailedBody: "Clipboard is unavailable",
      simaiTitle: "Simai statements",
      resumeAutoScroll: "Resume auto-scroll",
      legendLabel: "Note types",
      noteTap: "Tap",
      noteHold: "Hold",
      noteSlide: "Slide",
      noteTouch: "Touch",
      noteBreak: "Break",
    },
    assets: { audio: "Audio", jacket: "Jacket", pv: "PV", dxChart: "DX Chart" },
    cover: {
      alt: (title) => `${title} cover`,
      placeholder: "AstroDX cover placeholder",
    },
    footer: {
      description: "ADX 谱面资源 — an unofficial chart index built from the remote directory.",
      lastUpdated: (date) => `Catalog updated ${date}`,
      disclaimer:
        "Unofficial fan-made archive. AstroDX and maimai are the property of their respective owners.",
      aiNotice:
        "This project is co-developed by Claude & GPT. All contents are AI-generated.",
      mitLicense: { before: "Site source code is released under the ", link: "MIT License", after: "." },
      sourceLabel: "Source",
      getAppLabel: "Get AstroDX",
      navLabel: "Footer",
    },
    pageViews: {
      siteViews: "Site views",
      siteVisitors: "Visitors",
      pageViews: "Page views",
      views: "Views",
      unavailable: "Unavailable",
    },
    versions: {
      title: "Browse by Version",
      description: "Browse AstroDX charts by maimai DX version.",
      navLabel: "Versions",
      backToIndex: "All versions",
      intro: (count) => (count === 1 ? "1 version category." : `${count} version categories.`),
      chartCount: (count) => (count === 1 ? "1 chart" : `${count} charts`),
      unknownLabel: "Uncategorized",
      detailTitle: (label) => `${label} charts`,
      detailIntro: (label, count) =>
        count === 1
          ? `1 AstroDX chart in the "${label}" version, available to browse and download.`
          : `${count} AstroDX charts in the "${label}" version, available to browse and download.`,
      selectedVersionsCount: (count) =>
        count === 1 ? "1 version selected" : `${count} versions selected`,
    },
    guestbook: {
      navLabel: "Guestbook",
      title: "Guestbook",
      description: "Leave a message, feedback, or just say hi.",
      intro:
        "Share your thoughts, suggestions, or questions. Comments are powered by Artalk — post anonymously or sign in.",
      prefill: {
        pending: "Moving what you filled in into the comment box…",
        success:
          "Your text is in the comment box below. Check it over and hit send to finish.",
        failedTitle: "Couldn't fill the comment box automatically",
        failedBody:
          "The comment widget may have been blocked or failed to load. Your text is still here — copy it and paste it in by hand, or send it to us through one of the community channels.",
        draftLabel: "What you wrote",
        copy: "Copy text",
        copied: "Copied",
      },
    },
    links: {
      navLabel: "Links",
      title: "Friend Links",
      description: "A handful of great maimai / AstroDX-related sites and tools.",
      intro:
        "These sites and tools are not affiliated with this archive — shared for the community. Use external links at your own discretion.",
      visitLink: (name) => `Visit ${name}`,
    },
    community: {
      navLabel: "Community",
      title: "Community",
      description: "Join the player community to chat about charts and the game.",
      intro: "These are the player groups around this archive — click a card to join.",
      join: (name) => `Join ${name}`,
    },
    donate: {
      navLabel: "Donate",
      title: "Support Us",
      description: "If this archive helps you, consider buying us a coffee.",
      intro:
        "Servers and bandwidth are paid out of pocket — your support keeps this archive running.",
      open: (name) => `Open ${name}`,
      viewOnExplorer: "View on Tronscan",
      addressTitle: "USDT (TRC20)",
      addressDescription: "Send USDT to the address below via the TRC20 network.",
      copyAddress: "Copy address",
      copied: "Copied",
      thanks: "Thank you to every supporter!",
    },
    resources: {
      official: "AstroDX",
      wiki: "Wiki",
      video: "Demo Video",
      cloudDrive: "Cloud Storage",
      netDisk: "Download Mirror",
    },
    about: {
      navLabel: "About",
      title: "About",
      description: "What this site is, how to reach us, open-source info and credits.",
    },
    license: { navLabel: "License & Sources" },
    guide: {
      navLabel: "Guide",
      title: "Getting Started & Troubleshooting",
      description:
        "From installing AstroDX to importing your first chart — and what to do when something goes wrong.",
      intro:
        "This archive hosts charts only; AstroDX itself has to be installed separately. The steps below run install → download → import → fix, and Android and iOS differ, so follow the path that matches your device.",
      tocLabel: "On this page",
    },
    music: {
      navLabel: "Music",
      title: "Music Library",
      description: "Play the archive's audio continuously, one maimai version at a time.",
      intro:
        "Pick a version to start playing. The player docks in the bottom-left corner and keeps going as you move between pages; the track list is fetched the first time you press play.",
      trackCount: (count) => (count === 1 ? "1 track" : `${count} tracks`),
      playVersion: (name) => `Play ${name}`,
      empty: "No playable tracks yet.",
    },
    changelog: {
      navLabel: "Changelog",
      title: "Changelog",
      description: "Every chart this archive added, grouped by the day it landed.",
      intro:
        "Each group is one catalog sync, newest first. Large batches show only their first few charts; the rest is one click away, filtered by version.",
      batchHeading: (date) => `Added ${date}`,
      batchCount: (count) => (count === 1 ? "1 chart" : `${count} charts`),
      viewRest: (count) => `See the other ${count}`,
      versionsLabel: "Versions in this batch",
      versionLink: (name, count) => `${name} (${count})`,
      moreVersions: (count) => `and ${count} more versions`,
      empty: "No dated import records yet.",
    },
    post: {
      navLabel: "Submit",
      title: "Submit a Chart",
      description: "Want a chart added to the archive? Recommend it here.",
      intro:
        "Fill in the form and submit — your entry is prefilled into the guestbook's comment box; review it and post to finish. The maintainer will follow up as soon as possible.",
      songTitleLabel: "Song title (aliases welcome)",
      songTitlePlaceholder: "e.g. 系ぎて / Tsunagite",
      sourceLabel: "Chart source / download link",
      sourcePlaceholder: "e.g. a majdata.net link or a drive link",
      notesLabel: "Notes (optional)",
      notesPlaceholder: "e.g. chart designer, difficulty, version",
      requiredHint: "Please fill in the song title and the chart source first.",
      songTitleRequired: "Enter the song title.",
      sourceRequired: "Enter where the chart came from, or a download link.",
      submit: "Submit via Guestbook",
      submitting: "Opening the guestbook…",
      composedTitle: "[Chart Submission]",
    },
    survey: {
      navLabel: "Survey",
      title: "Survey",
      description: "Spare a minute to tell us how the site works for you.",
      intro:
        "Your answers shape where this site goes next! After submitting, your responses are prefilled into the guestbook's comment box — review and post to finish.",
      selectPlaceholder: "Select…",
      platformLabel: "Which platform do you play AstroDX on?",
      platformOptions: [
        { value: "Android", label: "Android" },
        { value: "iOS", label: "iOS / iPadOS" },
        { value: "Other", label: "Other / not playing yet" },
      ],
      discoverLabel: "How did you find this site?",
      discoverPlaceholder: "e.g. a friend, a search engine, a QQ group",
      satisfactionLabel: "Overall, how satisfied are you with the site?",
      satisfactionOptions: [
        { value: "5", label: "5 - Very satisfied" },
        { value: "4", label: "4 - Satisfied" },
        { value: "3", label: "3 - Neutral" },
        { value: "2", label: "2 - Dissatisfied" },
        { value: "1", label: "1 - Very dissatisfied" },
      ],
      wishLabel: "What would you most like to see added?",
      wishPlaceholder: "e.g. more charts, better search, dark-mode polish",
      otherLabel: "Anything else? (optional)",
      otherPlaceholder: "Anything you want to tell us",
      requiredHint: "Please pick a platform and a satisfaction score first.",
      platformRequired: "Pick the platform you play on.",
      satisfactionRequired: "Pick an overall satisfaction score.",
      submit: "Submit via Guestbook",
      submitting: "Opening the guestbook…",
      composedTitle: "[Survey Feedback]",
    },
    notFound: {
      title: "Page not found",
      description:
        "The page you're looking for doesn't exist or has moved. Head back to the home page or browse the chart library.",
      backHome: "Back to home",
      browseCharts: "Browse charts",
      searchLabel: "Search the catalog",
      searchSubmit: "Search",
    },
    errorPage: {
      title: "Something went wrong",
      description:
        "This page failed to load in your browser. Retrying usually fixes it — if it keeps happening, let us know on the guestbook.",
      retry: "Try again",
      backHome: "Back to home",
      browseCharts: "Browse charts",
      detailsLabel: "Error details",
    },
    connection: {
      offline: "You're offline — some content may not load.",
      restored: "Back online.",
    },
    offline: {
      title: "You're offline",
      description:
        "You appear to be offline. Cached pages and covers are still available — reconnect and try again.",
      retry: "Retry",
      backHome: "Back to home",
    },
    localeBanner: {
      continueIn: "Continue in English",
      dismiss: "Dismiss",
    },
    seo: {
      home: "An unofficial AstroDX archive of maimai-style charts — per-song metadata, cover art, difficulty constants and BPM. Browse, search, preview and download.",
      charts:
        "Browse the AstroDX chart catalog by maimai DX version, category and language, with cover art, difficulty levels, constants and BPM to preview and download.",
      versions:
        "Browse every AstroDX chart grouped by maimai DX version, from the original maimai to the latest release — jump to any version for its song count, covers and downloads.",
      versionDetail: (label, count) =>
        count === 1
          ? `Browse the AstroDX chart in the maimai DX "${label}" version — cover art, difficulty levels, chart constants and BPM, ready to preview online and download into AstroDX.`
          : `Browse all ${count} AstroDX charts in the maimai DX "${label}" version — cover art, difficulty levels, chart constants and BPM, ready to preview online and download into AstroDX.`,
      guestbook:
        "Share thoughts, suggestions and feedback, and chat with other maimai and AstroDX players. Comments are powered by Artalk — post anonymously or sign in.",
      links:
        "A curated collection of maimai- and AstroDX-related sites, tools and resources — score trackers, chart utilities, communities and guides for players.",
      community:
        "Join the AstroDX player community — our QQ group and Telegram group — to chat about maimai charts, report issues and follow updates to this site and the AstroDX simulator.",
      donate:
        "If the ADX chart archive helps you, consider supporting it via Afdian, Patreon or USDT (TRC20) to help cover server and bandwidth costs.",
      about:
        "About the ADX chart archive: what this unofficial AstroDX chart site is, how it is maintained, how to reach us, its open-source repository and tech stack, credits and disclaimer.",
      guide:
        "Getting started with AstroDX: installing it on Android and iOS, finding and downloading charts here (.adx vs .zip vs .tar.gz, and what a BGA adds), importing on each platform, and fixing stalled downloads, unopenable archives, missing charts and missing audio.",
      music:
        "The ADX chart archive music library: play the catalog's audio continuously by maimai DX version, keep it running across pages, and switch versions, shuffle or repeat at any time.",
      changelog:
        "The ADX chart archive changelog: every batch of newly added AstroDX charts by import date, which maimai DX versions each batch touched, and how many charts it brought in.",
      post:
        "Submit a chart to the ADX archive: fill in the song title and chart source, review the prefilled guestbook comment and post it — helping more AstroDX players find great charts.",
      survey:
        "Take the ADX chart archive survey: tell us your platform and experience — your feedback directly shapes the site's roadmap and content.",
    },
  },
  ja: {
    localeLabel: "日本語",
    siteName: "ADX 譜面アーカイブ",
    nav: {
      home: "ホーム",
      browse: "曲一覧",
      skipToContent: "メインコンテンツへ移動",
      primaryLabel: "メインナビ",
      languageLabel: "言語切り替え",
      menuLabel: "ナビゲーションメニュー",
      moreLabel: "その他",
      randomLabel: "ランダム",
      searchLabel: "検索",
    },
    language: { zh: "中文", en: "English", ja: "日本語" },
    theme: { toggleLabel: "テーマ切り替え", light: "ライト", dark: "ダーク", system: "システム" },
    motionToggle: { label: "アニメーションを減らす", enabledHint: "アニメーションを戻す" },
    settings: {
      open: "設定を開く",
      title: "設定",
      description:
        "表示設定、ダウンロード形式、ダウンロード回線をまとめて管理します。設定はこの端末に保存されます。",
      close: "設定を閉じる",
      appearanceTitle: "表示と操作感",
      appearanceDescription:
        "言語、カラーモード、アクセントカラー、アニメーションを調整します。",
      languageLabel: "表示言語",
      themeLabel: "カラーモード",
      accentLabel: "テーマカラー",
      accents: {
        blue: "ブルー",
        violet: "バイオレット",
        teal: "ティール",
        orange: "オレンジ",
        rose: "ローズ",
      },
      motionLabel: "アニメーション",
      motion: {
        system: "システムに従う",
        on: "オン",
        off: "減らす",
      },
      motionHints: {
        system: "端末の「視差効果を減らす」設定に従います",
        on: "常にインターフェースの動きを再生します",
        off: "不要なアニメーションと切り替えを無効にします",
      },
      downloadsTitle: "ダウンロード",
      downloadsDescription:
        "既定の形式と回線を選択します。開始済みのタスクは開始時の設定を保持します。",
      defaultSourceLabel: "既定のダウンロード回線",
      refreshLatency: "再測定",
      builtInLabel: "内蔵",
      builtInLocked: "内蔵回線は削除できません",
      customSourcesLabel: "カスタム回線",
      noCustomSources: "カスタム回線はまだ追加されていません。",
      addCustomSource: "回線を追加",
      sourceNameLabel: "回線名",
      sourceNamePlaceholder: "例：マイミラー",
      sourceUrlLabel: "回線 URL",
      sourceUrlPlaceholder: "https://mirror.example.com",
      saveCustomSource: "保存して測定",
      removeCustomSource: (name) => `回線「${name}」を削除`,
      invalidCustomSource:
        "名前と有効な HTTPS URL を入力してください。ローカル開発では HTTP を使用できます。",
      customSourceHint:
        "ミラーは内蔵回線と同じパス構成を保ち、クロスオリジンダウンロードを許可する必要があります。",
      defaultFormatLabel: "既定のダウンロード形式",
      formatHelp:
        "ダウンロードボタンはこの形式を使用します。メニューから今回だけ別の形式を選ぶこともできます。",
      formats: {
        adx: "AstroDX インポート形式（推奨）",
        zip: "標準 ZIP アーカイブ",
        "tar.gz": "TAR.GZ アーカイブ",
      },
      batchGroupingLabel: "まとめてダウンロードのフォルダ分け",
      batchGroupingHelp:
        "まとめてダウンロード時に譜面を収めるフォルダ階層です。複数にまたがる選択は、それぞれ別のアーカイブに分けて保存されます。実行中のジョブは開始時の分け方を保ちます。",
      batchGroupings: {
        version: { name: "バージョン別", description: "例：「25 CiRCLE」" },
        genre: { name: "ジャンル別", description: "例：「東方Project」" },
      },
    },
    home: {
      badge: "AstroDX プレイヤーのために",
      heroTitle: "AstroDX の次の譜面を見つけよう。",
      heroDescription:
        "コミュニティ譜面を検索・プレビュー・ダウンロード。バージョンやジャンルから探して、AstroDX へ導入できます。",
      title: "AstroDX 譜面アーカイブとダウンロード入口。",
      description:
        "maimai 譜面を検索・試遊してダウンロードし、ワンクリックで AstroDX シミュレーターへインポート。バージョンやジャンルから探せて、まとめてダウンロードにも対応しています。",
      searchCta: "カタログ検索",
      searchExamples: ["PANDORA PARADOXXX", "パンドラ", "sasakure.UK", "niconico＆VOCALOID", "系ぎて"],
      browseCta: "バージョン一覧",
      getAppCta: "AstroDX を入手",
      guideCta: "使い方ガイド",
      importVideoCta: "譜面の入れ方動画",
      videoCta: "デモ動画を見る",
      randomCta: "ランダムに一曲",
      whatIsAstroDX: "AstroDX とは？",
      heroActionsLabel: "クイックリンク",
      quickGenresLabel: "ジャンル別に見る",
      genresDescription: "ジャンルでカタログを絞り込み、該当する譜面へすぐ移動できます。",
      searchSuggestionsLabel: "検索候補",
      spotlightLabel: "今日のおすすめ",
      spotlightCarouselRole: "カルーセル",
      spotlightSlideRole: "おすすめ譜面",
      spotlightPrevious: "前のおすすめ",
      spotlightNext: "次のおすすめ",
      spotlightPause: "自動切り替えを一時停止",
      spotlightResume: "自動切り替えを再開",
      featuredTitle: "ランダムセレクト",
      featuredDescription: "カタログ更新ごとに入れ替わるランダムなおすすめ。隠れた名曲を見つけよう。",
      viewMore: "もっと見る",
      tagline: "アーカイブとダウンロード入口",
      entriesBadge: (count) => `${count} 件`,
      metricsTotal: "譜面数",
      metricsCategories: "分類数",
      metricsVersions: "バージョン数",
      metricsArtists: "アーティスト数",
      metricsUpdated: "更新",
      branchesTitle: "バージョン別に見る",
      branchesDescription: "初代 maimai から最新作まで、バージョンを選んで閲覧できます。",
      versionsCta: "すべてのバージョン",
      latestTitle: "最新譜面",
      latestDescription: "リモートディレクトリから最近インデックスされた譜面とそのジャケット。",
      openDetail: "詳細を見る",
      pipelineTitle: "データパイプライン",
      pipelineDescription: "リモートディレクトリの走査、maidata 解析、静的カタログ生成。",
      pipelineBadge: "リモートインデックス構築",
      staticTitle: "静的出力",
      staticDescription: "Next.js 16 の静的エクスポートで静的ホスティングに対応。",
      staticBadge: "Bun + Turbopack",
      downloadsTitle: "ダウンロード",
      downloadsDescription: "ビルド時に検出したリモートディレクトリの内容からダウンロード操作を生成します。",
      downloadsBadge: "リモートディレクトリ駆動",
      faqHeading: "よくある質問",
      faq: (total, versions) => [
        {
          id: "what-is-astrodx",
          q: "AstroDX とは？",
          a: "AstroDX はコミュニティ製の maimai 風リズムゲームシミュレーターです。本サイト「ADX 譜面アーカイブ」は AstroDX 譜面を収録し、メタデータ・ジャケット・ダウンロードリンクを提供する非公式アーカイブです。",
        },
        {
          id: "what-is-maimai-dx",
          q: "maimai DX とは？",
          a: "maimai DX は SEGA のアーケードリズムゲームで、AstroDX 譜面はそのプレイ形式を再現します。本カタログは FESTiVAL・PRiSM・BUDDiES・UNiVERSE などの maimai DX バージョンごとに譜面を分類しています。",
        },
        {
          id: "how-to-download",
          q: "譜面はどうやってダウンロードしますか？",
          a: "各譜面の詳細ページを開き、サイト内ダウンロードボタンを使うと、リモートの AstroDX ディレクトリから構築された譜面パッケージを取得できます。",
        },
        {
          id: "how-to-import",
          q: "譜面を AstroDX にインポートするには？",
          a: "本サイトの .adx は展開せずそのまま取り込めます。iOS はファイル App で AstroDX フォルダ自体へ移動（中の levels ではありません）。Android は .adx をタップして AstroDX で開くか、長押しして「共有 → AstroDX」。初回の取り込み前に一度ゲームを起動しておいてください。詳しい手順はガイドを参照。",
        },
        {
          id: "catalog-size",
          q: "アーカイブには何曲ありますか？",
          a: `現在 ${total} 曲の譜面を ${versions} 個の maimai DX バージョン分類で収録しており、リモートディレクトリの更新に合わせて随時追加されます。`,
        },
      ],
      faqEntryId: "what-is-astrodx",
    },
    charts: {
      title: "譜面一覧",
      description: "分類、バージョン、表示言語で AstroDX エントリを閲覧します。",
      intro: (count, versions) =>
        `本カタログは ${count} 曲の譜面を ${versions} 個の maimai DX バージョン分類で収録しています。分類・バージョン・表示言語で閲覧できます。`,
    },
    statusPage: {
      title: "サーバー状態",
      loading: "読み込み中",
    },
    catalogBrowser: {
      searchPlaceholder: "曲名、ローマ字、別名、アーティスト、譜面制作者、バージョンで検索...",
      searchLabel: "譜面を検索",
      randomChart: "ランダム譜面",
      allCategories: "すべての分類",
      allSubcategories: "すべてのバージョン",
      allGenres: "すべてのジャンル",
      aliasMatchLabel: "別名一致",
      newBadge: "NEW",
      newBadgeHint: "直近 2 週間に追加",
      details: "詳細",
      download: "ダウンロード",
      source: "配布元",
      emptyState:
        "一致する譜面は見つかりませんでした。ローマ字表記、別名、アーティスト名でもお試しください。",
      clearSearch: "検索をクリア",
      clearFilters: "フィルターをすべて解除",
      activeFiltersLabel: "適用中のフィルター",
      removeFilter: (label) => `フィルターを解除：${label}`,
      advancedFilters: "詳細フィルター",
      filterAll: "すべて",
      filterVersion: "バージョン",
      filterLevel: "レベル",
      filterGenre: "ジャンル",
      filterCabinet: "種別",
      filterBpm: "BPM",
      filterAssets: "収録",
      filterDesigner: "譜面制作者",
      designerSearchPlaceholder: "譜面制作者名を入力…",
      designerListLabel: "譜面制作者の候補",
      designerNoMatch: "該当する譜面制作者はいません",
      chipCountLabel: (label, count) => `${label}（${count} 譜面）`,
      sortLabel: "並び替え",
      sortOptions: {
        default: "既定の並び",
        imported: "新着順",
        "level-desc": "レベルの高い順",
        "level-asc": "レベルの低い順",
        "bpm-desc": "BPM の高い順",
        "bpm-asc": "BPM の低い順",
        "title-asc": "曲名 A→Z",
      },
      emptySuggestionsTitle: "条件をひとつ外してみましょう：",
      dropFilterSuggestion: (label, count) => `「${label}」を外す → ${count} 件`,
      filterSearch: "検索語",
      cabinetStandard: "スタンダード",
      cabinetUtage: "宴会場",
      assetHasPv: "BGA 動画あり",
      assetNoPv: "BGA 動画なし",
      resultsSummary: (count) => `全 ${count} 譜面`,
      previousPage: "前へ",
      nextPage: "次へ",
      goToPage: (page) => `${page} ページ目`,
      pageLabel: (current, total) => `${current} / ${total} ページ`,
      rangeLabel: (start, end, total) => `${total} 件中 ${start}-${end} 件を表示`,
      selectMode: "複数選択",
      exitSelectMode: "選択終了",
      selectAll: "現在の結果を全選択",
      selectAllFiltered: (count) => `${count} 件の結果を全選択`,
      selectAllVersions: (count) => `${count} バージョンを全選択`,
      clearSelection: "クリア",
      selectedCount: (count) => `${count} 曲選択中`,
      batchDownload: "まとめてダウンロード",
      batchDefaultName: "AstroDX Charts",
      levelFilterLabel: "レベルで絞り込み",
      allLevels: "すべてのレベル",
      levelOption: (level) => `レベル ${level}`,
      rangeMin: "最小",
      rangeMax: "最大",
      levelRangeLabel: (low, high) => (low === high ? `レベル ${low}` : `レベル ${low}〜${high}`),
      bpmRangeLabel: (low, high) => (low === high ? `BPM ${low}` : `BPM ${low}〜${high}`),
      specsLoading: "ダウンロードリストを読み込み中…",
      specsError: "ダウンロードリストの読み込みに失敗しました。しばらくしてからもう一度お試しください。",
    },
    detail: {
      onsiteDownload: "サイト内ダウンロード",
      onsitePending: "サイト内ダウンロード準備中",
      downloadFormatLabel: "形式を選択",
      downloadFormatRecommended: "推奨",
      formatHintAdx: "AstroDX インポート形式・推奨",
      downloadIncludeVideo: "BGA 動画を含める",
      downloadPreparing: "ディレクトリを読み込み中",
      downloadPacking: (completed, total) => `ダウンロードして圧縮中（${completed}/${total}）`,
      downloadSuccess: "ダウンロードを開始しました",
      downloadErrorPrefix: "ダウンロード失敗: ",
      sourceLink: "配布元リンク",
      metadata: "譜面情報",
      metadataDescription: "リモートの AstroDX ディレクトリのリソースから直接解析しています。",
      difficulties: "難易度",
      source: "出典",
      sourceDescription: "リモートの AstroDX ディレクトリインデックスから構築。",
      breadcrumbLabel: "パンくずリスト",
      versionLabel: "バージョン",
      genreLabel: "ジャンル",
      bpmLabel: "BPM",
      bpmVariableLabel: (range) => `${range}（変速）`,
      durationLabel: "長さ",
      shortIdLabel: "短縮 ID",
      aliasesLabel: "別名",
      unknownValue: "不明",
      notAvailableValue: "なし",
      tableDifficulty: "難易度",
      tableLevel: "レベル",
      tableCharter: "譜面作者",
      tableNotes: "ノーツ数",
      noteTypeTap: "Tap",
      noteTypeHold: "Hold",
      noteTypeSlide: "Slide",
      noteTypeTouch: "Touch",
      noteTypeTouchHold: "Touch Hold",
      noteTypeBreak: "Break",
      statsTitle: "譜面データ",
      statsDescription: "ビルド時に maidata を解析して得たノーツ数・長さ・ファイルサイズ。",
      statsNotesLabel: "最多ノーツ数",
      statsDownloadLabel: "ダウンロード容量",
      sizeEstimate: (size) => `約 ${size}`,
      sizeEstimateWithVideo: (total, video) => `約 ${total}（うち BGA ${video}）`,
      sourceMaidataLabel: "譜面ファイル",
      licenseLabel: "ライセンス表記",
      levelConstantHint: "太字が表示レベル、薄い数字が譜面定数です。",
      preview: "プレビュー",
      previewDescription: "PV の視聴や音源の試聴ができます（リモートディレクトリ提供）。",
      actionsLabel: "譜面の操作",
      chartPreview: "譜面プレビュー",
      chartPreviewDescription: "ブラウザで譜面を音源と同期して再生します。",
      chartPreviewAt: (difficulty) => `${difficulty} をプレビュー`,
      pvLabel: "PV 映像",
      audioLabel: "音源試聴",
      mediaUnsupported: "お使いのブラウザはこのメディアの再生に対応していません。",
      volumeLabel: "音量",
      muteLabel: "ミュート",
      comments: "コメント",
      relatedTitle: "関連する譜面",
      relatedDescription: "同じアーティスト・ジャンル・バージョンから選んだ譜面。",
      relatedReasonArtist: "同じアーティスト",
      relatedReasonGenre: "同じジャンル",
      relatedReasonVersion: "同じバージョン",
      commentsLoading: "コメントを読み込み中…",
      commentsError: "コメントを読み込めませんでした。接続を確認して再試行してください。",
      commentsRetry: "再試行",
      share: "共有",
      shareCopied: "リンクをコピーしました",
    },
    downloads: {
      sourcePicker: {
        label: "ダウンロード回線",
        options: {
          r2: { name: "R2", description: "既定で選択される Cloudflare R2 メイン回線" },
          alice: { name: "Alice", description: "Alice ダウンロード回線" },
          tsumugi: { name: "Tsumugi", description: "Tsumugi ダウンロード回線" },
          awmc: { name: "AWMC", description: "AWMC ダウンロード回線" },
          g510: { name: "G510", description: "G510 ダウンロード回線" },
          g400s: { name: "G400s", description: "G400s ダウンロード回線" },
          custom: { name: "カスタム", description: "同じパス構成の独自ミラーを使用" },
        },
        statuses: {
          available: "利用可能",
          degraded: "混雑中",
          maintenance: "メンテナンス中",
        },
        probe: {
          idle: "-- ms",
          testing: "測定中…",
          timeout: "タイムアウト",
          unavailable: "利用不可",
          unconfigured: "未設定",
        },
        badges: {
          primary: "おすすめ",
          backup: "予備",
          custom: "カスタム",
        },
        customUrlLabel: "カスタム回線 URL",
        customUrlPlaceholder: "https://mirror.example.com",
        customSaveAndTest: "保存して測定",
        customReset: "R2 に戻す",
        customHint: "この端末にのみ保存されます。ミラーには同じパス構成とクロスオリジンダウンロードの許可が必要です。",
        customInvalid: "認証情報・クエリ・フラグメントを含まない有効な HTTPS URL を入力してください（ローカル開発では HTTP 可）。",
        manageInSettings: "右上の設定からカスタム回線を追加・管理できます。",
        switchAndRestart: "回線を切り替えて続行",
        restartHint: "完了済みファイルは保持され、未完了ファイルは新しい回線で最初からダウンロードされます。",
      },
      trayTitle: "ダウンロード",
      dismiss: "閉じる",
      resume: "再開",
      cancel: "キャンセル",
      paused: "一時停止中",
      pause: "一時停止",
      queued: "順番待ち — 先のダウンロードを待機中",
      queueSummary: (done, total) => `${total} 件中 ${done} 件が完了`,
      collapse: "ダウンロード一覧を折りたたむ",
      expand: "ダウンロード一覧を展開",
      jobsCount: (count) => `${count} 件のダウンロード`,
      archiving: "アーカイブを作成中…",
      completed: "保存しました — ブラウザのダウンロードをご確認ください",
      importHint: "ファイルを AstroDX にインポートするとプレイできます（.adx はそのままインポート可）。",
      confirmDiscard: "もう一度クリックするとダウンロード済みデータを破棄します",
      errorOffline: "オフラインです — 完了済みファイルは保持され、接続後に残りを再開できます",
      errorNetwork: "ダウンロードに失敗しました — 完了済みファイルを保持して残りを再試行できます",
      errorGeneric: "ダウンロードエラー — 完了済みファイルを保持して残りを再試行できます",
      batchSummary: (charts, files) => `${charts} 譜面、合計 ${files} ファイルをまとめます`,
      batchSplitSummary: (archives) =>
        `複数バージョンのため、${archives} 件のダウンロードに分けてキューに追加します（バージョンごとに 1 アーカイブ）`,
      batchSplitSummaryGenre: (archives) =>
        `複数ジャンルのため、${archives} 件のダウンロードに分けてキューに追加します（ジャンルごとに 1 アーカイブ）`,
      groupingLabel: "フォルダ分け",
      groupingVersion: "バージョン別",
      groupingGenre: "ジャンル別",
      batchVideoSummary: (count) => `${count} 件の BGA 動画を含みます`,
      batchNoVideoSummary: "BGA 動画なしで軽めにダウンロードします",
      batchVideoLargeHint:
        "BGA 動画を含めるとサイズが大きくなります。低速回線やモバイル通信ではオフ推奨です。",
      batchConfirm: (count, includeVideo) =>
        includeVideo
          ? `${count} 譜面を BGA 動画込みで開始しますか？`
          : `${count} 譜面のダウンロードを開始しますか？`,
      batchConfirmStart: "開始する",
      etaRemaining: (clock) => `残り ${clock}`,
      errorMissing:
        "サーバーにこのファイルがありません。別の配信元なら存在する可能性があります（同じ配信元での再試行は無意味です）。",
      errorServer:
        "配信元が一時的に不調です。完了したファイルは保持されるので、時間をおくか配信元を切り替えてください。",
      errorDetailLabel: "エラーの詳細",
      copyDetail: "詳細をコピー",
      copiedDetail: "コピーしました",
      skippedTitle: "スキップした任意ファイル",
      skippedSummary: (count) =>
        `任意ファイル ${count} 件（ジャケットまたは BGA）をスキップしました。譜面本体は揃っています。`,
      autoSwitched: (name) => `${name} に自動で切り替えました`,
      autoResumed: (count) => `通信が回復したため、${count} 件のダウンロードを自動で再開しました`,
      checkpointsUnavailable:
        "ブラウザーのストレージに書き込めないため、再読み込み後の再開ができません。完了までこのページを開いたままにしてください。",
      storageTight: (available) =>
        `端末の空き容量は約 ${available} です。大量のダウンロードは途中で失敗する可能性があります。`,
      storageInsufficient: (available, required) =>
        `端末の空き容量は約 ${available} で、約 ${required} のダウンロードには足りません。空き容量を確保するか選択を減らしてください。`,
      historyTitle: "最近のダウンロード",
      historyDescription:
        "完了したダウンロードはこの端末に記録され、同じ内容をワンクリックで再取得できます。",
      historyEmpty: "完了したダウンロードはまだありません。",
      historyRerun: "もう一度ダウンロード",
      historyClear: "履歴を消去",
      historyEntrySummary: (files) => `${files} ファイル`,
    },
    preview: {
      loading: "譜面を読み込み中…",
      loadFailedTitle: "譜面の読み込みに失敗しました",
      loadFailedBody: "譜面データを取得できませんでした。通信環境を確認して再試行してください。",
      retry: "再試行",
      audioFailedBody: "音声の読み込みに失敗しました。再試行するか、音声なしで再生できます。",
      playWithoutAudio: "音声なしで再生",
      audioLoading: "音声を読み込み中…",
      canvasLabel: (title) => `譜面プレビュー：${title}`,
      keyboardHint: "プレーヤーをクリックまたはフォーカスするとキーボードショートカットが使えます。",
      prevMeasure: "前の小節",
      prevPosition: "少し戻る",
      play: "再生",
      pause: "一時停止",
      nextPosition: "少し進む",
      nextMeasure: "次の小節",
      replayMeasure: "現在の小節を再生",
      progress: "再生位置",
      soundOn: "判定音をオン",
      soundOff: "判定音をオフ",
      settings: "設定",
      fullscreen: "全画面",
      exitFullscreen: "全画面を終了",
      lockUi: "UI をロック（プレイ中の誤タップ防止）",
      unlockUi: "UI のロックを解除",
      rotateView: (currentDeg) => `画面を回転（現在 ${currentDeg}°、タップで +90°）`,
      copyFrame: "現在のフレームをコピー",
      copyTimeUrl: "現在の時間点リンクをコピー",
      exportMenu: "画面エクスポート",
      shareFrame: "システム共有",
      saveFrame: "現在のフレームを保存",
      gifCancel: "GIF エクスポートをキャンセル",
      gifRangeHint: (duration) => `範囲 ${duration}。タイムラインのハンドルをドラッグして調整`,
      gifRangeTooLong: (max) => `GIF は最長 ${max} です。範囲を短くしてください`,
      exportGif: "GIF を書き出す",
      loopRange: "A-B リピート",
      loopRangeOff: "A-B リピートを解除",
      loopActiveHint: (duration) => `${duration} の区間をリピート中`,
      speedPanel: "速度",
      hudCombo: "コンボ",
      hudBreakNoEx: "保護なし",
      hudNoteTotalToggle: "画面内コンボ表示",
      hudBreakCountToggle: "画面内 BREAK 数表示",
      exportingPercent: (percent) => `書き出し中 ${percent}%`,
      cancel: "キャンセル",
      gifExportedTitle: "書き出し完了",
      gifExportedBody: "GIF をダウンロードしました",
      gifFailedTitle: "書き出しに失敗しました",
      gifFailedBody: "GIF を生成できませんでした",
      frameSavedTitle: "保存しました",
      frameSavedBody: "現在のフレームを PNG で保存しました",
      frameFailedTitle: "書き出しに失敗しました",
      frameFailedBody: "現在のフレームを取得できませんでした",
      copiedTitle: "コピーしました",
      copiedBody: "現在のフレームをクリップボードにコピーしました",
      copyFailedTitle: "コピーに失敗しました",
      copyFailedBody: "クリップボードを利用できません",
      simaiTitle: "Simai 記述",
      resumeAutoScroll: "自動スクロールを再開",
      legendLabel: "ノーツの種類",
      noteTap: "Tap",
      noteHold: "Hold",
      noteSlide: "Slide",
      noteTouch: "Touch",
      noteBreak: "Break",
    },
    assets: { audio: "音源", jacket: "ジャケット", pv: "PV", dxChart: "DX 譜面" },
    cover: {
      alt: (title) => `${title} ジャケット`,
      placeholder: "AstroDX ジャケットプレースホルダー",
    },
    footer: {
      description: "ADX 谱面资源 — リモートディレクトリから構築した非公式インデックス。",
      lastUpdated: (date) => `カタログ更新: ${date}`,
      disclaimer: "非公式のファンメイドアーカイブです。AstroDX および maimai の権利は各所有者に帰属します。",
      aiNotice: "本プロジェクトは Claude と GPT の共同開発です。すべてのコンテンツは AI により生成されています。",
      mitLicense: { before: "本サイトのソースコードは ", link: "MIT License", after: " の下で公開されています。" },
      sourceLabel: "ソース",
      getAppLabel: "AstroDX を入手",
      navLabel: "フッター",
    },
    pageViews: {
      siteViews: "総アクセス数",
      siteVisitors: "訪問者数",
      pageViews: "ページ閲覧数",
      views: "閲覧数",
      unavailable: "取得できません",
    },
    versions: {
      title: "バージョンで閲覧",
      description: "maimai DX バージョン別に AstroDX 譜面を閲覧します。",
      navLabel: "バージョン",
      backToIndex: "バージョン一覧へ",
      intro: (count) => `${count} 個のバージョン分類。`,
      chartCount: (count) => `${count} 曲`,
      unknownLabel: "未分類",
      detailTitle: (label) => `${label} の譜面`,
      detailIntro: (label, count) =>
        `「${label}」バージョンの ${count} 曲の AstroDX 譜面。オンラインで閲覧・ダウンロードできます。`,
      selectedVersionsCount: (count) => `${count} バージョン選択中`,
    },
    guestbook: {
      navLabel: "ゲストブック",
      title: "ゲストブック",
      description: "メッセージやフィードバック、雑談などお気軽にどうぞ。",
      intro:
        "ご意見・ご提案・ご質問をお寄せください。コメントは Artalk によって提供され、匿名でもサインインしても投稿できます。",
      prefill: {
        pending: "入力内容をコメント欄へ転記しています…",
        success:
          "入力内容を下のコメント欄に転記しました。内容を確認して送信すると完了です。",
        failedTitle: "コメント欄への自動入力に失敗しました",
        failedBody:
          "コメント機能が読み込めなかった可能性があります。入力内容は下に残っているので、コピーして手動で貼り付けるか、コミュニティ経由でお知らせください。",
        draftLabel: "入力した内容",
        copy: "内容をコピー",
        copied: "コピーしました",
      },
    },
    links: {
      navLabel: "リンク",
      title: "リンク集",
      description: "maimai / AstroDX 関連のおすすめサイト・ツール。",
      intro:
        "これらのサイト・ツールは当アーカイブとは無関係で、コミュニティ向けに紹介しています。外部リンクのご利用はご自身の判断でお願いします。",
      visitLink: (name) => `${name} にアクセス`,
    },
    community: {
      navLabel: "コミュニティ",
      title: "コミュニティ",
      description: "プレイヤーコミュニティに参加して、譜面やゲームについて交流しましょう。",
      intro: "以下は本サイト関連のプレイヤーグループです。カードをクリックすると参加できます。",
      join: (name) => `${name}に参加`,
    },
    donate: {
      navLabel: "寄付",
      title: "寄付・サポート",
      description: "本サイトがお役に立ちましたら、コーヒー一杯分の応援をお願いします。",
      intro:
        "サーバーと帯域のコストは個人で負担しています。皆さまのサポートが継続運営の支えになります。",
      open: (name) => `${name}を開く`,
      viewOnExplorer: "Tronscan で確認",
      addressTitle: "USDT (TRC20)",
      addressDescription: "TRC20 ネットワーク経由で以下のアドレスに USDT を送金できます。",
      copyAddress: "アドレスをコピー",
      copied: "コピーしました",
      thanks: "すべてのサポーターの皆さまに感謝します！",
    },
    resources: {
      official: "AstroDX",
      wiki: "Wiki",
      video: "デモ動画",
      cloudDrive: "クラウド",
      netDisk: "オンラインストレージ",
    },
    about: {
      navLabel: "サイトについて",
      title: "本サイトについて",
      description: "サイトの紹介、連絡先、オープンソース情報と謝辞。",
    },
    license: { navLabel: "ライセンスと出典" },
    guide: {
      navLabel: "使い方ガイド",
      title: "導入とトラブル解決",
      description:
        "AstroDX のインストールから最初の 1 曲を取り込むまで、そして詰まったときの対処法。",
      intro:
        "本サイトが配布しているのは譜面だけで、AstroDX 本体は別途インストールが必要です。以下は「アプリを入れる → 譜面を探して落とす → 取り込む → トラブル対処」の順で、Android と iOS では手順が異なります。お使いの端末に合わせてお読みください。",
      tocLabel: "このページの目次",
    },
    music: {
      navLabel: "ミュージック",
      title: "ミュージックライブラリ",
      description: "収録楽曲を maimai のバージョンごとに連続再生します。",
      intro:
        "バージョンを選ぶと再生が始まります。プレイヤーは画面左下に常駐し、ページを移動しても再生は途切れません。曲リストは最初の再生時に読み込まれます。",
      trackCount: (count) => `${count} 曲`,
      playVersion: (name) => `${name} を再生`,
      empty: "再生できる曲がまだありません。",
    },
    changelog: {
      navLabel: "更新履歴",
      title: "更新履歴",
      description: "収録日ごとにまとめた譜面の追加記録。",
      intro:
        "各グループがカタログ同期 1 回分で、新しいものが上に並びます。件数の多いバージョンは先頭の数曲だけを表示し、残りはバージョン別のカタログから確認できます。",
      batchHeading: (date) => `${date} に追加`,
      batchCount: (count) => `${count} 曲`,
      viewRest: (count) => `残り ${count} 曲を見る`,
      versionsLabel: "対象バージョン",
      versionLink: (name, count) => `${name}（${count} 曲）`,
      moreVersions: (count) => `ほか ${count} バージョン`,
      empty: "収録日つきの記録はまだありません。",
    },
    post: {
      navLabel: "投稿",
      title: "譜面の投稿",
      description: "収録してほしい譜面があれば、こちらから推薦できます。",
      intro:
        "フォームに記入して送信すると、内容がゲストブックのコメント欄に自動で入力されます。確認して投稿すれば完了です。管理人ができるだけ早く対応します。",
      songTitleLabel: "曲名（別名も可）",
      songTitlePlaceholder: "例：系ぎて / Tsunagite",
      sourceLabel: "譜面の入手元 / ダウンロードリンク",
      sourcePlaceholder: "例：majdata.net のリンク、クラウドのリンクなど",
      notesLabel: "補足（任意）",
      notesPlaceholder: "例：譜面作者、難易度、収録バージョンなど",
      requiredHint: "曲名と入手元を先に入力してください。",
      songTitleRequired: "曲名を入力してください。",
      sourceRequired: "入手元またはダウンロードリンクを入力してください。",
      submit: "ゲストブックで投稿する",
      submitting: "ゲストブックへ移動しています…",
      composedTitle: "【譜面投稿】",
    },
    survey: {
      navLabel: "アンケート",
      title: "アンケート",
      description: "1 分だけ、使い心地を教えてください。",
      intro:
        "皆さまの回答が今後の改善につながります！送信すると回答がゲストブックのコメント欄に自動で入力されるので、確認して投稿してください。",
      selectPlaceholder: "選択してください…",
      platformLabel: "AstroDX をどのプラットフォームで遊んでいますか？",
      platformOptions: [
        { value: "Android", label: "Android" },
        { value: "iOS", label: "iOS / iPadOS" },
        { value: "その他", label: "その他 / まだ遊んでいない" },
      ],
      discoverLabel: "本サイトをどこで知りましたか？",
      discoverPlaceholder: "例：友人の紹介、検索エンジン、コミュニティなど",
      satisfactionLabel: "本サイトの総合的な満足度は？",
      satisfactionOptions: [
        { value: "5", label: "5 - とても満足" },
        { value: "4", label: "4 - 満足" },
        { value: "3", label: "3 - ふつう" },
        { value: "2", label: "2 - 不満" },
        { value: "1", label: "1 - とても不満" },
      ],
      wishLabel: "いちばん追加してほしい機能・コンテンツは？",
      wishPlaceholder: "例：譜面の追加、検索の改善、ダークモードの調整など",
      otherLabel: "そのほかのご意見（任意）",
      otherPlaceholder: "伝えたいことがあれば何でもどうぞ",
      requiredHint: "プラットフォームと満足度を先に選択してください。",
      platformRequired: "プレイしているプラットフォームを選択してください。",
      satisfactionRequired: "全体の満足度を選択してください。",
      submit: "ゲストブックで送信する",
      submitting: "ゲストブックへ移動しています…",
      composedTitle: "【アンケート回答】",
    },
    notFound: {
      title: "ページが見つかりません",
      description:
        "お探しのページは存在しないか、移動しました。ホームまたは譜面一覧からお探しください。",
      backHome: "ホームへ戻る",
      browseCharts: "譜面一覧を見る",
      searchLabel: "譜面を検索",
      searchSubmit: "検索",
    },
    errorPage: {
      title: "エラーが発生しました",
      description:
        "このページをブラウザで読み込めませんでした。多くの場合は再試行で解決します。繰り返す場合はゲストブックからお知らせください。",
      retry: "再試行",
      backHome: "ホームへ戻る",
      browseCharts: "譜面一覧を見る",
      detailsLabel: "エラーの詳細",
    },
    connection: {
      offline: "オフラインです。一部のコンテンツを読み込めない場合があります。",
      restored: "オンラインに復帰しました。",
    },
    offline: {
      title: "オフラインです",
      description:
        "ネットワークに接続できません。キャッシュ済みのページやジャケットは引き続き閲覧できます。接続が回復したら再試行してください。",
      retry: "再試行",
      backHome: "ホームへ戻る",
    },
    localeBanner: {
      continueIn: "日本語で続ける",
      dismiss: "閉じる",
    },
    seo: {
      home: "maimai 系譜面を収録する非公式の AstroDX 譜面アーカイブ。楽曲メタデータ、ジャケット、難易度定数、BPM を掲載し、バージョン別の閲覧、検索、オンラインプレビュー、AstroDX シミュレーターへのダウンロードに対応しています。",
      charts:
        "収録されている AstroDX 譜面をすべて閲覧。maimai DX のバージョン分類、カテゴリ、表示言語で絞り込め、各曲のジャケット、難易度レベル、譜面定数、BPM を確認しながらオンラインでプレビュー・ダウンロードできます。",
      versions:
        "すべての AstroDX 譜面を maimai DX のバージョン分類別に閲覧。初代 maimai から最新バージョンまで整理し、各バージョンの収録曲数、ジャケット、難易度を確認しながらオンラインでプレビュー・ダウンロードできます。",
      versionDetail: (label, count) =>
        `maimai DX「${label}」バージョンに収録された ${count} 曲の AstroDX 譜面を一覧。各曲のジャケット、難易度レベル、譜面定数、BPM などの情報を掲載し、オンラインでの譜面プレビューと AstroDX シミュレーターへのダウンロードに対応しています。`,
      guestbook:
        "ADX 谱面资源のゲストブックで、ご意見・ご提案・ご質問・フィードバックをお気軽にどうぞ。ほかの maimai・AstroDX プレイヤーと交流できます。コメントは Artalk によって提供され、匿名でもサインインしても投稿できます。",
      links:
        "maimai と AstroDX に関連するおすすめのサイト、ツール、リソースをまとめたリンク集。スコア管理ツール、譜面ツール、コミュニティ、ガイドなど、maimai プレイヤーに役立つ情報を見つけやすくまとめています。",
      community:
        "AstroDX プレイヤーコミュニティに参加しましょう。QQ グループと Telegram グループで maimai 譜面について交流し、本サイトと AstroDX シミュレーターの最新情報を入手できます。",
      donate:
        "ADX 譜面アーカイブがお役に立ちましたら、爱发电・Patreon・USDT (TRC20) での寄付にご協力ください。サーバーと帯域のコスト維持に役立てられます。",
      about:
        "ADX 譜面アーカイブについて：非公式 AstroDX 譜面資料サイトの位置づけと運営方針、連絡先、オープンソースリポジトリと技術構成、謝辞、免責事項を掲載しています。",
      guide:
        "AstroDX の導入ガイド：Android と iOS それぞれのインストール方法、本サイトでの譜面の探し方とダウンロード（.adx / .zip / .tar.gz の違いと BGA について）、プラットフォーム別の取り込み手順、ダウンロードが止まる・書庫が開けない・譜面が表示されない・音源やジャケットが無いといったトラブルの対処法。",
      music:
        "ADX 譜面アーカイブのミュージックライブラリ：収録楽曲を maimai DX のバージョンごとに連続再生。ページを移動しても途切れず、バージョン切り替え・シャッフル・1 曲リピートにも対応しています。",
      changelog:
        "ADX 譜面アーカイブの更新履歴：新しく追加された AstroDX 譜面を収録日ごとに一覧。各バッチが対象とした maimai DX のバージョンと収録曲数を確認できます。",
      post:
        "ADX 譜面アーカイブへの譜面投稿：曲名と入手元を記入すると内容がゲストブックのコメント欄に自動入力され、投稿するだけで完了します。",
      survey:
        "ADX 譜面アーカイブのアンケートにご協力ください。プレイ環境や使い心地を教えていただくことで、今後の機能とコンテンツの方向性に反映されます。",
    },
  },
};

export function isSupportedLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function normalizeLocale(value?: string | null): Locale {
  if (value && isSupportedLocale(value)) {
    return value;
  }

  return defaultLocale;
}

export function getHtmlLang(value?: string | null): "zh-CN" | "en" | "ja" {
  const locale = normalizeLocale(value);

  if (locale === "zh") {
    return "zh-CN";
  }

  return locale;
}

export function getDictionary(locale?: string | null): SiteDictionary {
  return dictionaries[normalizeLocale(locale)];
}

export function getStaticPageMetadata(
  locale?: string | null
): Record<StaticPageMetadataKey, StaticPageMetadataEntry> {
  const normalizedLocale = normalizeLocale(locale);
  const dictionary = getDictionary(normalizedLocale);

  return {
    home: {
      pathname: "/",
      title: dictionary.home.title,
      description: dictionary.seo.home,
      keywords:
        normalizedLocale === "en"
          ? ["AstroDX", dictionary.siteName, "chart archive", "downloads", "catalog index"]
          : normalizedLocale === "ja"
            ? ["AstroDX", dictionary.siteName, "譜面アーカイブ", "ダウンロード", "統合カタログ"]
            : ["AstroDX", dictionary.siteName, "谱面资料站", "下载入口", "目录索引"],
    },
    charts: {
      pathname: "/charts",
      title: dictionary.charts.title,
      description: dictionary.seo.charts,
      keywords:
        normalizedLocale === "en"
          ? ["AstroDX", dictionary.siteName, "browse charts", "category filter", "display language"]
          : normalizedLocale === "ja"
            ? ["AstroDX", dictionary.siteName, "譜面一覧", "分類フィルタ", "表示言語"]
            : ["AstroDX", dictionary.siteName, "浏览曲目", "分类筛选", "显示语言"],
    },
  };
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized.replace(/\/+$/, "") || "/";
}

export function stripLocalePrefix(pathname: string): string {
  const normalized = normalizePathname(pathname);
  const segments = normalized.split("/").filter(Boolean);
  const [firstSegment, ...restSegments] = segments;

  if (!firstSegment || !isSupportedLocale(firstSegment)) {
    return normalized;
  }

  if (restSegments.length === 0) {
    return "/";
  }

  return `/${restSegments.join("/")}`;
}

export function buildLocalePath(pathname: string, locale: string): string {
  const targetLocale = normalizeLocale(locale);
  const basePath = stripLocalePrefix(pathname);

  if (targetLocale === defaultLocale) {
    return basePath;
  }

  if (basePath === "/") {
    return `/${targetLocale}`;
  }

  return `/${targetLocale}${basePath}`;
}

export function switchLocale(pathname: string, locale: string): string {
  return buildLocalePath(pathname, locale);
}
