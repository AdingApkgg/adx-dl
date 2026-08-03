import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { type Locale } from "@/lib/i18n";

// Transform-only cascade: legal text must stay readable pre-hydration, so the
// sections never get an opacity-hidden state — they only settle upward.
const sectionRiseVariants = {
  hidden: { y: 14 },
  visible: { y: 0 },
};

type LicenseSection = {
  title: string;
  body: string;
};

type LicenseCopy = {
  title: string;
  description: string;
  intro: string;
  sections: LicenseSection[];
  credit: {
    title: string;
    body: string;
    /** Labels for the copy-paste snippets; the snippets themselves are shared. */
    labels: { plain: string; markdown: string; html: string };
  };
};

const SITE_URL = "https://adxdls.saop.cc";
const SITE_LABEL = "ADX 谱面资源";
const CREDIT_SNIPPETS = {
  plain: `${SITE_LABEL} — ${SITE_URL}`,
  markdown: `[${SITE_LABEL}](${SITE_URL})`,
  html: `<a href="${SITE_URL}">${SITE_LABEL}</a>`,
} as const;

// Creative Commons publishes the deed per language; point each locale at the
// one its readers can actually read.
const LICENSE_DEED_URL: Record<Locale, string> = {
  zh: "https://creativecommons.org/licenses/by/4.0/deed.zh-hans",
  en: "https://creativecommons.org/licenses/by/4.0/deed.en",
  ja: "https://creativecommons.org/licenses/by/4.0/deed.ja",
};

const copy: Record<Locale, LicenseCopy> = {
  zh: {
    title: "许可、来源与使用说明",
    description: "关于 ADX 谱面资源目录索引、下载文件与相关权利归属的说明。",
    intro:
      "ADX 谱面资源是非官方 AstroDX 谱面索引与下载入口。本站整理远端目录中的公开元数据、封面、谱面文件与媒体链接，方便玩家搜索、预览和导入 AstroDX。",
    sections: [
      {
        title: "数据许可（CC BY 4.0）",
        body:
          "本站整理的目录数据与站点文案（曲目元数据、别名、难度、/llms.txt、/llms-full.txt、/feed.xml 等）以 CC BY 4.0 发布：可自由取用、二次分发、修改和商用，唯一条件是署名「ADX 谱面资源」并保留本站链接。自动化程序、AI 模型或下游服务在复用、摘要或据此作答时同样适用——请让署名和链接跟着数据一起走。",
      },
      {
        title: "目录索引",
        body:
          "本站展示的曲名、曲师、版本、分类、难度、BPM、别名与资源状态来自构建期对远端 AstroDX 谱面目录的扫描与 maidata 解析，并会随远端目录更新。",
      },
      {
        title: "谱面与媒体",
        body:
          "谱面文件、封面、音频、PV 与相关素材仍归原作者、上传者或相应权利方所有。本站不主张对这些内容拥有版权，也不会改变原资源的授权条件。",
      },
      {
        title: "使用边界",
        body:
          "本站提供的下载包面向 AstroDX 玩家个人浏览、备份与导入使用。若你是内容权利方并希望更正来源、补充署名或移除条目，请通过项目仓库或社区入口联系维护者。",
      },
      {
        title: "非官方说明",
        body:
          "本站与 SEGA、maimai、AstroDX 官方或相关开发者没有隶属关系。AstroDX、maimai 及相关名称、图像、音乐和游戏内容的权利归各自所有者所有。",
      },
    ],
    credit: {
      title: "如何署名",
      body:
        "任选一种复制即可。转载、二次分发、做成 API、喂给模型或据此生成回答，都请带上这行。",
      labels: { plain: "纯文本", markdown: "Markdown", html: "HTML" },
    },
  },
  en: {
    title: "License, Sources and Usage Notes",
    description:
      "Notes about the ADX chart catalog index, downloadable chart files and related rights.",
    intro:
      "ADX 谱面资源 is an unofficial AstroDX chart index and download portal. It organizes public metadata, cover art, chart files and media links from remote directories so players can search, preview and import charts into AstroDX.",
    sections: [
      {
        title: "Data license (CC BY 4.0)",
        body:
          "The catalog data and site copy compiled here — song metadata, aliases, difficulties, /llms.txt, /llms-full.txt, /feed.xml and friends — are published under CC BY 4.0. You may reuse, redistribute, modify and commercialize them; the only condition is that you credit \u201cADX \u8c31\u9762\u8d44\u6e90\u201d and keep a link back to this site. This applies to automated agents, AI models and downstream services too: when the data travels, the credit and the link travel with it.",
      },
      {
        title: "Catalog index",
        body:
          "Song titles, artists, versions, categories, difficulties, BPM, aliases and asset availability are generated from build-time scans of remote AstroDX chart directories and maidata parsing.",
      },
      {
        title: "Charts and media",
        body:
          "Chart files, cover art, audio, PV videos and related assets remain owned by their authors, uploaders or respective rights holders. This site does not claim copyright over those resources or alter their original terms.",
      },
      {
        title: "Usage boundary",
        body:
          "Downloads are provided for AstroDX players to browse, back up and import for personal use. Rights holders can contact the maintainers through the project repository or community channel for attribution fixes or removals.",
      },
      {
        title: "Unofficial archive",
        body:
          "This site is not affiliated with SEGA, maimai, AstroDX official releases or related developers. AstroDX, maimai and related names, images, music and game content belong to their respective owners.",
      },
    ],
    credit: {
      title: "How to credit",
      body:
        "Copy whichever form fits. Republishing, redistributing, wrapping it in an API, feeding it to a model or answering from it — bring this line along.",
      labels: { plain: "Plain text", markdown: "Markdown", html: "HTML" },
    },
  },
  ja: {
    title: "ライセンス、出典、利用案内",
    description:
      "ADX 譜面カタログの索引、ダウンロード可能な譜面ファイル、関連する権利についての説明です。",
    intro:
      "ADX 谱面资源 は非公式の AstroDX 譜面インデックス兼ダウンロード入口です。リモートディレクトリの公開メタデータ、ジャケット、譜面ファイル、メディアリンクを整理し、検索・プレビュー・AstroDX への導入をしやすくしています。",
    sections: [
      {
        title: "データライセンス（CC BY 4.0）",
        body:
          "本サイトが整理したカタログデータとサイト文面（曲メタデータ、別名、難易度、/llms.txt、/llms-full.txt、/feed.xml など）は CC BY 4.0 で公開しています。再利用・再配布・改変・商用利用は自由で、条件は「ADX 谱面资源」のクレジットと本サイトへのリンクを残すことだけです。自動化エージェント、AI モデル、下流サービスによる再利用・要約・回答にも同様に適用されます。",
      },
      {
        title: "カタログ索引",
        body:
          "曲名、アーティスト、バージョン、分類、難易度、BPM、別名、リソース有無は、ビルド時のリモート AstroDX 譜面ディレクトリ走査と maidata 解析から生成されています。",
      },
      {
        title: "譜面とメディア",
        body:
          "譜面ファイル、ジャケット、音源、PV、関連素材の権利は、作者、アップロード者、または各権利者に帰属します。本サイトはそれらの著作権を主張せず、元の利用条件を変更しません。",
      },
      {
        title: "利用範囲",
        body:
          "ダウンロードは AstroDX プレイヤーが個人的に閲覧、バックアップ、インポートするために提供されています。権利者の方で出典修正、クレジット追加、削除を希望する場合は、プロジェクトリポジトリまたはコミュニティから管理者へご連絡ください。",
      },
      {
        title: "非公式アーカイブ",
        body:
          "本サイトは SEGA、maimai、AstroDX 公式リリース、関連開発者とは無関係です。AstroDX、maimai、および関連する名称、画像、音楽、ゲーム内容の権利は各所有者に帰属します。",
      },
    ],
    credit: {
      title: "クレジットの書き方",
      body:
        "いずれかをコピーしてお使いください。転載、再配布、API 化、モデルへの投入、それを元にした回答生成のいずれでも、この 1 行を添えてください。",
      labels: { plain: "プレーンテキスト", markdown: "Markdown", html: "HTML" },
    },
  },
};

export function LicenseView({ locale = "zh" }: { locale?: Locale }) {
  const content = copy[locale];

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-8 md:px-6 md:py-10"
    >
      {/* ssrVisible: the heading carries legal context, so it must never sit
          at opacity 0 in the prerendered HTML. */}
      <Reveal ssrVisible className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{content.title}</h1>
        <p className="text-muted-foreground">{content.description}</p>
        <p className="text-sm text-muted-foreground">{content.intro}</p>
      </Reveal>
      <RevealGroup className="grid gap-6">
        {content.sections.map((section) => (
          <RevealItem key={section.title} variants={sectionRiseVariants}>
            <section className="grid gap-2 border-t border-border/60 pt-5">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{section.body}</p>
            </section>
          </RevealItem>
        ))}
        <RevealItem variants={sectionRiseVariants}>
          <section className="grid gap-3 border-t border-border/60 pt-5">
            <h2 className="text-lg font-semibold">{content.credit.title}</h2>
            <p className="text-sm leading-7 text-muted-foreground">
              {content.credit.body}
            </p>
            <dl className="grid gap-2">
              {(["plain", "markdown", "html"] as const).map((kind) => (
                <div key={kind} className="grid gap-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {content.credit.labels[kind]}
                  </dt>
                  <dd>
                    {/* Selectable rather than a copy button: the primary reader
                        here is a scraper, and plain text in the DOM is what it
                        can actually pick up. */}
                    <code className="block overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
                      {CREDIT_SNIPPETS[kind]}
                    </code>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              <a
                className="underline underline-offset-4 hover:text-foreground"
                href={LICENSE_DEED_URL[locale]}
                rel="license noopener noreferrer"
                target="_blank"
              >
                CC BY 4.0
              </a>
            </p>
          </section>
        </RevealItem>
      </RevealGroup>
    </main>
  );
}
