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
  nav: {
    home: string;
    browse: string;
    search: string;
    community: string;
    skipToContent: string;
    primaryLabel: string;
    languageLabel: string;
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
  home: {
    badge: string;
    title: string;
    description: string;
    searchCta: string;
    browseCta: string;
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
    faq: (total: number, versions: number) => { q: string; a: string }[];
  };
  charts: {
    title: string;
    description: string;
    intro: (count: number, versions: number) => string;
  };
  searchPage: {
    title: string;
    description: string;
    intro: (count: number) => string;
  };
  statusPage: {
    title: string;
    description: string;
    sourceLink: string;
    loading: string;
    refreshing: string;
    lastUpdated: (value: string) => string;
    refreshNow: string;
    refreshFailed: string;
    parseFailed: string;
    networkUnavailable: string;
    overviewTitle: string;
    resourcesTitle: string;
    networkTitle: string;
    stateLabel: string;
    regionLabel: string;
    systemLabel: string;
    archLabel: string;
    lastReportLabel: string;
    cpuLabel: string;
    memoryLabel: string;
    swapLabel: string;
    diskLabel: string;
    loadLabel: string;
    processLabel: string;
    uploadTotalLabel: string;
    downloadTotalLabel: string;
    uploadSpeedLabel: string;
    downloadSpeedLabel: string;
    tcpLabel: string;
    udpLabel: string;
    resourceChartsTitle: string;
    resourceChartsDescription: string;
    networkChartsTitle: string;
    networkChartsDescription: string;
    waitingForHistory: string;
    cpuTrendLabel: string;
    loadTrendLabel: string;
    uploadSpeedTrendLabel: string;
    downloadSpeedTrendLabel: string;
    unavailable: string;
  };
  catalogBrowser: {
    searchPlaceholder: string;
    allCategories: string;
    allSubcategories: string;
    allGenres: string;
    /** Prefix shown on a result card when the query matched a song alias (别名), not its title. */
    aliasMatchLabel: string;
    details: string;
    download: string;
    source: string;
    emptyState: string;
    previousPage: string;
    nextPage: string;
    pageLabel: (current: number, total: number) => string;
    rangeLabel: (start: number, end: number, total: number) => string;
  };
  detail: {
    onsiteDownload: string;
    onsitePending: string;
    downloadPreparing: string;
    downloadPacking: (completed: number, total: number) => string;
    downloadSuccess: string;
    downloadErrorPrefix: string;
    sourceLink: string;
    metadata: string;
    metadataDescription: string;
    difficulties: string;
    assets: string;
    assetsDescription: string;
    source: string;
    sourceDescription: string;
    versionLabel: string;
    genreLabel: string;
    bpmLabel: string;
    shortIdLabel: string;
    aliasesLabel: string;
    unknownValue: string;
    notAvailableValue: string;
    tableDifficulty: string;
    tableLevel: string;
    tableCharter: string;
    preview: string;
    previewDescription: string;
    chartPreview: string;
    chartPreviewDescription: string;
    pvLabel: string;
    audioLabel: string;
    mediaUnsupported: string;
    volumeLabel: string;
    muteLabel: string;
    comments: string;
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
    sourceLabel: string;
    communityLabel: string;
  };
  pageViews: {
    siteViews: string;
    siteVisitors: string;
    pageViews: string;
  };
  versions: {
    title: string;
    description: string;
    navLabel: string;
    intro: (count: number) => string;
    chartCount: (count: number) => string;
    unknownLabel: string;
    detailTitle: (label: string) => string;
    detailIntro: (label: string, count: number) => string;
  };
  guestbook: {
    navLabel: string;
    title: string;
    description: string;
    intro: string;
  };
};

export type StaticPageMetadataKey = "home" | "charts" | "search" | "status";
export type StaticPageMetadataEntry = {
  pathname: "/" | "/charts" | "/search" | "/status";
  title: string;
  description: string;
  keywords: string[];
};

const dictionaries: Record<Locale, SiteDictionary> = {
  zh: {
    localeLabel: "中文",
    nav: {
      home: "首页",
      browse: "曲库",
      search: "搜索",
      community: "Telegram 社群",
      skipToContent: "跳到主要内容",
      primaryLabel: "主导航",
      languageLabel: "语言切换",
    },
    language: { zh: "中文", en: "English", ja: "日本語" },
    theme: { toggleLabel: "切换主题", light: "浅色", dark: "深色", system: "跟随系统" },
    home: {
      badge: "资料检索优先",
      title: "AstroDX 谱面资料站与下载入口。",
      description: "构建时扫描远端 AstroDX 目录，提取单曲元数据、谱面信息与统一索引。",
      searchCta: "搜索曲库",
      browseCta: "浏览版本",
      tagline: "资料与下载入口",
      entriesBadge: (count) => `${count} 条目`,
      metricsTotal: "收录谱面",
      metricsCategories: "分类数",
      metricsVersions: "版本数",
      metricsArtists: "曲师数",
      metricsUpdated: "目录更新",
      branchesTitle: "按版本浏览",
      branchesDescription: "从 maimai 初代到最新版本,挑一个版本开始浏览。",
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
          q: "AstroDX 是什么？",
          a: "AstroDX 是一款社区开发的 maimai 风格音乐游戏模拟器。本站「ADX 谱面资源」收录 AstroDX 谱面，提供元数据、封面与下载链接，是非官方的资料站。",
        },
        {
          q: "maimai DX 是什么？",
          a: "maimai DX 是 SEGA 的街机音乐游戏，AstroDX 谱面还原其玩法。本目录按 FESTiVAL、PRiSM、BUDDiES、UNiVERSE 等 maimai DX 版本归类谱面。",
        },
        {
          q: "如何下载谱面？",
          a: "打开任意谱面的详情页，使用站内下载按钮即可获取从远端 AstroDX 目录构建的谱面文件包。",
        },
        {
          q: "目录收录了多少谱面？",
          a: `目前共收录 ${total} 首谱面，覆盖 ${versions} 个 maimai DX 版本分支，并会随远端目录持续更新。`,
        },
      ],
    },
    charts: {
      title: "浏览曲目",
      description: "按分类、分支与显示语言浏览 AstroDX 目录条目。",
      intro: (count, versions) =>
        `本目录共收录 ${count} 首谱面，覆盖 ${versions} 个 maimai DX 版本分支，可按分类、分支与显示语言浏览。`,
    },
    searchPage: {
      title: "搜索",
      description: "按关键字、版本分支与谱面信息筛选目录。",
      intro: (count) => `在 ${count} 首已收录谱面中，按关键字、版本分支与谱面信息进行筛选。`,
    },
    statusPage: {
      title: "服务器状态",
      description: "查看公开监控页中的服务器关键状态与网络指标。",
      sourceLink: "查看原监控页",
      loading: "加载中",
      refreshing: "刷新中",
      lastUpdated: (value) => `上次刷新：${value}`,
      refreshNow: "立即刷新",
      refreshFailed: "刷新失败，显示的是上次成功数据",
      parseFailed: "监控页面结构已变化",
      networkUnavailable: "监控页面暂时无法访问",
      overviewTitle: "概览",
      resourcesTitle: "资源指标",
      networkTitle: "网络指标",
      stateLabel: "状态",
      regionLabel: "区域",
      systemLabel: "系统",
      archLabel: "架构",
      lastReportLabel: "最后上报时间",
      cpuLabel: "CPU",
      memoryLabel: "内存",
      swapLabel: "虚拟内存",
      diskLabel: "磁盘",
      loadLabel: "负载",
      processLabel: "进程数",
      uploadTotalLabel: "上传总量",
      downloadTotalLabel: "下载总量",
      uploadSpeedLabel: "上传速率",
      downloadSpeedLabel: "下载速率",
      tcpLabel: "TCP",
      udpLabel: "UDP",
      resourceChartsTitle: "资源趋势",
      resourceChartsDescription: "CPU、内存与磁盘占用趋势",
      networkChartsTitle: "网络趋势",
      networkChartsDescription: "上传与下载速率趋势",
      waitingForHistory: "等待更多数据",
      cpuTrendLabel: "CPU 趋势",
      loadTrendLabel: "负载趋势",
      uploadSpeedTrendLabel: "上传速率",
      downloadSpeedTrendLabel: "下载速率",
      unavailable: "暂无数据",
    },
    catalogBrowser: {
      searchPlaceholder: "搜索曲名、别名、曲师、版本...",
      allCategories: "全部分类",
      allSubcategories: "全部版本",
      allGenres: "全部曲风",
      aliasMatchLabel: "别名命中",
      details: "详情",
      download: "下载",
      source: "来源",
      emptyState: "没有匹配到曲目，请尝试别名、曲师或英文标题。",
      previousPage: "上一页",
      nextPage: "下一页",
      pageLabel: (current, total) => `第 ${current} / ${total} 页`,
      rangeLabel: (start, end, total) => `显示 ${start}-${end} / 共 ${total} 条`,
    },
    detail: {
      onsiteDownload: "站内下载",
      onsitePending: "站内下载待接入",
      downloadPreparing: "正在读取目录",
      downloadPacking: (completed, total) => `正在下载并打包（${completed}/${total}）`,
      downloadSuccess: "下载已开始",
      downloadErrorPrefix: "下载失败：",
      sourceLink: "来源链接",
      metadata: "谱面信息",
      metadataDescription: "直接解析自远端 AstroDX 目录资源。",
      difficulties: "难度列表",
      assets: "资源状态",
      assetsDescription: "从远端目录检测到的资源可用性。",
      source: "来源信息",
      sourceDescription: "基于远端 AstroDX 目录索引构建。",
      versionLabel: "版本",
      genreLabel: "曲风",
      bpmLabel: "BPM",
      shortIdLabel: "短 ID",
      aliasesLabel: "别名",
      unknownValue: "未知",
      notAvailableValue: "暂无",
      tableDifficulty: "难度",
      tableLevel: "等级",
      tableCharter: "谱师",
      preview: "预览",
      previewDescription: "在线观看 PV 或试听音频(资源来自远端目录)。",
      chartPreview: "谱面预览",
      chartPreviewDescription: "在浏览器中播放谱面,与音频同步。",
      pvLabel: "PV 影像",
      audioLabel: "音频试听",
      mediaUnsupported: "你的浏览器不支持播放该媒体。",
      volumeLabel: "音量",
      muteLabel: "静音",
      comments: "评论",
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
      sourceLabel: "源代码",
      communityLabel: "Telegram 社群",
    },
    pageViews: {
      siteViews: "本站总访问量",
      siteVisitors: "访客数",
      pageViews: "本页浏览量",
    },
    versions: {
      title: "按版本浏览",
      description: "按 maimai DX 版本浏览 AstroDX 谱面。",
      navLabel: "版本",
      intro: (count) => `共 ${count} 个版本分类。`,
      chartCount: (count) => `${count} 首`,
      unknownLabel: "未分类",
      detailTitle: (label) => `${label} 谱面`,
      detailIntro: (label, count) =>
        `「${label}」版本下的 ${count} 首 AstroDX 谱面,可在线浏览与下载。`,
    },
    guestbook: {
      navLabel: "留言板",
      title: "留言板",
      description: "在这里留言、反馈或闲聊。",
      intro: "欢迎留下你的想法、建议或问题。评论由 Artalk 提供支持，可匿名或登录后发表。",
    },
  },
  en: {
    localeLabel: "English",
    nav: {
      home: "Home",
      browse: "Browse",
      search: "Search",
      community: "Telegram Community",
      skipToContent: "Skip to main content",
      primaryLabel: "Primary",
      languageLabel: "Language",
    },
    language: { zh: "中文", en: "English", ja: "日本語" },
    theme: { toggleLabel: "Toggle theme", light: "Light", dark: "Dark", system: "System" },
    home: {
      badge: "Search-first archive",
      title: "AstroDX chart archive for browsing, indexing, and downloads.",
      description:
        "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment.",
      searchCta: "Search Catalog",
      browseCta: "Browse Releases",
      tagline: "Archive & Download Portal",
      entriesBadge: (count) => `${count} entries`,
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
          q: "What is AstroDX?",
          a: "AstroDX is a community-built simulator for maimai-style rhythm-game charts. This site, ADX 谱面资源, is an unofficial index of AstroDX charts with metadata, cover art, and download links.",
        },
        {
          q: "What is maimai DX?",
          a: "maimai DX is SEGA's arcade rhythm game, and AstroDX charts recreate its play format. The catalog groups charts by maimai DX versions such as FESTiVAL, PRiSM, BUDDiES, and UNiVERSE.",
        },
        {
          q: "How do I download a chart?",
          a: "Open any chart's detail page and use the on-site download button to fetch the chart package built from the remote AstroDX directory.",
        },
        {
          q: "How many charts are in the archive?",
          a: `The archive currently lists ${total} charts across ${versions} maimai DX version branches, and is updated as the remote directory changes.`,
        },
      ],
    },
    charts: {
      title: "Browse Charts",
      description:
        "Explore AstroDX directory entries by category, branch, and display language.",
      intro: (count, versions) =>
        `This catalog lists ${count} charts across ${versions} maimai DX version branches. Browse by category, branch, and display language.`,
    },
    searchPage: {
      title: "Search",
      description: "Filter the catalog by keyword, branch, and display language.",
      intro: (count) => `Search across ${count} archived charts by keyword, branch, and chart details.`,
    },
    statusPage: {
      title: "Server Status",
      description: "View key server health and network metrics from the public monitor page.",
      sourceLink: "Open Original Monitor",
      loading: "Loading",
      refreshing: "Refreshing",
      lastUpdated: (value) => `Last updated: ${value}`,
      refreshNow: "Refresh Now",
      refreshFailed: "Refresh failed. Showing the last successful snapshot.",
      parseFailed: "The monitor page structure has changed.",
      networkUnavailable: "The monitor page is temporarily unavailable.",
      overviewTitle: "Overview",
      resourcesTitle: "Resources",
      networkTitle: "Network",
      stateLabel: "State",
      regionLabel: "Region",
      systemLabel: "System",
      archLabel: "Architecture",
      lastReportLabel: "Last Report",
      cpuLabel: "CPU",
      memoryLabel: "Memory",
      swapLabel: "Swap",
      diskLabel: "Disk",
      loadLabel: "Load",
      processLabel: "Processes",
      uploadTotalLabel: "Upload Total",
      downloadTotalLabel: "Download Total",
      uploadSpeedLabel: "Upload Speed",
      downloadSpeedLabel: "Download Speed",
      tcpLabel: "TCP",
      udpLabel: "UDP",
      resourceChartsTitle: "Resource Trends",
      resourceChartsDescription: "CPU, memory, and disk usage over time",
      networkChartsTitle: "Network Trends",
      networkChartsDescription: "Upload and download throughput over time",
      waitingForHistory: "Waiting for more data",
      cpuTrendLabel: "CPU Trend",
      loadTrendLabel: "Load Trend",
      uploadSpeedTrendLabel: "Upload Speed",
      downloadSpeedTrendLabel: "Download Speed",
      unavailable: "Unavailable",
    },
    catalogBrowser: {
      searchPlaceholder: "Search title, alias, artist, version...",
      allCategories: "All Categories",
      allSubcategories: "All Versions",
      allGenres: "All Genres",
      aliasMatchLabel: "Alias match",
      details: "Details",
      download: "Download",
      source: "Source",
      emptyState:
        "No matching charts were found. Try an alias, artist, or English title.",
      previousPage: "Previous",
      nextPage: "Next",
      pageLabel: (current, total) => `Page ${current} of ${total}`,
      rangeLabel: (start, end, total) => `Showing ${start}-${end} of ${total}`,
    },
    detail: {
      onsiteDownload: "Onsite Download",
      onsitePending: "Onsite Download Pending",
      downloadPreparing: "Reading directory",
      downloadPacking: (completed, total) => `Downloading and packing (${completed}/${total})`,
      downloadSuccess: "Download started",
      downloadErrorPrefix: "Download failed: ",
      sourceLink: "Source Link",
      metadata: "Chart Metadata",
      metadataDescription: "Parsed directly from the remote AstroDX directory resources.",
      difficulties: "Difficulties",
      assets: "Assets",
      assetsDescription: "Resource availability detected from the remote directory.",
      source: "Source",
      sourceDescription: "Built from the remote AstroDX directory index.",
      versionLabel: "Version",
      genreLabel: "Genre",
      bpmLabel: "BPM",
      shortIdLabel: "Short ID",
      aliasesLabel: "Aliases",
      unknownValue: "Unknown",
      notAvailableValue: "Not available",
      tableDifficulty: "Difficulty",
      tableLevel: "Level",
      tableCharter: "Charter",
      preview: "Preview",
      previewDescription: "Watch the PV or listen to the audio (served from the remote directory).",
      chartPreview: "Chart preview",
      chartPreviewDescription: "Play the chart in your browser, synced to the audio.",
      pvLabel: "Promotion Video (PV)",
      audioLabel: "Audio preview",
      mediaUnsupported: "Your browser does not support playing this media.",
      volumeLabel: "Volume",
      muteLabel: "Mute",
      comments: "Comments",
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
      sourceLabel: "Source",
      communityLabel: "Telegram Community",
    },
    pageViews: {
      siteViews: "Site views",
      siteVisitors: "Visitors",
      pageViews: "Page views",
    },
    versions: {
      title: "Browse by Version",
      description: "Browse AstroDX charts by maimai DX version.",
      navLabel: "Versions",
      intro: (count) => `${count} version categories.`,
      chartCount: (count) => `${count} charts`,
      unknownLabel: "Uncategorized",
      detailTitle: (label) => `${label} charts`,
      detailIntro: (label, count) =>
        `${count} AstroDX charts in the "${label}" version, available to browse and download.`,
    },
    guestbook: {
      navLabel: "Guestbook",
      title: "Guestbook",
      description: "Leave a message, feedback, or just say hi.",
      intro:
        "Share your thoughts, suggestions, or questions. Comments are powered by Artalk — post anonymously or sign in.",
    },
  },
  ja: {
    localeLabel: "日本語",
    nav: {
      home: "ホーム",
      browse: "曲一覧",
      search: "検索",
      community: "Telegram コミュニティ",
      skipToContent: "メインコンテンツへ移動",
      primaryLabel: "メインナビ",
      languageLabel: "言語切り替え",
    },
    language: { zh: "中文", en: "English", ja: "日本語" },
    theme: { toggleLabel: "テーマ切り替え", light: "ライト", dark: "ダーク", system: "システム" },
    home: {
      badge: "検索優先アーカイブ",
      title: "AstroDX 譜面アーカイブとダウンロード入口。",
      description:
        "ビルド時に遠端 AstroDX ディレクトリを走査し、楽曲メタデータ、譜面解析、統合カタログを提供します。",
      searchCta: "カタログ検索",
      browseCta: "バージョン一覧",
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
      latestDescription: "最近インデックスされた遠端譜面とそのジャケット。",
      openDetail: "詳細を見る",
      pipelineTitle: "データパイプライン",
      pipelineDescription: "遠端ディレクトリの走査、maidata 解析、静的カタログ生成。",
      pipelineBadge: "遠端インデックス構築",
      staticTitle: "静的出力",
      staticDescription: "Next.js 16 の静的エクスポートで静的ホスティングに対応。",
      staticBadge: "Bun + Turbopack",
      downloadsTitle: "ダウンロード",
      downloadsDescription: "ビルド時に検出した遠端ディレクトリの内容からダウンロード操作を生成します。",
      downloadsBadge: "遠端ディレクトリ駆動",
      faqHeading: "よくある質問",
      faq: (total, versions) => [
        {
          q: "AstroDX とは？",
          a: "AstroDX はコミュニティ製の maimai 風リズムゲームシミュレーターです。本サイト「ADX 谱面资源」は AstroDX 譜面を収録し、メタデータ・ジャケット・ダウンロードリンクを提供する非公式アーカイブです。",
        },
        {
          q: "maimai DX とは？",
          a: "maimai DX は SEGA のアーケードリズムゲームで、AstroDX 譜面はそのプレイ形式を再現します。本カタログは FESTiVAL・PRiSM・BUDDiES・UNiVERSE などの maimai DX バージョンごとに譜面を分類しています。",
        },
        {
          q: "譜面はどうやってダウンロードしますか？",
          a: "各譜面の詳細ページを開き、サイト内ダウンロードボタンを使うと、遠端 AstroDX ディレクトリから構築された譜面パッケージを取得できます。",
        },
        {
          q: "アーカイブには何曲ありますか？",
          a: `現在 ${total} 曲の譜面を ${versions} 個の maimai DX バージョン分類で収録しており、遠端ディレクトリの更新に合わせて随時追加されます。`,
        },
      ],
    },
    charts: {
      title: "譜面一覧",
      description: "分類、バージョン、表示言語で AstroDX エントリを閲覧します。",
      intro: (count, versions) =>
        `本カタログは ${count} 曲の譜面を ${versions} 個の maimai DX バージョン分類で収録しています。分類・バージョン・表示言語で閲覧できます。`,
    },
    searchPage: {
      title: "検索",
      description: "キーワード、バージョン、譜面情報でカタログを絞り込みます。",
      intro: (count) => `収録済みの ${count} 曲から、キーワード・バージョン・譜面情報で絞り込めます。`,
    },
    statusPage: {
      title: "サーバー状態",
      description: "公開監視ページの主要なサーバー状態とネットワーク指標を確認します。",
      sourceLink: "元の監視ページを開く",
      loading: "読み込み中",
      refreshing: "更新中",
      lastUpdated: (value) => `最終更新: ${value}`,
      refreshNow: "今すぐ更新",
      refreshFailed: "更新に失敗したため、前回の正常なデータを表示しています。",
      parseFailed: "監視ページの構造が変更されました。",
      networkUnavailable: "監視ページに一時的にアクセスできません。",
      overviewTitle: "概要",
      resourcesTitle: "リソース",
      networkTitle: "ネットワーク",
      stateLabel: "状態",
      regionLabel: "地域",
      systemLabel: "システム",
      archLabel: "アーキテクチャ",
      lastReportLabel: "最終報告時刻",
      cpuLabel: "CPU",
      memoryLabel: "メモリ",
      swapLabel: "スワップ",
      diskLabel: "ディスク",
      loadLabel: "負荷",
      processLabel: "プロセス数",
      uploadTotalLabel: "総アップロード量",
      downloadTotalLabel: "総ダウンロード量",
      uploadSpeedLabel: "アップロード速度",
      downloadSpeedLabel: "ダウンロード速度",
      tcpLabel: "TCP",
      udpLabel: "UDP",
      resourceChartsTitle: "リソース推移",
      resourceChartsDescription: "CPU・メモリ・ディスク使用率の推移",
      networkChartsTitle: "ネットワーク推移",
      networkChartsDescription: "アップロードとダウンロード速度の推移",
      waitingForHistory: "より多くのデータを待っています",
      cpuTrendLabel: "CPU 推移",
      loadTrendLabel: "負荷推移",
      uploadSpeedTrendLabel: "アップロード速度",
      downloadSpeedTrendLabel: "ダウンロード速度",
      unavailable: "利用不可",
    },
    catalogBrowser: {
      searchPlaceholder: "曲名、別名、アーティスト、バージョンで検索...",
      allCategories: "すべての分類",
      allSubcategories: "すべてのバージョン",
      allGenres: "すべてのジャンル",
      aliasMatchLabel: "別名一致",
      details: "詳細",
      download: "ダウンロード",
      source: "配布元",
      emptyState:
        "一致する譜面は見つかりませんでした。別名、曲師名、英語タイトルも試してください。",
      previousPage: "前へ",
      nextPage: "次へ",
      pageLabel: (current, total) => `${current} / ${total} ページ`,
      rangeLabel: (start, end, total) => `${total} 件中 ${start}-${end} 件を表示`,
    },
    detail: {
      onsiteDownload: "サイト内ダウンロード",
      onsitePending: "サイト内ダウンロード準備中",
      downloadPreparing: "ディレクトリを読み込み中",
      downloadPacking: (completed, total) => `ダウンロードして圧縮中（${completed}/${total}）`,
      downloadSuccess: "ダウンロードを開始しました",
      downloadErrorPrefix: "ダウンロード失敗: ",
      sourceLink: "配布元リンク",
      metadata: "譜面情報",
      metadataDescription: "遠端 AstroDX ディレクトリのリソースから直接解析しています。",
      difficulties: "難易度",
      assets: "収録リソース",
      assetsDescription: "遠端ディレクトリから検出されたリソースの有無。",
      source: "出典",
      sourceDescription: "遠端 AstroDX ディレクトリインデックスから構築。",
      versionLabel: "バージョン",
      genreLabel: "ジャンル",
      bpmLabel: "BPM",
      shortIdLabel: "短縮 ID",
      aliasesLabel: "別名",
      unknownValue: "不明",
      notAvailableValue: "なし",
      tableDifficulty: "難易度",
      tableLevel: "レベル",
      tableCharter: "譜師",
      preview: "プレビュー",
      previewDescription: "PV の視聴や音源の試聴ができます(遠端ディレクトリ提供)。",
      chartPreview: "譜面プレビュー",
      chartPreviewDescription: "ブラウザで譜面を音源と同期して再生します。",
      pvLabel: "PV 映像",
      audioLabel: "音源試聴",
      mediaUnsupported: "お使いのブラウザはこのメディアの再生に対応していません。",
      volumeLabel: "音量",
      muteLabel: "ミュート",
      comments: "コメント",
    },
    assets: { audio: "音源", jacket: "ジャケット", pv: "PV", dxChart: "DX 譜面" },
    cover: {
      alt: (title) => `${title} ジャケット`,
      placeholder: "AstroDX ジャケットプレースホルダー",
    },
    footer: {
      description: "ADX 谱面资源 — 遠端ディレクトリから構築した非公式インデックス。",
      lastUpdated: (date) => `カタログ更新: ${date}`,
      disclaimer: "非公式のファンメイドアーカイブです。AstroDX および maimai の権利は各所有者に帰属します。",
      sourceLabel: "ソース",
      communityLabel: "Telegram コミュニティ",
    },
    pageViews: {
      siteViews: "総アクセス数",
      siteVisitors: "訪問者数",
      pageViews: "ページ閲覧数",
    },
    versions: {
      title: "バージョンで閲覧",
      description: "maimai DX バージョン別に AstroDX 譜面を閲覧します。",
      navLabel: "バージョン",
      intro: (count) => `${count} 個のバージョン分類。`,
      chartCount: (count) => `${count} 曲`,
      unknownLabel: "未分類",
      detailTitle: (label) => `${label} の譜面`,
      detailIntro: (label, count) =>
        `「${label}」バージョンの ${count} 曲の AstroDX 譜面。オンラインで閲覧・ダウンロードできます。`,
    },
    guestbook: {
      navLabel: "ゲストブック",
      title: "ゲストブック",
      description: "メッセージやフィードバック、雑談などお気軽にどうぞ。",
      intro:
        "ご意見・ご提案・ご質問をお寄せください。コメントは Artalk によって提供され、匿名でもサインインしても投稿できます。",
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
      description: dictionary.home.description,
      keywords:
        normalizedLocale === "en"
          ? ["AstroDX", "ADX 谱面资源", "chart archive", "downloads", "catalog index"]
          : normalizedLocale === "ja"
            ? ["AstroDX", "ADX 谱面资源", "譜面アーカイブ", "ダウンロード", "統合カタログ"]
            : ["AstroDX", "ADX 谱面资源", "谱面资料站", "下载入口", "目录索引"],
    },
    charts: {
      pathname: "/charts",
      title: dictionary.charts.title,
      description: dictionary.charts.description,
      keywords:
        normalizedLocale === "en"
          ? ["AstroDX", "ADX 谱面资源", "browse charts", "category filter", "display language"]
          : normalizedLocale === "ja"
            ? ["AstroDX", "ADX 谱面资源", "譜面一覧", "分類フィルタ", "表示言語"]
            : ["AstroDX", "ADX 谱面资源", "浏览曲目", "分类筛选", "显示语言"],
    },
    search: {
      pathname: "/search",
      title: dictionary.searchPage.title,
      description: dictionary.searchPage.description,
      keywords:
        normalizedLocale === "en"
          ? ["AstroDX", "ADX 谱面资源", "search", "chart search", "branch filter"]
          : normalizedLocale === "ja"
            ? ["AstroDX", "ADX 谱面资源", "検索", "キーワード", "譜面情報"]
            : ["AstroDX", "ADX 谱面资源", "搜索", "关键字筛选", "版本分支"],
    },
    status: {
      pathname: "/status",
      title: dictionary.statusPage.title,
      description: dictionary.statusPage.description,
      keywords:
        normalizedLocale === "en"
          ? ["AstroDX", "ADX 谱面资源", "server status", "monitor page", "network metrics"]
          : normalizedLocale === "ja"
            ? ["AstroDX", "ADX 谱面资源", "サーバー状態", "監視ページ", "ネットワーク指標"]
            : ["AstroDX", "ADX 谱面资源", "服务器状态", "监控页", "网络指标"],
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
