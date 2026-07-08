import { Reveal } from "@/components/motion";
import { type Locale } from "@/lib/i18n";

type LicenseSection = {
  title: string;
  body: string;
};

type LicenseCopy = {
  title: string;
  description: string;
  intro: string;
  sections: LicenseSection[];
};

const copy: Record<Locale, LicenseCopy> = {
  zh: {
    title: "许可、来源与使用说明",
    description: "关于 ADX 谱面资源目录索引、下载文件与相关权利归属的说明。",
    intro:
      "ADX 谱面资源是非官方 AstroDX 谱面索引与下载入口。本站整理远端目录中的公开元数据、封面、谱面文件与媒体链接，方便玩家搜索、预览和导入 AstroDX。",
    sections: [
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
  },
  en: {
    title: "License, Sources and Usage Notes",
    description:
      "Notes about the ADX chart catalog index, downloadable chart files and related rights.",
    intro:
      "ADX 谱面资源 is an unofficial AstroDX chart index and download portal. It organizes public metadata, cover art, chart files and media links from remote directories so players can search, preview and import charts into AstroDX.",
    sections: [
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
  },
  ja: {
    title: "ライセンス、出典、利用案内",
    description:
      "ADX 譜面カタログの索引、ダウンロード可能な譜面ファイル、関連する権利についての説明です。",
    intro:
      "ADX 谱面资源 は非公式の AstroDX 譜面インデックス兼ダウンロード入口です。リモートディレクトリの公開メタデータ、ジャケット、譜面ファイル、メディアリンクを整理し、検索・プレビュー・AstroDX への導入をしやすくしています。",
    sections: [
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
  },
};

export function LicenseView({ locale = "zh" }: { locale?: Locale }) {
  const content = copy[locale];

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-8 md:px-6 md:py-10"
    >
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{content.title}</h1>
        <p className="text-muted-foreground">{content.description}</p>
        <p className="text-sm text-muted-foreground">{content.intro}</p>
      </Reveal>
      <div className="grid gap-6">
        {content.sections.map((section) => (
          <section key={section.title} className="grid gap-2 border-t border-border/60 pt-5">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <p className="text-sm leading-7 text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
