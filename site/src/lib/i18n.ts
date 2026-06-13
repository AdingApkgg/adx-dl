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
  };
  language: {
    zh: string;
    en: string;
    ja: string;
  };
  home: {
    badge: string;
    title: string;
    description: string;
    searchCta: string;
    browseCta: string;
  };
  charts: {
    title: string;
    description: string;
  };
  searchPage: {
    title: string;
    description: string;
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
    difficulties: string;
    assets: string;
    source: string;
  };
};

const dictionaries: Record<Locale, SiteDictionary> = {
  zh: {
    localeLabel: "中文",
    nav: { home: "首页", browse: "曲库", search: "搜索" },
    language: { zh: "中文", en: "English", ja: "日本語" },
    home: {
      badge: "资料检索优先",
      title: "AstroDX 谱面资料站与下载入口。",
      description: "构建时扫描远端 AstroDX 目录，提取单曲元数据、谱面信息与统一索引。",
      searchCta: "搜索曲库",
      browseCta: "浏览版本",
    },
    charts: {
      title: "浏览曲目",
      description: "按分类、分支与显示语言浏览 AstroDX 目录条目。",
    },
    searchPage: {
      title: "搜索",
      description: "按关键字、版本分支与谱面信息筛选目录。",
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
      searchPlaceholder: "搜索曲名、曲师、版本...",
      allCategories: "全部分类",
      allSubcategories: "全部子分类",
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
      difficulties: "难度列表",
      assets: "资源状态",
      source: "来源信息",
    },
  },
  en: {
    localeLabel: "English",
    nav: { home: "Home", browse: "Browse", search: "Search" },
    language: { zh: "中文", en: "English", ja: "日本語" },
    home: {
      badge: "Search-first archive",
      title: "AstroDX chart archive for browsing, indexing, and downloads.",
      description:
        "Built from remote AstroDX directory scans, with per-song metadata, chart parsing, and a unified catalog for static deployment.",
      searchCta: "Search Catalog",
      browseCta: "Browse Releases",
    },
    charts: {
      title: "Browse Charts",
      description:
        "Explore AstroDX directory entries by category, branch, and display language.",
    },
    searchPage: {
      title: "Search",
      description: "Filter the catalog by keyword, branch, and display language.",
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
      searchPlaceholder: "Search title, artist, version...",
      allCategories: "All Categories",
      allSubcategories: "All Subcategories",
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
      difficulties: "Difficulties",
      assets: "Assets",
      source: "Source",
    },
  },
  ja: {
    localeLabel: "日本語",
    nav: { home: "ホーム", browse: "曲一覧", search: "検索" },
    language: { zh: "中文", en: "English", ja: "日本語" },
    home: {
      badge: "検索優先アーカイブ",
      title: "AstroDX 譜面アーカイブとダウンロード入口。",
      description:
        "ビルド時に遠端 AstroDX ディレクトリを走査し、楽曲メタデータ、譜面解析、統合カタログを提供します。",
      searchCta: "カタログ検索",
      browseCta: "バージョン一覧",
    },
    charts: {
      title: "譜面一覧",
      description: "分類、バージョン、表示言語で AstroDX エントリを閲覧します。",
    },
    searchPage: {
      title: "検索",
      description: "キーワード、バージョン、譜面情報でカタログを絞り込みます。",
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
      searchPlaceholder: "曲名、アーティスト、バージョンで検索...",
      allCategories: "すべての分類",
      allSubcategories: "すべてのサブ分類",
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
      difficulties: "難易度",
      assets: "収録リソース",
      source: "出典",
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
