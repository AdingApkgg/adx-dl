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
            ".adx —— AstroDX 的导入格式，在手机上点开就能直接导入，推荐优先选它。",
            ".zip —— 通用压缩包，任何系统都能解压，适合先在电脑上整理再传到手机。",
            ".tar.gz —— 同样是通用压缩包，体积通常更小，适合命令行环境或批量归档。",
          ],
        },
        {
          type: "p",
          text: "带 BGA 的谱面会额外打包一段背景动画视频（pv.mp4）。它只影响游玩时的背景演出，不影响判定，但体积往往是谱面本身的好几倍；批量下载时可以关掉「包含背景视频」来省流量。",
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
              q: "压缩包打不开 / 提示文件损坏？",
              a: "先确认文件是否下载完整——中途断线得到的半截文件无法解压，删掉重下即可。iOS 自带的解压功能对部分 .tar.gz 支持不佳，建议改下 .zip，或者用支持该格式的解压工具。",
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
            ".adx — AstroDX's own import format. Tap it on your phone and it imports straight away; prefer this one.",
            ".zip — a plain archive any system can open. Good when you want to sort things out on a computer first.",
            ".tar.gz — also a plain archive, usually a bit smaller. Handy on the command line or for bulk storage.",
          ],
        },
        {
          type: "p",
          text: "Charts that ship a BGA include an extra background-animation video (pv.mp4). It only changes what plays behind the notes — never the judgement — but it is often several times the size of the chart itself, so batch downloads let you turn “include background video” off to save bandwidth.",
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
              q: "The archive won't open, or reports corrupt files.",
              a: "First check that the download actually finished — a truncated file cannot be extracted, so delete it and fetch it again. iOS's built-in extractor handles some .tar.gz archives poorly; download the .zip instead, or use a tool that supports the format.",
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
            ".adx —— AstroDX 専用のインポート形式。スマホでタップするだけで取り込めるので、基本はこれを選んでください。",
            ".zip —— 汎用の書庫。どの OS でも展開できるので、まず PC で整理したいときに向いています。",
            ".tar.gz —— 同じく汎用の書庫で、容量は少し小さめ。コマンドラインでの作業やまとめて保管する用途に。",
          ],
        },
        {
          type: "p",
          text: "BGA 付きの譜面には背景アニメーション動画（pv.mp4）が同梱されます。プレイ中の背景演出が変わるだけで判定には影響しませんが、譜面本体の数倍の容量になることも多いため、一括ダウンロードでは「背景動画を含める」をオフにできます。",
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
              q: "書庫が開けない・ファイルが壊れていると出る",
              a: "まずダウンロードが最後まで終わっているか確認してください。途中で切れたファイルは展開できないので、削除して取り直します。iOS 標準の展開機能は一部の .tar.gz を正しく扱えないため、.zip を選ぶか、対応した解凍アプリをお使いください。",
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
