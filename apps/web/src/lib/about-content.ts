import { QQ_COMMUNITY, TELEGRAM_COMMUNITY } from "@/lib/community-links";
import type { ContentSection } from "@/lib/content-sections";
import { ASTRODX_APP_REPOSITORY } from "@/lib/friend-links";
import type { Locale } from "@/lib/i18n";

// Keep in sync with the footer's source link in root-layout-shell.tsx.
const SOURCE_REPOSITORY = "https://github.com/AdingApkgg/adx-dl";
const SISTER_SITE_VNS = "https://gal.saop.cc/";

export const aboutSections: Record<Locale, ContentSection[]> = {
  zh: [
    {
      id: "site",
      heading: "关于本站",
      blocks: [
        {
          type: "p",
          text: "「ADX 谱面资源」是一个非官方的 AstroDX 谱面资料站，基于远端 AstroDX 目录构建索引，收录大量 maimai 风格谱面，提供曲目元数据、封面、难度定数、别名搜索、在线谱面预览与一键下载。",
        },
        {
          type: "p",
          text: "站长将以最低成本维护本站，力求稳定存活长久。谱面目录会随远端数据持续更新。",
        },
      ],
    },
    {
      id: "contact",
      heading: "联系方式",
      blocks: [
        { type: "p", text: "问题反馈、谱面投稿或闲聊，都欢迎通过以下渠道找到我们：" },
        {
          type: "links",
          items: [
            { label: "QQ 交流群", url: QQ_COMMUNITY, note: "国内玩家主要交流群" },
            { label: "Telegram 群组", url: TELEGRAM_COMMUNITY, note: "国际玩家与站点动态" },
            { label: "GitHub Issues", url: `${SOURCE_REPOSITORY}/issues`, note: "Bug 反馈与功能建议" },
          ],
        },
      ],
    },
    {
      id: "tech",
      heading: "开源与技术",
      blocks: [
        {
          type: "p",
          text: "本站开源。网站使用 Next.js 静态导出构建，托管在 GitHub Pages 上；封面等媒体资源由 Cloudflare R2 分发；评论系统由自托管的 Artalk 提供；支持 PWA 离线访问。",
        },
        {
          type: "links",
          items: [
            { label: "AdingApkgg/adx-dl", url: SOURCE_REPOSITORY, note: "本站源代码仓库" },
            {
              label: "MIT License",
              url: `${SOURCE_REPOSITORY}/blob/main/LICENSE`,
              note: "本站源代码以 MIT License 开源（© 2026 Asuna）",
            },
          ],
        },
      ],
    },
    {
      id: "credits",
      heading: "鸣谢",
      blocks: [
        {
          type: "links",
          items: [
            { label: "AstroDX", url: ASTRODX_APP_REPOSITORY, note: "社区开发的 maimai 风格模拟器本体" },
            { label: "Lxns Network", url: "https://maimai.lxns.net/", note: "谱面预览引擎与别名数据" },
            {
              label: "YuzuChaN",
              url: "https://github.com/Yuri-YuzuChaN/nonebot-plugin-maimaidx",
              note: "别名数据来源之一",
            },
          ],
        },
        {
          type: "p",
          text: "同样感谢每一位谱面作者与社区贡献者——没有你们就没有这个目录。",
        },
        {
          type: "p",
          text: "项目由 Claude 与 GPT 联合开发。所有内容均由人工智能生成。",
        },
      ],
    },
    {
      id: "sister-sites",
      heading: "姊妹站点",
      blocks: [
        {
          type: "links",
          items: [{ label: "VNS 视觉小说资料站", url: SISTER_SITE_VNS, note: "同一站长维护的 Galgame 资料站" }],
        },
      ],
    },
    {
      id: "disclaimer",
      heading: "免责声明",
      blocks: [
        {
          type: "p",
          text: "本站为非官方爱好者资料站，与 SEGA、AstroDX 开发团队均无隶属关系。AstroDX 与 maimai 的相关权利归各自所有者所有；谱面与媒体资源来自社区，如有权利问题请通过上方渠道联系处理。",
        },
      ],
    },
  ],
  en: [
    {
      id: "site",
      heading: "About This Site",
      blocks: [
        {
          type: "p",
          text: "ADX Chart Archive is an unofficial AstroDX chart archive. It indexes a remote AstroDX directory and serves per-song metadata, cover art, difficulty constants, alias search, in-browser chart previews and one-click downloads for a large library of maimai-style charts.",
        },
        {
          type: "p",
          text: "The site is run at minimal cost with one goal: stay stable and stay around. The catalog updates continuously alongside the upstream directory.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        { type: "p", text: "Bug reports, chart recommendations or just a chat — reach us here:" },
        {
          type: "links",
          items: [
            { label: "QQ Group", url: QQ_COMMUNITY, note: "the main group for players in China" },
            { label: "Telegram Group", url: TELEGRAM_COMMUNITY, note: "international players and site news" },
            { label: "GitHub Issues", url: `${SOURCE_REPOSITORY}/issues`, note: "bugs and feature requests" },
          ],
        },
      ],
    },
    {
      id: "tech",
      heading: "Open Source & Tech",
      blocks: [
        {
          type: "p",
          text: "The site is open source — a Next.js static export hosted on GitHub Pages, with cover art delivered from Cloudflare R2, comments by a self-hosted Artalk, and PWA offline support.",
        },
        {
          type: "links",
          items: [
            { label: "AdingApkgg/adx-dl", url: SOURCE_REPOSITORY, note: "this site's source repository" },
            {
              label: "MIT License",
              url: `${SOURCE_REPOSITORY}/blob/main/LICENSE`,
              note: "the site's source code is MIT-licensed (© 2026 Asuna)",
            },
          ],
        },
      ],
    },
    {
      id: "credits",
      heading: "Credits",
      blocks: [
        {
          type: "links",
          items: [
            { label: "AstroDX", url: ASTRODX_APP_REPOSITORY, note: "the community-built maimai-style simulator" },
            { label: "Lxns Network", url: "https://maimai.lxns.net/", note: "chart preview engine and alias data" },
            {
              label: "YuzuChaN",
              url: "https://github.com/Yuri-YuzuChaN/nonebot-plugin-maimaidx",
              note: "one of the alias data sources",
            },
          ],
        },
        {
          type: "p",
          text: "And thank you to every chart designer and community contributor — this catalog exists because of you.",
        },
        {
          type: "p",
          text: "This project is co-developed by Claude & GPT. All contents are AI-generated.",
        },
      ],
    },
    {
      id: "sister-sites",
      heading: "Sister Sites",
      blocks: [
        {
          type: "links",
          items: [{ label: "VNS", url: SISTER_SITE_VNS, note: "a visual-novel archive by the same maintainer" }],
        },
      ],
    },
    {
      id: "disclaimer",
      heading: "Disclaimer",
      blocks: [
        {
          type: "p",
          text: "This is an unofficial fan-maintained archive, unaffiliated with SEGA or the AstroDX team. All AstroDX and maimai rights belong to their respective owners; charts and media come from the community — for rights concerns, please reach out via the contacts above.",
        },
      ],
    },
  ],
  ja: [
    {
      id: "site",
      heading: "本サイトについて",
      blocks: [
        {
          type: "p",
          text: "「ADX 譜面アーカイブ」は非公式の AstroDX 譜面資料サイトです。リモートの AstroDX ディレクトリからインデックスを構築し、maimai 系譜面の楽曲メタデータ、ジャケット、譜面定数、別名検索、ブラウザ内プレビュー、ワンクリックダウンロードを提供します。",
        },
        {
          type: "p",
          text: "管理人は最小限のコストで本サイトを維持し、長く安定して存続させることを目指しています。カタログは上流のデータとともに更新され続けます。",
        },
      ],
    },
    {
      id: "contact",
      heading: "連絡先",
      blocks: [
        { type: "p", text: "不具合の報告、譜面の推薦、雑談など、以下のチャンネルからどうぞ：" },
        {
          type: "links",
          items: [
            { label: "QQ グループ", url: QQ_COMMUNITY, note: "中国プレイヤー向けメイングループ" },
            { label: "Telegram グループ", url: TELEGRAM_COMMUNITY, note: "海外プレイヤーとサイトの最新情報" },
            { label: "GitHub Issues", url: `${SOURCE_REPOSITORY}/issues`, note: "バグ報告・機能要望" },
          ],
        },
      ],
    },
    {
      id: "tech",
      heading: "オープンソースと技術",
      blocks: [
        {
          type: "p",
          text: "本サイトはオープンソースです。Next.js の静的エクスポートで構築し GitHub Pages でホスティング、ジャケット画像は Cloudflare R2 から配信、コメントはセルフホストの Artalk、PWA によるオフライン対応も備えています。",
        },
        {
          type: "links",
          items: [
            { label: "AdingApkgg/adx-dl", url: SOURCE_REPOSITORY, note: "本サイトのソースリポジトリ" },
            {
              label: "MIT License",
              url: `${SOURCE_REPOSITORY}/blob/main/LICENSE`,
              note: "本サイトのソースコードは MIT License で公開（© 2026 Asuna）",
            },
          ],
        },
      ],
    },
    {
      id: "credits",
      heading: "謝辞",
      blocks: [
        {
          type: "links",
          items: [
            { label: "AstroDX", url: ASTRODX_APP_REPOSITORY, note: "コミュニティ開発の maimai 系シミュレーター" },
            { label: "Lxns Network", url: "https://maimai.lxns.net/", note: "譜面プレビューエンジンと別名データ" },
            {
              label: "YuzuChaN",
              url: "https://github.com/Yuri-YuzuChaN/nonebot-plugin-maimaidx",
              note: "別名データの提供元のひとつ",
            },
          ],
        },
        {
          type: "p",
          text: "そして、すべての譜面作者とコミュニティの貢献者に感謝します。このカタログは皆さんのおかげで成り立っています。",
        },
        {
          type: "p",
          text: "本プロジェクトは Claude と GPT の共同開発です。すべてのコンテンツは AI により生成されています。",
        },
      ],
    },
    {
      id: "sister-sites",
      heading: "姉妹サイト",
      blocks: [
        {
          type: "links",
          items: [{ label: "VNS", url: SISTER_SITE_VNS, note: "同じ管理人によるビジュアルノベル資料サイト" }],
        },
      ],
    },
    {
      id: "disclaimer",
      heading: "免責事項",
      blocks: [
        {
          type: "p",
          text: "本サイトは非公式のファンサイトであり、SEGA および AstroDX 開発チームとは一切関係ありません。AstroDX と maimai に関する権利は各権利者に帰属します。譜面とメディアはコミュニティ由来のものです。権利に関するご相談は上記の連絡先までお願いします。",
        },
      ],
    },
  ],
};
