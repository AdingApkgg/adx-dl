/**
 * waifu 看板娘周边逻辑（模型库/提示语配置），参考 AdingApkgg/live2d-api。
 * 模型资产走 npmmirror CDN 上的 weblive2d 包（该仓库的 npm 发布），零自托管；
 * Cubism 2 core、提示语与打飞机脚本在 public/live2d/ 下自托管。
 *
 * Ported from AdingApkgg/i (apps/web/src/lib/live2d). The welcome message is a
 * pure function of the page here, and home detection understands /en and /ja.
 */

import { stripLocalePrefix } from "@/lib/i18n";

export const WAIFU_CDN = "https://registry.npmmirror.com/weblive2d/latest/files/";

export interface ModelList {
  models: (string | string[])[];
  messages: string[];
}

export interface TipEntry {
  selector: string;
  text: string | string[];
}

export interface WaifuTips {
  mouseover: TipEntry[];
  click: TipEntry[];
  seasons: { date: string; text: string | string[] }[];
  time: { hour: string; text: string | string[] }[];
  message: {
    default: string[];
    console: string;
    copy: string;
    visibilitychange: string;
  };
}

export const WAIFU_LS = {
  group: "astrodx-waifu-group",
  costume: "astrodx-waifu-costume",
} as const;

export const modelSrc = (path: string) => `${WAIFU_CDN}model/${path}/index.json`;

export async function fetchModelList(): Promise<ModelList> {
  const r = await fetch(`${WAIFU_CDN}model_list.json`);
  if (!r.ok) throw new Error(`model_list ${r.status}`);
  return (await r.json()) as ModelList;
}

export async function fetchTips(): Promise<WaifuTips> {
  const r = await fetch("/live2d/waifu-tips.json");
  if (!r.ok) throw new Error(`waifu-tips ${r.status}`);
  return (await r.json()) as WaifuTips;
}

export const pick = (t: string | string[]): string =>
  Array.isArray(t) ? (t[Math.floor(Math.random() * t.length)] ?? "") : t;

/** 气泡只显示纯文本：提示语里的 <span> 高亮标记一律去掉。 */
export const stripTags = (text: string): string => text.replace(/<[^>]+>/g, "");

/** 时段问候："6-7" / "22-23" / "0-5"（含端点）。 */
export function timeGreeting(tips: WaifuTips, now = new Date()): string | null {
  const h = now.getHours();
  for (const t of tips.time) {
    const [a, b] = t.hour.split("-").map(Number);
    if (a === undefined || b === undefined) continue;
    if (h >= a && h <= b) return pick(t.text);
  }
  return null;
}

/** 节日问候："01/01" 或 "11/05-11/12"，{year} 占位替换。 */
export function seasonGreeting(tips: WaifuTips, now = new Date()): string | null {
  const md = (m: number, d: number) => m * 100 + d;
  const cur = md(now.getMonth() + 1, now.getDate());
  const parse = (s: string) => {
    const [m, d] = s.split("/").map(Number);
    return md(m ?? 0, d ?? 0);
  };
  for (const s of tips.seasons) {
    const [from, to] = s.date.split("-");
    if (!from) continue;
    const a = parse(from);
    const b = to ? parse(to) : a;
    if (cur >= a && cur <= b) {
      return pick(s.text).replace("{year}", String(now.getFullYear()));
    }
  }
  return null;
}

/** 一言（正文 + 出处/投稿人补充，参考实现分两条展示）。 */
export async function fetchHitokoto(): Promise<{ text: string; followup: string | null } | null> {
  try {
    const r = await fetch("https://v1.hitokoto.cn/");
    const d = (await r.json()) as { hitokoto?: string; from?: string; creator?: string };
    if (!d.hitokoto) return null;
    const followup =
      d.from && d.creator
        ? `这句一言来自「${d.from}」，是 ${d.creator} 在 hitokoto.cn 投稿的。`
        : d.from
          ? `这句一言来自「${d.from}」。`
          : null;
    return { text: d.hitokoto, followup };
  } catch {
    return null;
  }
}

export interface WelcomeContext {
  pathname: string;
  title: string;
  referrer: string;
  hostname: string;
}

const SEARCH_ENGINES: Record<string, string> = {
  baidu: "百度",
  so: "360 搜索",
  google: "谷歌搜索",
  bing: "必应",
};

/**
 * 进站欢迎语（参考实现语义）：
 * 首页（含 /en、/ja）→ 时段问候；其它页 →「欢迎来到『标题』」；带外站 referrer → 来源问候。
 */
export function welcomeMessage(tips: WaifuTips, page: WelcomeContext, now = new Date()): string {
  if (stripLocalePrefix(page.pathname) === "/") {
    return timeGreeting(tips, now) ?? pick(tips.message.default);
  }
  // Page titles read "<page> | <site name>" (see buildPageMetadata).
  const title = page.title.split(" | ")[0]?.trim() || page.title;
  const base = `欢迎来到「${title}」`;
  if (page.referrer) {
    try {
      const ref = new URL(page.referrer);
      if (ref.hostname !== page.hostname) {
        const key = ref.hostname.split(".")[1] ?? "";
        const from = SEARCH_ENGINES[key] ?? ref.hostname;
        return `Hello！来自 ${from} 的朋友，${base}`;
      }
    } catch {
      /* 无效 referrer 忽略 */
    }
  }
  return base;
}

/** 空闲随机消息池：default 池 + 当季节日文案（参考实现将节日混入池中）。 */
export function idlePool(tips: WaifuTips, now = new Date()): string[] {
  const pool = [...tips.message.default];
  const season = seasonGreeting(tips, now);
  if (season) pool.push(season);
  return pool;
}

/** 展开 model_list：组 → 该组的服装数组。 */
export function groupCostumes(list: ModelList, group: number): string[] {
  const g = list.models[group];
  if (!g) return [];
  return Array.isArray(g) ? g : [g];
}

/**
 * 恢复上次的换人/换装选择；没有记录（或记录已失效）时在第一组里随机挑一套，
 * 与参考实现的「随机开场」一致。
 */
export function restoreSelection(
  list: ModelList,
  saved: { group: string | null; costume: string | null },
  random = Math.random
): { group: number; costume: number } {
  const g = saved.group === null ? Number.NaN : Number(saved.group);
  if (Number.isInteger(g) && list.models[g]) {
    const c = Number(saved.costume) || 0;
    return { group: g, costume: Math.max(0, Math.min(c, groupCostumes(list, g).length - 1)) };
  }
  return { group: 0, costume: Math.floor(random() * groupCostumes(list, 0).length) };
}
