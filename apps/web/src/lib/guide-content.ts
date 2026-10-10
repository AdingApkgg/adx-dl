import {
  QQ_COMMUNITY,
  SITE_ISSUES_URL,
  TELEGRAM_COMMUNITY,
} from "@/lib/community-links";
import type { ContentSection } from "@/lib/content-sections";
import type { Locale } from "@/lib/i18n";
import {
  ASTRODX_APP_ISSUES_URL,
  ASTRODX_APP_STORE_URL,
  ASTRODX_RELEASES_URL,
  CHART_IMPORT_VIDEO_URL,
  wikiInstallUrl,
  wikiUrl,
} from "@/lib/resource-links";

/**
 * Everything below about installing the app and importing charts is transcribed
 * from the official wiki (wiki.astrodx.com, source at
 * github.com/reflektone-games/AstroDX_Wiki), not from how the app used to work.
 * Two places where a plausible-sounding answer is actually wrong:
 *
 * - iOS is on the App Store. The sideloading / TestFlight story is dead, and
 *   the wiki's own iOS page is stale on this point — its homepage is not.
 * - Charts are NOT placed in `levels/`. The user drops the `.adx` into the
 *   `AstroDX` folder (iOS) or opens it with the app (Android) and the game
 *   unpacks it. `levels/` and `collections/` are internal storage the game
 *   manages; the wiki calls out putting archives there as a known failure.
 *
 * If you rewrite this, re-read the wiki first — it is the only source of truth
 * for the app's behaviour, and it moves.
 */

/**
 * Section ids for /guide. Stable across locales (they are anchor targets that
 * must survive a language switch) and referenced by the page's own table of
 * contents, so they live here rather than as loose strings in the view.
 */
export const GUIDE_SECTION_IDS = [
  "install",
  "download",
  "import",
  "troubleshooting",
] as const;

export type GuideSectionId = (typeof GUIDE_SECTION_IDS)[number];

export const guideSections: Record<Locale, ContentSection[]> = {
  zh: [
    {
      id: "install",
      heading: "安装 AstroDX",
      blocks: [
        {
          type: "p",
          text: "AstroDX 是社区开发的 maimai 风格模拟器，本站只提供谱面，不分发应用本体。两个平台的下载渠道不同，请按你的设备选择。",
        },
        {
          type: "list",
          items: [
            "iOS / iPadOS：直接在 App Store 搜索并安装 AstroDX，官方推荐的稳定版本。（早期需要 TestFlight 或侧载 IPA 的说法已经过时。）",
            "Android：从 GitHub Releases 下载最新的 APK 安装，系统提示「允许安装未知来源应用」时手动放行即可。",
          ],
        },
        {
          type: "p",
          text: "装好之后、导入谱面之前，务必先把游戏完整启动一次——AstroDX 要在首次启动时初始化自己的文件目录，跳过这一步会导致后面导入的谱面无处安放。首次启动时曲库是空的，这是正常的。",
        },
        {
          type: "links",
          items: [
            { label: "App Store", url: ASTRODX_APP_STORE_URL, note: "iOS / iPadOS 稳定版（官方推荐）" },
            {
              label: "GitHub Releases",
              url: ASTRODX_RELEASES_URL,
              note: "Android APK，最新版本",
            },
            { label: "AstroDX Wiki", url: wikiUrl("zh"), note: "官方文档，本页内容以它为准" },
          ],
        },
      ],
    },
    {
      id: "download",
      heading: "在本站找谱与下载",
      blocks: [
        {
          type: "p",
          text: "曲库页支持按曲名、曲师、别名（罗马音也可以）搜索，也能按版本、曲风、定数、BPM 和资源状态筛选。找到想要的谱面后，点开详情页即可下载。",
        },
        {
          type: "p",
          text: "下载按钮旁的菜单可以选择打包格式，三种格式装的是同一批文件，区别只在压缩容器：",
        },
        {
          type: "list",
          items: [
            ".adx —— 推荐的 AstroDX 导入格式。Android 用「打开方式 / 分享」交给 AstroDX；iOS 移到 AstroDX 文件夹本身，再重新打开游戏。无需解压。",
            ".zip —— 通用压缩包，任何系统都能解压，适合先在电脑上整理再传到手机。",
            ".tar.gz —— 适合命令行环境或归档，不能仅改成 .adx 后直接导入。要导入游戏，请重新选择 .adx 格式下载。",
          ],
        },
        {
          type: "p",
          text: "带 BGA 的谱面会额外打包一段背景动画视频（pv.mp4）。它只影响背景演出，不影响判定；关闭「包含 BGA 视频」可以减少下载体积。手机上单首资源仍然很大时，建议关闭 BGA 或改用电脑下载。",
        },
        {
          type: "steps",
          items: [
            "手机批量下载会拆成独立的小批次。保持页面打开，等待本批打包完成后，逐个点击「保存文件」。",
            "在浏览器的下载记录中确认本批每个文件已下载完成；若没有文件或还需重试，先点「再次保存」，不要确认释放。",
            "确认保存后，点「已确认保存，继续下载」释放本批缓存并开始下一批；最后一批点「确认保存并释放缓存」。每个分包都要分别保存和导入，释放后仍可按保留的导入引导操作。",
          ],
        },
        {
          type: "p",
          text: "只有尚未移除任务或释放缓存时，刷新页面后才能从保留的已下载数据重新打包。释放后不能再次保存同一份缓存；整组选曲下载完成后，可从下载托盘的「最近下载」重新下载。整组未完成时，先完成剩余批次，或重新选曲下载。",
        },
        {
          type: "p",
          text: "站内提供多条下载线路。若当前线路速度不理想，可在设置面板里切换默认线路，或临时改用其他镜像。",
        },
      ],
    },
    {
      id: "import",
      heading: "导入谱面",
      blocks: [
        {
          type: "p",
          text: "AstroDX 认的是 .adx 文件——本质上就是一个把曲目文件夹整个装进去的 zip，只是把扩展名改成了 .adx。本站下载的 .adx 已经打好，直接用即可；如果你拿到的是 .zip，把扩展名改成 .adx 就行（改不了扩展名时，改成「文件名.adx.zip」同样有效）。",
        },
        {
          type: "steps",
          items: [
            "iOS / iPadOS：打开「文件」App，把 .adx 移动到带 AstroDX 应用图标的 AstroDX 文件夹里。注意是这个文件夹本身，不要放进它下面的 levels 或 collections。",
            "Android：在文件管理器里点一下 .adx，在「打开方式」里选择 AstroDX；如果列表里没有 AstroDX，就长按文件选择「分享」，再在分享菜单里选 AstroDX。",
            "在电脑上下载时：不用解压，把 .adx 原样传到手机即可——Mac 用 AirDrop，Windows / Linux 可以用 LocalSend（官方 Wiki 推荐）、数据线或网盘，然后按上面对应平台的步骤操作。",
          ],
        },
        {
          type: "p",
          text: "接着打开 AstroDX，会看到一条导入进度条；进度条走完进入选曲界面，新谱面就在列表里了。iOS 上是下次启动游戏时自动整理，Android 上是选完「用 AstroDX 打开」后立即开始。",
        },
        {
          type: "p",
          text: "AstroDX 文件夹下面的 levels 与 collections 是游戏自己管理的：levels 放谱面文件，collections 放合集信息（每个合集一份 manifest.json）。想手动编辑合集可以看官方 Wiki，但日常导入完全不需要碰它们。",
        },
        {
          type: "links",
          items: [
            {
              label: "视频教程 · 谱面导入",
              url: CHART_IMPORT_VIDEO_URL,
              note: "B 站实录，跟着做一遍最快",
            },
            { label: "Wiki · iOS / iPadOS 导入教程", url: wikiInstallUrl("zh", "ios"), note: "官方分步说明" },
            { label: "Wiki · Android 导入教程", url: wikiInstallUrl("zh", "android"), note: "含视频演示" },
          ],
        },
      ],
    },
    {
      id: "troubleshooting",
      heading: "常见故障",
      blocks: [
        {
          type: "qa",
          items: [
            {
              q: "下载卡住不动 / 速度极慢怎么办？",
              a: "多半是当前下载线路到你所在网络的链路不通畅。打开右上角设置面板，在「下载」里重新测速并切换到延迟更低的线路，然后重新开始任务。下载中断的任务可以在下载托盘里点重试，已完成的文件不会重复下载。",
            },
            {
              q: "手机批量下载停在保存阶段，下一批不开始？",
              a: "这是等待你确认本批保存的阶段。先逐个保存，在浏览器下载记录中确认文件已下载完成，再点「已确认保存，继续下载」；最后一批点「确认保存并释放缓存」。释放后不能直接再次保存；整组完成后可从下载托盘的「最近下载」重新下载，未完成时先完成剩余批次，或重新选曲。下载期间保持页面打开。",
            },
            {
              q: "显示已发起保存，但手机里找不到文件 / 下载成 .bin？",
              a: "「已发起保存」只表示浏览器收到保存请求，不代表文件已经落盘。先检查浏览器下载记录，完成后再到「文件」App 或文件管理器查找。缓存尚未释放时可点「再次保存」；若变成 .bin，先重试保存或改用 .zip 下载，再按导入步骤改名，勿直接把 .bin 改成 .adx。缓存已释放时，整组完成后从下载托盘的「最近下载」重新下载；未完成时先完成剩余批次，或重新选曲。",
            },
            {
              q: "压缩包打不开 / 提示文件损坏？",
              a: "先在浏览器下载记录中确认保存是否完成。缓存尚未释放时，优先点「再次保存」；仍然损坏或缓存已释放，再重新下载。.adx 无需手动解压；.zip 可改成 .adx 或「文件名.adx.zip」再导入；.tar.gz 不能仅改后缀直接导入，要玩谱面请重新下载 .adx，要解压归档请用支持 TAR.GZ 的工具。",
            },
            {
              q: "导入后 AstroDX 里看不到这首谱面？",
              a: "最常见的原因是把压缩包直接丢进了 levels 文件夹——官方 Wiki 专门把这条列为已知错误。正确做法是把 .adx 放到 AstroDX 文件夹本身（iOS），或用「打开方式 / 分享」交给 AstroDX（Android），由游戏自己解包。另外确认安装好之后已经完整启动过一次游戏，否则目录还没初始化；仍然看不到就重启一次应用。",
            },
            {
              q: "文件管理器里没有「打开方式」或「分享」（Android）？",
              a: "换一个文件管理器即可，官方 Wiki 推荐 ZArchiver 或 Android SAF。另外如果遇到 IOException: Permission denied，通常是文件管理器以高权限改写过谱面文件，导致 AstroDX 读不了，改用上述方式重新导入即可。",
            },
            {
              q: "iOS 上改不了文件扩展名？",
              a: "在「文件」App 里打开右上角更多菜单（三个点）→ 显示选项，勾选「显示所有文件扩展名」，然后长按文件重命名。实在改不了就把名字写成「文件名.adx.zip」，AstroDX 同样认。",
            },
            {
              q: "游戏里没有声音，或者封面是空白的？",
              a: "说明曲目文件夹里缺少 track.mp3 或 bg.png。部分上游谱面本来就没有附带音频或封面，谱面详情页顶部的资源标签会标明；如果详情页显示有、下载后却没有，请重新下载一次完整压缩包。",
            },
          ],
        },
        {
          type: "p",
          text: "还是没解决？欢迎带上谱面名称和具体现象来找我们：",
        },
        {
          type: "links",
          items: [
            { label: "GitHub Issues", url: SITE_ISSUES_URL, note: "本站的问题反馈与功能建议" },
            {
              label: "AstroDX 应用 Issues",
              url: ASTRODX_APP_ISSUES_URL,
              note: "游戏本体的 Bug 请提到上游仓库",
            },
            { label: "QQ 交流群", url: QQ_COMMUNITY, note: "国内玩家主要交流群" },
            { label: "Telegram 群组", url: TELEGRAM_COMMUNITY, note: "国际玩家与站点动态" },
          ],
        },
      ],
    },
  ],
  en: [
    {
      id: "install",
      heading: "Installing AstroDX",
      blocks: [
        {
          type: "p",
          text: "AstroDX is a community-built maimai-style simulator. This archive only hosts charts — it does not distribute the app itself. The two platforms get it from different places, so follow the one that matches your device.",
        },
        {
          type: "list",
          items: [
            "iOS / iPadOS: install AstroDX straight from the App Store — that is the stable release the project recommends. (Older guides describing TestFlight or a sideloaded IPA are out of date.)",
            "Android: download the latest APK from GitHub Releases. Android will ask you to allow installs from unknown sources, which you have to grant by hand.",
          ],
        },
        {
          type: "p",
          text: "Launch the game once before importing anything. AstroDX sets up its own folders on that first run, and skipping it leaves the charts you import with nowhere to go. An empty song list on that first launch is expected.",
        },
        {
          type: "links",
          items: [
            { label: "App Store", url: ASTRODX_APP_STORE_URL, note: "iOS / iPadOS stable release (recommended)" },
            {
              label: "GitHub Releases",
              url: ASTRODX_RELEASES_URL,
              note: "latest Android APK",
            },
            { label: "AstroDX Wiki", url: wikiUrl("en"), note: "the official docs this page follows" },
          ],
        },
      ],
    },
    {
      id: "download",
      heading: "Finding and downloading charts here",
      blocks: [
        {
          type: "p",
          text: "The catalog searches titles, artists and community aliases (romaji works too), and filters by version, genre, level, BPM and which assets a chart ships. Open a chart's page to download it.",
        },
        {
          type: "p",
          text: "The menu next to the download button picks the archive format. All three contain the same files — only the container differs:",
        },
        {
          type: "list",
          items: [
            ".adx — the recommended AstroDX import format. On Android, open or share it with AstroDX. On iOS, move it into the AstroDX folder itself, then reopen the game. No extraction is needed.",
            ".zip — a plain archive any system can open. Good when you want to sort things out on a computer first.",
            ".tar.gz — for command-line use or archiving. Renaming it to .adx does not make it importable; download the .adx format to import into the game.",
          ],
        },
        {
          type: "p",
          text: "Charts with a BGA include a background-animation video (pv.mp4). It changes the background only, never the judgement. Turn off “Include BGA video” to reduce the download size. If one chart is still large on a phone, omit the BGA or download it on a computer.",
        },
        {
          type: "steps",
          items: [
            "Phones split bulk downloads into independent small batches. Keep the page open, wait for the current batch to finish packing, then select Save file for each archive.",
            "Check your browser's downloads to confirm every file in this batch has finished downloading. If a file is missing or needs another attempt, select Save again before confirming release.",
            "Select Files saved — continue downloading to release this batch's cache and start the next. For the final batch, select Confirm saved and release cache. Save and import each archive separately; the import instructions remain available after release.",
          ],
        },
        {
          type: "p",
          text: "After a page reload, downloaded data can be repacked only while its job and cache have not been removed. Releasing the cache removes Save again for that data. Once the whole selection is complete, use Recent downloads in the download tray to download it again. Until then, finish the remaining batches or select the charts again.",
        },
        {
          type: "p",
          text: "Several download mirrors are available. If the current one is slow, switch the default mirror in the settings panel or pick another one for a single download.",
        },
      ],
    },
    {
      id: "import",
      heading: "Importing charts",
      blocks: [
        {
          type: "p",
          text: "What AstroDX installs is an .adx file — really just a zip with the song folder inside it and the extension changed. The .adx you download here is already packaged, so use it as-is. If you ever have a plain .zip, renaming it to .adx is the whole job (and where the extension can't be changed, \"name.adx.zip\" works too).",
        },
        {
          type: "steps",
          items: [
            "iOS / iPadOS: open the Files app and move the .adx into the AstroDX folder — the one marked with the app's icon. Into that folder itself, not the levels or collections folders inside it.",
            "Android: tap the .adx in your file browser and pick AstroDX from the \"open with\" menu. If AstroDX isn't listed, long-press the file, choose Share, and pick AstroDX there.",
            "Downloading on a desktop: no need to extract anything — move the .adx to the phone as-is. AirDrop on a Mac; LocalSend (what the wiki recommends), a cable or cloud storage on Windows and Linux. Then follow your platform's step above.",
          ],
        },
        {
          type: "p",
          text: "Open AstroDX and a progress bar appears; once it finishes, the new charts are in song select. On iOS the game sorts them out the next time you launch it, on Android it starts as soon as you hand the file over.",
        },
        {
          type: "p",
          text: "The levels and collections folders inside AstroDX belong to the game: levels holds the chart files, collections holds one manifest.json per collection. Editing a collection by hand is documented on the wiki, but ordinary imports never need to touch either.",
        },
        {
          type: "links",
          items: [
            {
              label: "Video walkthrough · importing charts",
              url: CHART_IMPORT_VIDEO_URL,
              note: "screen recording on Bilibili, narrated in Chinese",
            },
            { label: "Wiki · iOS / iPadOS import guide", url: wikiInstallUrl("en", "ios"), note: "the official step-by-step" },
            { label: "Wiki · Android import guide", url: wikiInstallUrl("en", "android"), note: "includes a video walkthrough" },
          ],
        },
      ],
    },
    {
      id: "troubleshooting",
      heading: "Troubleshooting",
      blocks: [
        {
          type: "qa",
          items: [
            {
              q: "The download stalls or crawls. What now?",
              a: "That usually means the current mirror routes badly to your network. Open the settings panel, re-measure latency under Downloads, switch to a faster mirror and restart the job. Interrupted jobs can be retried from the download tray; files that already finished are not fetched again.",
            },
            {
              q: "My phone's bulk download is waiting at the save step. Why doesn't the next batch start?",
              a: "It is waiting for you to confirm this batch was saved. Save every file, confirm they have finished downloading in your browser, then select Files saved — continue downloading. For the final batch, select Confirm saved and release cache. After release, Save again is unavailable. Once the whole selection is complete, use Recent downloads in the tray to download again; until then, finish the remaining batches or select the charts again. Keep the page open while downloading.",
            },
            {
              q: "Save was requested, but I cannot find the file, or it downloaded as .bin.",
              a: "Save requested means the browser received the request, not that the file is already on disk. Check the browser's downloads, then find the completed file in Files or your file manager. Before releasing the cache, select Save again. For an unexpected .bin, retry saving or download .zip and follow the import rename steps; do not simply rename .bin to .adx. After release, use Recent downloads in the tray once the whole selection is complete; until then, finish the remaining batches or select the charts again.",
            },
            {
              q: "The archive won't open, or reports corrupt files.",
              a: "Check your browser's downloads to confirm saving finished. Try Save again while the cache is still available; download again if the file is still corrupt or the cache was released. Do not extract .adx manually. Rename .zip to .adx or filename.adx.zip to import it. Renaming .tar.gz does not make it importable: download .adx for the game, or use a TAR.GZ-compatible tool to extract an archive.",
            },
            {
              q: "The chart doesn't show up in AstroDX after importing.",
              a: "Almost always because the archive was dropped into the levels folder — the wiki lists that specifically as a known mistake. Put the .adx in the AstroDX folder itself (iOS) or hand it to the app via open-with / share (Android) and let the game unpack it. Also make sure you launched the game once after installing it, or its folders don't exist yet; if it still doesn't appear, restart the app.",
            },
            {
              q: "My Android file manager has no “open with” or “share”.",
              a: "Use a different file manager — the wiki suggests ZArchiver or Android SAF. Relatedly, an “IOException: Permission denied” usually means a file manager with elevated permissions rewrote the chart files so AstroDX can no longer read them; re-importing the normal way clears it up.",
            },
            {
              q: "iOS won't let me change the file extension.",
              a: "In the Files app open the more menu (the three dots) → View Options and turn on “Show All Filename Extensions”, then long-press the file to rename it. If that still isn't possible, name it “something.adx.zip” — AstroDX accepts that too.",
            },
            {
              q: "There's no audio, or the cover is blank.",
              a: "The song folder is missing track.mp3 or bg.png. Some upstream charts genuinely ship without audio or cover art, and the badges at the top of the chart page say so. If the page claims they exist but your copy lacks them, download the archive again.",
            },
          ],
        },
        {
          type: "p",
          text: "Still stuck? Tell us the chart name and what you're seeing:",
        },
        {
          type: "links",
          items: [
            { label: "GitHub Issues", url: SITE_ISSUES_URL, note: "problems with this site" },
            {
              label: "AstroDX app issues",
              url: ASTRODX_APP_ISSUES_URL,
              note: "bugs in the game itself belong upstream",
            },
            { label: "QQ Group", url: QQ_COMMUNITY, note: "the main group for players in China" },
            { label: "Telegram Group", url: TELEGRAM_COMMUNITY, note: "international players and site news" },
          ],
        },
      ],
    },
  ],
  ja: [
    {
      id: "install",
      heading: "AstroDX をインストールする",
      blocks: [
        {
          type: "p",
          text: "AstroDX はコミュニティが開発した maimai 系シミュレーターです。本サイトが配布しているのは譜面だけで、アプリ本体は含みません。入手先はプラットフォームごとに異なるので、お使いの端末に合わせて進めてください。",
        },
        {
          type: "list",
          items: [
            "iOS / iPadOS：App Store から AstroDX をそのままインストールできます。公式が推奨する安定版です（TestFlight や IPA のサイドロードが必要という説明は古い情報です）。",
            "Android：GitHub Releases から最新の APK をダウンロードしてインストールします。「提供元不明のアプリ」の許可を求められるので、手動で許可してください。",
          ],
        },
        {
          type: "p",
          text: "譜面を入れる前に、必ず一度ゲームを起動しておいてください。AstroDX は初回起動時に自分用のフォルダを作るため、この手順を飛ばすと取り込んだ譜面の置き場所がありません。初回は曲が 1 つも入っていませんが、それが正常です。",
        },
        {
          type: "links",
          items: [
            { label: "App Store", url: ASTRODX_APP_STORE_URL, note: "iOS / iPadOS の安定版（公式推奨）" },
            {
              label: "GitHub Releases",
              url: ASTRODX_RELEASES_URL,
              note: "Android 向けの最新 APK",
            },
            { label: "AstroDX Wiki", url: wikiUrl("ja"), note: "本ページが従っている公式ドキュメント" },
          ],
        },
      ],
    },
    {
      id: "download",
      heading: "本サイトで譜面を探してダウンロードする",
      blocks: [
        {
          type: "p",
          text: "カタログでは曲名・アーティスト・別名（ローマ字も可）で検索でき、バージョン、ジャンル、譜面定数、BPM、収録リソースで絞り込めます。目的の譜面が見つかったら、詳細ページからダウンロードしてください。",
        },
        {
          type: "p",
          text: "ダウンロードボタン横のメニューで書庫形式を選べます。中身のファイルは 3 形式とも同じで、違いはコンテナだけです：",
        },
        {
          type: "list",
          items: [
            ".adx —— 推奨の AstroDX インポート形式。Android は「アプリで開く / 共有」で AstroDX に渡します。iOS は AstroDX フォルダ自体へ移動してからゲームを起動し直します。解凍は不要です。",
            ".zip —— 汎用の書庫。どの OS でも展開できるので、まず PC で整理したいときに向いています。",
            ".tar.gz —— コマンドラインでの作業や保管用です。.adx に名前を変えるだけでは取り込めません。ゲームに取り込む場合は .adx 形式でダウンロードしてください。",
          ],
        },
        {
          type: "p",
          text: "BGA 付きの譜面には背景動画（pv.mp4）が同梱されます。背景演出だけが変わり、判定には影響しません。「BGA 動画を含める」をオフにすると容量を減らせます。スマートフォンで 1 曲の容量が大きい場合は、BGA を外すかパソコンでダウンロードしてください。",
        },
        {
          type: "steps",
          items: [
            "スマートフォンの一括ダウンロードは独立した小さなバッチに分かれます。ページを開いたまま、今回の作成完了を待ち、各ファイルの「ファイルを保存」を押してください。",
            "ブラウザーのダウンロード履歴で今回の全ファイルの保存完了を確認します。見つからない、または再試行が必要な場合は、解放を確認する前に「もう一度保存」を押してください。",
            "「保存を確認してダウンロードを続行」で今回のキャッシュを解放し、次のバッチを開始します。最後は「保存を確認してキャッシュを解放」を押します。各ファイルを個別に保存・インポートしてください。解放後もインポート手順は表示されます。",
          ],
        },
        {
          type: "p",
          text: "ページ再読み込み後に取得済みデータから再作成できるのは、タスクやキャッシュをまだ削除していない場合だけです。解放後は同じデータをもう一度保存できません。選択した全曲の完了後は、トレイの「最近のダウンロード」から再取得できます。未完了の場合は残りのバッチを完了するか、曲を選び直してください。",
        },
        {
          type: "p",
          text: "ダウンロード回線は複数用意しています。速度が出ないときは設定パネルで既定の回線を切り替えるか、そのダウンロードだけ別のミラーを使ってください。",
        },
      ],
    },
    {
      id: "import",
      heading: "譜面を取り込む",
      blocks: [
        {
          type: "p",
          text: "AstroDX が取り込むのは .adx ファイル、つまり曲フォルダごと固めた zip の拡張子を変えただけのものです。本サイトの .adx はすでにその形なので、そのまま使えます。手元にあるのが .zip なら、拡張子を .adx に変えるだけで構いません（変更できない場合は「ファイル名.adx.zip」でも通ります）。",
        },
        {
          type: "steps",
          items: [
            "iOS / iPadOS：ファイル App を開き、AstroDX のアイコンが付いた AstroDX フォルダに .adx を移動します。そのフォルダ自体に置くのがポイントで、中の levels や collections に入れてはいけません。",
            "Android：ファイルマネージャーで .adx をタップし、「アプリで開く」から AstroDX を選びます。一覧に出てこない場合は長押しして「共有」を選び、共有メニューから AstroDX を選んでください。",
            "PC でダウンロードした場合：展開は不要で、.adx をそのまま端末へ送ります。Mac なら AirDrop、Windows / Linux なら公式 Wiki が勧める LocalSend やケーブル、クラウドストレージなど。届いたら上記の手順に進みます。",
          ],
        },
        {
          type: "p",
          text: "そのあと AstroDX を開くと進捗バーが表示され、終わると選曲画面に新しい譜面が並びます。iOS では次にゲームを起動したときに自動で整理され、Android ではファイルを渡した時点で処理が始まります。",
        },
        {
          type: "p",
          text: "AstroDX フォルダ内の levels と collections はゲームが管理する領域です（levels は譜面ファイル、collections はコレクションごとの manifest.json）。手動で編集する方法は公式 Wiki にありますが、通常の取り込みでは触る必要はありません。",
        },
        {
          type: "links",
          items: [
            {
              label: "動画で見る譜面の入れ方",
              url: CHART_IMPORT_VIDEO_URL,
              note: "bilibili の実演動画（中国語）",
            },
            { label: "Wiki · iOS / iPadOS の導入手順", url: wikiInstallUrl("ja", "ios"), note: "公式のステップ解説" },
            { label: "Wiki · Android の導入手順", url: wikiInstallUrl("ja", "android"), note: "動画つき" },
          ],
        },
      ],
    },
    {
      id: "troubleshooting",
      heading: "よくあるトラブル",
      blocks: [
        {
          type: "qa",
          items: [
            {
              q: "ダウンロードが止まる・極端に遅いときは？",
              a: "多くの場合、いま使っている回線とお使いのネットワークの相性の問題です。設定パネルの「ダウンロード」で速度を測り直し、遅延の小さい回線に切り替えてからやり直してください。中断したタスクはダウンロードトレイから再試行でき、完了済みのファイルは取り直しません。",
            },
            {
              q: "スマートフォンの一括ダウンロードが保存待ちで止まり、次のバッチが始まらない",
              a: "今回の保存確認を待っています。全ファイルを保存し、ブラウザーのダウンロード履歴で完了を確認してから「保存を確認してダウンロードを続行」を押します。最後は「保存を確認してキャッシュを解放」を押してください。解放後は再保存できません。選択した全曲の完了後はトレイの「最近のダウンロード」から再取得でき、未完了の場合は残りを完了するか曲を選び直してください。ダウンロード中はページを開いたままにします。",
            },
            {
              q: "保存を開始したのにファイルが見つからない、または .bin になった",
              a: "保存開始の表示はブラウザーへの依頼を表し、端末への保存完了を保証するものではありません。ブラウザーのダウンロード履歴で完了を確認し、「ファイル」App やファイルマネージャーで探します。キャッシュ解放前は「もう一度保存」を使えます。.bin になった場合は保存を再試行するか .zip で取得し、インポート手順に従って変更してください。.bin をそのまま .adx に変更しないでください。解放後は全曲の完了後にトレイの「最近のダウンロード」から再取得し、未完了の場合は残りを完了するか曲を選び直します。",
            },
            {
              q: "書庫が開けない・ファイルが壊れていると出る",
              a: "ブラウザーのダウンロード履歴で保存完了を確認してください。キャッシュ解放前は「もう一度保存」を優先し、それでも壊れている、または解放済みの場合は再取得します。.adx は手動解凍不要です。.zip は .adx または「ファイル名.adx.zip」に変更して取り込めます。.tar.gz は拡張子を変えるだけでは取り込めません。ゲーム用は .adx で取得し、保管用の解凍には TAR.GZ 対応ツールを使ってください。",
            },
            {
              q: "取り込んだのに AstroDX に譜面が出てこない",
              a: "多くは書庫を levels フォルダへ直接入れてしまったケースで、公式 Wiki でも「よくある間違い」として名指しされています。.adx は AstroDX フォルダ自体に置く（iOS）か、「アプリで開く / 共有」でアプリに渡して（Android）、展開はゲームに任せてください。インストール後に一度ゲームを起動したかも確認を。それでも出てこない場合はアプリを再起動してください。",
            },
            {
              q: "ファイルマネージャーに「アプリで開く」も「共有」もない（Android）",
              a: "別のファイルマネージャーを使ってください。公式 Wiki は ZArchiver や Android SAF を挙げています。なお「IOException: Permission denied」が出る場合は、権限を昇格させたファイルマネージャーが譜面ファイルを書き換えて AstroDX から読めなくなっているのが原因で、上記の方法で入れ直せば解消します。",
            },
            {
              q: "iOS で拡張子が変更できない",
              a: "ファイル App の「その他」メニュー（…）→ 表示オプションで「すべてのファイル名拡張子を表示」をオンにしてから、ファイルを長押しして名前を変更します。どうしても無理なら「ファイル名.adx.zip」でも AstroDX は受け付けます。",
            },
            {
              q: "音が出ない、ジャケットが真っ白",
              a: "曲フォルダに track.mp3 か bg.png がありません。上流の譜面自体に音源やジャケットが付属しないことがあり、その場合は譜面詳細ページ上部のリソースバッジに表示されます。ページ上はあるのに手元に無い場合は、書庫をもう一度ダウンロードしてください。",
            },
          ],
        },
        {
          type: "p",
          text: "解決しない場合は、曲名と症状を添えてご連絡ください：",
        },
        {
          type: "links",
          items: [
            { label: "GitHub Issues", url: SITE_ISSUES_URL, note: "本サイトの不具合・要望" },
            {
              label: "AstroDX アプリの Issues",
              url: ASTRODX_APP_ISSUES_URL,
              note: "ゲーム本体の不具合は上流リポジトリへ",
            },
            { label: "QQ グループ", url: QQ_COMMUNITY, note: "中国プレイヤー向けメイングループ" },
            { label: "Telegram グループ", url: TELEGRAM_COMMUNITY, note: "海外プレイヤーとサイトの最新情報" },
          ],
        },
      ],
    },
  ],
};

/**
 * The troubleshooting Q&A, lifted straight out of the rendered section so the
 * FAQPage JSON-LD and the visible page can never drift apart. Google discards a
 * FAQPage whose answers are not on the page, which is exactly what a second,
 * hand-maintained copy of this list would eventually produce.
 */
export function guideFaqItems(locale: Locale): { q: string; a: string }[] {
  const section = guideSections[locale].find((entry) => entry.id === "troubleshooting");

  return (section?.blocks ?? []).flatMap((block) =>
    block.type === "qa" ? block.items : []
  );
}

/**
 * The install → download → import walkthrough as HowTo steps, derived from the
 * same sections the page renders. Each section collapses to one step whose text
 * is its prose and lists joined together — schema.org HowToStep has no room for
 * block structure, and answer engines read the text, not the markup.
 */
export function guideHowToSteps(
  locale: Locale
): { name: string; text: string; anchor: string }[] {
  return guideSections[locale]
    .filter((section) => section.id !== "troubleshooting")
    .map((section) => ({
      name: section.heading,
      anchor: section.id,
      text: section.blocks
        .flatMap((block) => {
          if (block.type === "p") {
            return [block.text];
          }
          if (block.type === "list" || block.type === "steps") {
            return block.items;
          }
          return [];
        })
        .join(" "),
    }));
}
